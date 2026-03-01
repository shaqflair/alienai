// src/app/api/billing/checkout/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createRequire } from "module";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(msg: string, s = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status: s });
}

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

/**
 * Runtime Stripe loader (prevents Turbopack build failure when stripe isn't installed).
 * If stripe is installed, returns the Stripe constructor; otherwise null.
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

function appOrigin(): string {
  const origin =
    process.env.APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  return safeStr(origin).replace(/\/+$/, "");
}

const PLAN_PRICES: Record<string, string | undefined> = {
  pro: process.env.STRIPE_PRICE_PRO,
};

export async function GET(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const StripeCtor = loadStripe();
  if (!stripeKey || !StripeCtor) return bad("Stripe not configured", 500);

  const sb = await createClient();
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();

  if (error || !user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", "/settings/billing");
    return NextResponse.redirect(loginUrl);
  }

  const url = new URL(req.url);
  const plan = safeStr(url.searchParams.get("plan")).toLowerCase();
  const orgId = safeStr(url.searchParams.get("org")).trim();

  if (!isUuid(orgId)) return bad("Invalid org");
  if (!PLAN_PRICES[plan]) {
    return bad(`Unknown plan or missing STRIPE_PRICE_${plan.toUpperCase()} env var`);
  }

  // Verify caller is an Admin or Owner of the target organisation
  const { data: mem } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const role = safeStr(mem?.role).toLowerCase();
  if (role !== "admin" && role !== "owner") return bad("Admin access required", 403);

  // Fetch organisation to check for existing Stripe Customer ID
  const { data: org } = await sb
    .from("organisations")
    .select("name, stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();

  let customerId = safeStr((org as any)?.stripe_customer_id) || null;

  const stripe = new StripeCtor(stripeKey, { apiVersion: "2025-01-27.acacia" });
  const origin = appOrigin();
  if (!origin) return bad("APP_ORIGIN not configured", 500);

  // Create Stripe Customer if they don't have an ID yet
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: safeStr((org as any)?.name) || undefined,
      metadata: { organisation_id: orgId, user_id: user.id },
    });

    customerId = customer.id;

    // Persist the customer ID so we don't create duplicates later
    await sb.from("organisations").update({ stripe_customer_id: customerId }).eq("id", orgId);
  }

  // Create the Checkout Session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: PLAN_PRICES[plan]!, quantity: 1 }],
    success_url: `${origin}/settings/billing?success=1`,
    cancel_url: `${origin}/settings/billing?canceled=1`,
    metadata: { organisation_id: orgId, plan },
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { organisation_id: orgId },
    },
  });

  return NextResponse.redirect(session.url!);
}