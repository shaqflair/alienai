// FILE: src/app/organisations/invite/[token]/page.tsx
import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const revalidate = 0;

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

async function acceptOrgInvite(token: string, cookieHeader: string) {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "";

  const url = `${base.replace(/\/+$/, "")}/api/organisation-invites/accept`;

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body:    JSON.stringify({ token }),
    cache:   "no-store",
  });

  return res.json().catch(() => ({ ok: false, error: "Invalid response" }));
}

function Page({ title, body, actions, note }: {
  title:    string;
  body:     string;
  actions?: React.ReactNode;
  note?:    string;
}) {
  return (
    <div style={{
      minHeight: "100vh", background: "#f8fafc",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      padding: "24px",
    }}>
      <div style={{
        maxWidth: "440px", width: "100%",
        background: "white", borderRadius: "20px",
        border: "1.5px solid #e2e8f0",
        boxShadow: "0 8px 40px rgba(0,0,0,0.08)",
        overflow: "hidden",
      }}>
        <div style={{
          background: "linear-gradient(135deg,#0e7490 0%,#0891b2 100%)",
          padding: "24px 28px",
        }}>
          <div style={{ fontSize: "20px", fontWeight: 900, color: "white",
                        letterSpacing: "-0.3px" }}>ResForce</div>
          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.65)",
                        marginTop: "2px" }}>Resource management</div>
        </div>
        <div style={{ padding: "28px" }}>
          <h1 style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a",
                       margin: "0 0 10px" }}>{title}</h1>
          <p style={{ fontSize: "13px", color: "#475569", margin: "0 0 20px",
                      lineHeight: 1.6 }}>{body}</p>
          {actions && <div style={{ display: "flex", gap: "8px" }}>{actions}</div>}
          {note && (
            <div style={{
              marginTop: "16px", padding: "12px 14px",
              background: "#f8fafc", borderRadius: "8px",
              border: "1px solid #e2e8f0",
              fontSize: "11px", color: "#94a3b8", lineHeight: 1.5,
            }}>{note}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Btn({ href, children, primary }: {
  href: string; children: React.ReactNode; primary?: boolean;
}) {
  return (
    <a href={href} style={{
      display: "inline-flex", alignItems: "center",
      padding: "9px 18px", borderRadius: "9px",
      fontSize: "13px", fontWeight: 700, textDecoration: "none",
      background: primary ? "#0e7490" : "white",
      color:      primary ? "white"   : "#475569",
      border:     primary ? "none"    : "1.5px solid #e2e8f0",
      boxShadow:  primary ? "0 2px 12px rgba(14,116,144,0.25)" : "none",
    }}>{children}</a>
  );
}

export default async function OrgInviteTokenPage({
  params,
}: {
  params: { token?: string } | Promise<{ token?: string }>;
}) {
  const p     = await Promise.resolve(params as any);
  const token = safeParam(p?.token).trim();

  if (!token) {
    return (
      <Page
        title="Invalid invite link"
        body="This invite link is missing a token and cannot be used."
        actions={<Btn href="/projects" primary>Go to projects</Btn>}
      />
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth?.user) {
    redirect(`/login?next=${encodeURIComponent(`/organisations/invite/${encodeURIComponent(token)}`)}`);
  }

  const cookieStore  = await cookies();
  const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join("; ");

  let result: any;
  try {
    result = await acceptOrgInvite(token, cookieHeader);
  } catch (e: any) {
    return (
      <Page
        title="Something went wrong"
        body={String(e?.message ?? "Unable to process the invite.")}
        actions={<><Btn href="/login">Log in</Btn><Btn href="/projects" primary>Go to projects</Btn></>}
        note="The invite may be expired, revoked, or intended for a different email address."
      />
    );
  }

  if (!result?.ok) {
    return (
      <Page
        title="Couldn't accept invite"
        body={String(result?.error || "Unable to accept invite.")}
        actions={<><Btn href="/login">Log in</Btn><Btn href="/projects" primary>Go to projects</Btn></>}
        note="The invite may be expired, revoked, already accepted, or intended for a different email."
      />
    );
  }

  const orgId = String(result?.organisation_id || "").trim();
  if (orgId) redirect("/people?joined=1");

  return (
    <Page
      title="You're in!"
      body="You've been added to the organisation successfully."
      actions={<Btn href="/projects" primary>Go to projects</Btn>}
    />
  );
}