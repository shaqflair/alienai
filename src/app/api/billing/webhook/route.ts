// src/app/api/billing/webhook/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createRequire } from "module";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runtime Stripe loader (prevents Turbopack build failure when stripe isn't installed).
 */
function loadStripe(): any | null {
  try {
    const req = createRequire(process.cwd() + "/");
    const mod = req("stripe");
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

// Uses the Service Role Key to update the DB without user session context
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createAdminClient(url, key);
}

function planFromProduct(productName: string): string {
  const n = (productName || "").toLowerCase();
  if (n.includes("enterprise")) return "enterprise";
  if (n.includes("pro")) return "pro";
  return "starter";
}

export async function POST(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const StripeCtor = loadStripe();

  if (!stripeKey || !webhookSecret || !StripeCtor) {
    return NextResponse.json({ ok: false, error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = new StripeCtor(stripeKey, { apiVersion: "2025-01-27.acacia" });

  // Stripe requires the *raw* body for signature verification
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  let event: any;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (e: any) {
    console.error(`Webhook Signature Error: ${e?.message ?? String(e)}`);
    return NextResponse.json({ ok: false, error: e?.message ?? "Invalid signature" }, { status: 400 });
  }

  const sb = admin();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as any;
      const orgId = String(session?.metadata?.organisation_id ?? "");
      const plan = String(session?.metadata?.plan ?? "pro");
      const custId = String(session?.customer ?? "");

      if (orgId) {
        await sb
          .from("organisations")
          .update({
            plan,
            stripe_customer_id: custId || undefined,
          })
          .eq("id", orgId);

        console.log(`Org ${orgId} upgraded to ${plan}`);
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as any;
      const custId = String(sub?.customer ?? "");
      const status = String(sub?.status ?? "");
      const isActive = status === "active" || status === "trialing";

      if (!custId) break;

      const { data: org } = await sb
        .from("organisations")
        .select("id")
        .eq("stripe_customer_id", custId)
        .maybeSingle();

      if (!org?.id) break;

      if (!isActive) {
        // Subscription ended or failed: Downgrade to starter
        await sb.from("organisations").update({ plan: "starter" }).eq("id", org.id);
      } else {
        // Subscription updated: determine plan by product name
        const productId = sub?.items?.data?.[0]?.price?.product;
        if (productId) {
          const product = await stripe.products.retrieve(String(productId));
          const newPlan = planFromProduct(String(product?.name ?? ""));
          await sb.from("organisations").update({ plan: newPlan }).eq("id", org.id);
        }
      }
      break;
    }
  }

  return NextResponse.json({ ok: true });
}