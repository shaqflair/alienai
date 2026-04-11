// src/app/settings/billing/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { createRequire } from "module";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Billing | Settings" };

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function fmt(pence: number, currency = "gbp") {
  const cur = safeStr(currency).toUpperCase() || "GBP";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: cur,
    minimumFractionDigits: 0,
  }).format((Number(pence) || 0) / 100);
}

function fmtDate(ts: number) {
  const n = Number(ts) || 0;
  return new Date(n * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const PLANS = [
  {
    id: "starter",
    label: "Starter",
    price: "Free",
    features: ["Up to 5 people", "1 project", "Heatmap & reports"],
    colour: "#64748b",
  },
  {
    id: "pro",
    label: "Pro",
    price: "£49/mo",
    features: ["Up to 25 people", "Unlimited projects", "Gantt & scenarios", "Email digests"],
    colour: "#0e7490",
    highlight: true,
  },
  {
    id: "enterprise",
    label: "Enterprise",
    price: "Custom",
    features: ["Unlimited people & projects", "SSO / SAML", "Dedicated support", "Custom integrations"],
    colour: "#7c3aed",
  },
];

/**
 * IMPORTANT BUILD FIX:
 * Vercel build is failing because `stripe` is not installed (Module not found: Can't resolve 'stripe').
 * We must NOT statically import `stripe` anywhere (pages/routes), otherwise Turbopack fails at build-time.
 *
 * This loader uses a runtime require that Turbopack can't statically analyze.
 * - If `stripe` is installed: works normally
 * - If not installed: returns null and the UI gracefully degrades
 */
function loadStripe(): any | null {
  try {
    // createRequire is node-safe in Next runtime=nodejs
    const req = createRequire(process.cwd() + "/");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = req("stripe");
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

function getAppOrigin(): string {
  const envOrigin =
    process.env.APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "";

  if (envOrigin) return envOrigin.replace(/\/+$/, "");

  // Vercel fallback
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  return vercelUrl.replace(/\/+$/, "");
}

async function createPortalSession(_orgId: string, customerId: string): Promise<string | null> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return null;

  const StripeCtor = loadStripe();
  if (!StripeCtor) return null;

  try {
    const stripe = new StripeCtor(stripeKey, { apiVersion: "2025-01-27.acacia" });
    const origin = getAppOrigin();
    if (!origin) return null;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/settings/billing`,
    });

    return session?.url ?? null;
  } catch {
    return null;
  }
}

async function getStripeData(customerId: string | null) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !customerId) return null;

  const StripeCtor = loadStripe();
  if (!StripeCtor) return null;

  try {
    const stripe = new StripeCtor(stripeKey, { apiVersion: "2025-01-27.acacia" });

    const [customer, subs, invoices] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.subscriptions.list({ customer: customerId, limit: 1, status: "active" }),
      stripe.invoices.list({ customer: customerId, limit: 5 }),
    ]);

    const sub = subs?.data?.[0] ?? null;

    const productId = sub?.items?.data?.[0]?.price?.product ? String(sub.items.data[0].price.product) : "";
    const product = productId ? await stripe.products.retrieve(productId) : null;

    return {
      customer,
      subscription: sub,
      product,
      invoices: invoices?.data ?? [],
    };
  } catch {
    return null;
  }
}

export default async function SettingsBillingPage({
  searchParams,
}: {
  // Next app router passes an object, NOT a Promise
  searchParams?: { success?: string; canceled?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/settings/billing");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/settings?err=no_org");
  const organisationId = String(orgId);

  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const myRole = safeStr(mem?.role).toLowerCase();
  if (myRole !== "admin" && myRole !== "owner") redirect("/settings?err=not_admin");

  const { data: org } = await supabase
    .from("organisations")
    .select("name, stripe_customer_id, plan")
    .eq("id", organisationId)
    .maybeSingle();

  const stripeCustomerId = safeStr((org as any)?.stripe_customer_id) || null;
  const currentPlan = safeStr((org as any)?.plan) || "starter";

  const stripeData = await getStripeData(stripeCustomerId);
  const portalUrl = stripeCustomerId ? await createPortalSession(organisationId, stripeCustomerId) : null;

  const sp = searchParams ?? {};
  const hasStripe = !!process.env.STRIPE_SECRET_KEY && !!loadStripe();

  const sub = stripeData?.subscription ?? null;
  const product = (stripeData?.product as any) ?? null;

  return (
    <div style={{ padding: "32px 40px", maxWidth: "680px", fontFamily: "'DM Sans', sans-serif" }}>
      <h1 style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a", margin: "0 0 4px" }}>Billing</h1>
      <p style={{ fontSize: "13px", color: "#94a3b8", margin: "0 0 28px" }}>Manage your plan and payment details.</p>

      {/* Status notices */}
      {(sp.success || sp.canceled) && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1.5px solid #e2e8f0",
            background: sp.success ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)",
            color: sp.success ? "#065f46" : "#92400e",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          {sp.success ? "Payment succeeded. Your subscription will update shortly." : "Checkout was canceled."}
        </div>
      )}

      {!hasStripe && (
        <div
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1.5px solid rgba(245,158,11,0.25)",
            borderRadius: "14px",
            padding: "14px 16px",
            marginBottom: "20px",
            color: "#92400e",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          Stripe is not configured on this environment. Install the Stripe SDK and set STRIPE_SECRET_KEY to enable billing
          management.
        </div>
      )}

      {stripeData && sub ? (
        <div
          style={{
            background: "white",
            borderRadius: "14px",
            border: "1.5px solid #e2e8f0",
            padding: "20px 24px",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 800,
              color: "#94a3b8",
              textTransform: "uppercase",
              marginBottom: "12px",
            }}
          >
            Current plan
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
            <div style={{ fontSize: "20px", fontWeight: 900, color: "#0f172a" }}>{product?.name ?? "Pro"}</div>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 800,
                padding: "3px 8px",
                borderRadius: "5px",
                background: "rgba(16,185,129,0.1)",
                color: "#059669",
              }}
            >
              {sub.status}
            </span>
          </div>
          <div style={{ fontSize: "13px", color: "#475569", marginBottom: "14px" }}>
            Next renewal {fmtDate(sub.current_period_end)}
          </div>
          {portalUrl && (
            <a
              href={portalUrl}
              style={{
                display: "inline-flex",
                padding: "9px 18px",
                borderRadius: "9px",
                background: "#0e7490",
                color: "white",
                fontSize: "12px",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Manage billing
            </a>
          )}
        </div>
      ) : (
        <div
          style={{
            background: "white",
            borderRadius: "14px",
            border: "1.5px solid #e2e8f0",
            padding: "20px 24px",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 800,
              color: "#94a3b8",
              textTransform: "uppercase",
              marginBottom: "8px",
            }}
          >
            Current plan
          </div>
          <div style={{ fontSize: "20px", fontWeight: 900, color: "#0f172a", textTransform: "capitalize" }}>
            {currentPlan}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "28px" }}>
        {PLANS.map((plan) => {
          const isActive = currentPlan === plan.id;
          return (
            <div
              key={plan.id}
              style={{
                background: "white",
                borderRadius: "12px",
                border: `1.5px solid ${isActive ? plan.colour : "#e2e8f0"}`,
                padding: "16px",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>{plan.label}</div>
              <div style={{ fontSize: "18px", fontWeight: 900, color: plan.colour, marginBottom: "12px" }}>
                {plan.price}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {plan.features.map((f) => (
                  <div key={f} style={{ fontSize: "11px", color: "#475569", display: "flex", gap: "6px" }}>
                    <span style={{ color: plan.colour }}>•</span> {f}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {stripeData?.invoices?.length ? (
        <div style={{ background: "white", borderRadius: "14px", border: "1.5px solid #e2e8f0", overflow: "hidden" }}>
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid #f1f5f9",
              fontSize: "11px",
              fontWeight: 800,
              color: "#94a3b8",
            }}
          >
            Invoice history
          </div>

          {stripeData.invoices.map((inv: any) => (
            <div
              key={inv.id}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "12px 20px",
                borderBottom: "1px solid #f8fafc",
                gap: "12px",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "12px", fontWeight: 700 }}>{fmtDate(inv.created)}</div>
                <div style={{ fontSize: "11px", color: "#94a3b8" }}>{inv.number}</div>
              </div>
              <div style={{ fontSize: "13px", fontWeight: 700 }}>{fmt(inv.amount_paid, inv.currency)}</div>
              {inv.invoice_pdf && (
                <a
                  href={inv.invoice_pdf}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: "11px", fontWeight: 700, color: "#0891b2", textDecoration: "none" }}
                >
                  PDF
                </a>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}