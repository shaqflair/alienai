import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

// Uses the Service Role Key to update the DB without user session context
function admin() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createAdminClient(url, key);
}

function planFromProduct(productName: string): string {
  const n = productName.toLowerCase();
  if (n.includes("enterprise")) return "enterprise";
  if (n.includes("pro"))        return "pro";
  return "starter";
}

export async function POST(req: Request) {
  const stripeKey     = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ ok: false, error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-01-27.acacia" });
  const body   = await req.text();
  const sig    = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;

  // Security: Verify that this request actually came from Stripe
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (e: any) {
    console.error(`Webhook Signature Error: ${e.message}`);
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }

  const sb = admin();

  switch (event.type) {
    case "checkout.session.completed": {
      const session  = event.data.object as Stripe.Checkout.Session;
      const orgId    = String(session.metadata?.organisation_id ?? "");
      const plan     = String(session.metadata?.plan ?? "pro");
      const custId   = String(session.customer ?? "");
      
      if (orgId) {
        await sb.from("organisations")
          .update({ 
            plan, 
            stripe_customer_id: custId || undefined 
          })
          .eq("id", orgId);
        console.log(`Org ${orgId} upgraded to ${plan}`);
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub      = event.data.object as Stripe.Subscription;
      const custId   = String(sub.customer ?? "");
      const isActive = sub.status === "active" || sub.status === "trialing";

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
        // Subscription updated: Check the product name to determine the new plan level
        const productId = sub.items.data[0]?.price?.product;
        if (productId) {
          const product = await stripe.products.retrieve(String(productId));
          const newPlan = planFromProduct(product.name);
          await sb.from("organisations").update({ plan: newPlan }).eq("id", org.id);
        }
      }
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
