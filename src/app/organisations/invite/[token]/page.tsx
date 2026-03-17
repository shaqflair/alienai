// src/app/organisations/invite/[token]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, Loader2, ShieldCheck, LogIn, Building2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

type InviteDetails = {
  org_name:    string;
  role:        string;
  invited_by?: string;
};

type PageState =
  | { status: "checking" }
  | { status: "needs-login" }
  | { status: "idle";      invite: InviteDetails }
  | { status: "accepting"; invite: InviteDetails }
  | { status: "success";   role: string; org_name: string }
  | { status: "error";     message: string };

export default function InviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const token =
    typeof params?.token === "string"
      ? params.token
      : Array.isArray(params?.token)
        ? params.token[0]
        : "";

  const [state, setState] = useState<PageState>({ status: "checking" });

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const sb = createClient();
        const { data } = await sb.auth.getUser();

        // Fetch invite details regardless of auth state
        const res  = await fetch("/api/organisation-invites/preview?token=" + encodeURIComponent(token));
        const json = await res.json().catch(() => ({ ok: false }));

        const invite: InviteDetails = {
          org_name:   json?.org_name   || "your organisation",
          role:       json?.role       || "member",
          invited_by: json?.invited_by || undefined,
        };

        if (data?.user) {
          setState({ status: "idle", invite });
        } else {
          setState({ status: "needs-login" });
        }
      } catch {
        setState({ status: "needs-login" });
      }
    })();
  }, [token]);

  function goToLogin() {
    const returnTo = encodeURIComponent(`/organisations/invite/${token}`);
    window.location.href = `/login?next=${returnTo}`;
  }

  async function handleAccept() {
    if (!token) return;
    const currentInvite = state.status === "idle" ? state.invite : { org_name: "your organisation", role: "member" };
    setState({ status: "accepting", invite: currentInvite });

    try {
      const res = await fetch("/api/organisation-invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({ ok: false, error: "Bad response" }));

      if (res.status === 401 || json?.error?.toLowerCase().includes("not authenticated")) {
        setState({ status: "needs-login" });
        return;
      }

      if (!json?.ok) {
        setState({ status: "error", message: json?.error || "Failed to accept invite" });
        return;
      }

      setState({
        status:   "success",
        role:     json.role ?? currentInvite.role ?? "member",
        org_name: currentInvite.org_name,
      });

      // -- KEY FIX: send to /onboarding so new members complete their profile --
      setTimeout(() => router.push("/onboarding"), 2500);

    } catch (e: any) {
      setState({ status: "error", message: e?.message || "Something went wrong" });
    }
  }

  if (!token) {
    return (
      <PageShell>
        <ErrorCard message="Invalid invite link -- token is missing." />
      </PageShell>
    );
  }

  return (
    <PageShell>

      {state.status === "checking" && (
        <Card>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:"20px 0" }}>
            <Loader2 style={{ width:32, height:32, color:"#0e7490", animation:"spin 1s linear infinite" }} />
            <p style={{ fontSize:13, color:"#94a3b8" }}>Loading your invite...</p>
          </div>
        </Card>
      )}

      {state.status === "needs-login" && (
        <Card>
          <IconBox color="#f0fdfa">
            <LogIn style={{ width:32, height:32, color:"#0e7490" }} />
          </IconBox>
          <h1 style={{ fontSize:22, fontWeight:800, color:"#0f172a", textAlign:"center", margin:"0 0 8px" }}>
            Sign in to accept
          </h1>
          <p style={{ fontSize:13, color:"#64748b", textAlign:"center", margin:"0 0 28px", lineHeight:1.6 }}>
            You need to be signed in to accept this invite. We will bring you straight back here after login.
          </p>
          <PrimaryBtn onClick={goToLogin}>Sign in to continue</PrimaryBtn>
          <p style={{ marginTop:14, textAlign:"center", fontSize:11, color:"#94a3b8" }}>
            Don't have an account? You can create one on the sign in page.
          </p>
        </Card>
      )}

      {state.status === "idle" && (
        <Card>
          <IconBox color="#f0fdfa">
            <ShieldCheck style={{ width:32, height:32, color:"#0e7490" }} />
          </IconBox>

          <h1 style={{ fontSize:22, fontWeight:800, color:"#0f172a", textAlign:"center", margin:"0 0 8px" }}>
            You've been invited
          </h1>

          {/* Org + role context -- the missing piece */}
          <div style={{
            background:"#f8fafc", border:"1.5px solid #e2e8f0",
            borderRadius:12, padding:"14px 18px", margin:"0 0 24px",
            display:"flex", flexDirection:"column", gap:10,
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:"rgba(14,116,144,0.08)", border:"1.5px solid rgba(14,116,144,0.15)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Building2 style={{ width:18, height:18, color:"#0e7490" }} />
              </div>
              <div>
                <div style={{ fontSize:12, color:"#94a3b8", marginBottom:2 }}>You are joining</div>
                <div style={{ fontSize:15, fontWeight:800, color:"#0f172a" }}>{state.invite.org_name}</div>
              </div>
            </div>
            <div style={{ borderTop:"1px solid #e2e8f0", paddingTop:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:12, color:"#64748b" }}>Your role</span>
              <span style={{
                fontSize:11, fontWeight:800, padding:"3px 10px", borderRadius:999,
                background:"rgba(14,116,144,0.08)", color:"#0e7490",
                textTransform:"capitalize", border:"1px solid rgba(14,116,144,0.15)",
              }}>{state.invite.role}</span>
            </div>
            {state.invite.invited_by && (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:12, color:"#64748b" }}>Invited by</span>
                <span style={{ fontSize:12, fontWeight:600, color:"#0f172a" }}>{state.invite.invited_by}</span>
              </div>
            )}
          </div>

          <PrimaryBtn onClick={handleAccept}>Accept invite and get started</PrimaryBtn>
          <p style={{ marginTop:12, textAlign:"center", fontSize:11, color:"#94a3b8" }}>
            If you didn't expect this invite, you can safely close this page.
          </p>
        </Card>
      )}

      {state.status === "accepting" && (
        <Card>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, padding:"20px 0" }}>
            <Loader2 style={{ width:40, height:40, color:"#0e7490", animation:"spin 1s linear infinite" }} />
            <p style={{ fontSize:13, fontWeight:600, color:"#475569" }}>Accepting your invite...</p>
          </div>
        </Card>
      )}

      {state.status === "success" && (
        <Card borderColor="#dcfce7">
          <IconBox color="#f0fdf4">
            <CheckCircle2 style={{ width:32, height:32, color:"#16a34a" }} />
          </IconBox>
          <h2 style={{ fontSize:22, fontWeight:800, color:"#0f172a", textAlign:"center", margin:"0 0 8px" }}>
            Welcome aboard!
          </h2>
          <p style={{ fontSize:13, color:"#64748b", textAlign:"center", margin:"0 0 16px", lineHeight:1.65 }}>
            You have joined <strong style={{ color:"#0f172a" }}>{state.org_name}</strong> as a{" "}
            <strong style={{ color:"#0f172a", textTransform:"capitalize" }}>{state.role}</strong>.
          </p>
          <div style={{
            background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:10,
            padding:"12px 16px", marginBottom:16, fontSize:12, color:"#166534", textAlign:"center",
          }}>
            Next step: complete your profile so your team knows who you are.
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontSize:11, color:"#94a3b8" }}>
            <Loader2 style={{ width:12, height:12, animation:"spin 1s linear infinite" }} />
            Taking you to profile setup...
          </div>
        </Card>
      )}

      {state.status === "error" && (
        <ErrorCard
          message={(state as any).message}
          onRetry={() => setState({ status: "checking" })}
        />
      )}

    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Shared UI                                                            */
/* ------------------------------------------------------------------ */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight:"100vh", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      background:"#f8fafc", padding:"24px",
      fontFamily:"system-ui,-apple-system,sans-serif",
    }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ marginBottom:28, textAlign:"center" }}>
        <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", borderRadius:12, background:"#0e7490", padding:"8px 18px", marginBottom:8 }}>
          <span style={{ fontSize:15, fontWeight:800, color:"white", letterSpacing:"0.5px" }}>Aliena</span>
        </div>
        <p style={{ fontSize:11, color:"#94a3b8", margin:0 }}>Governance intelligence</p>
      </div>
      <div style={{ width:"100%", maxWidth:440 }}>{children}</div>
      <p style={{ marginTop:28, fontSize:11, color:"#94a3b8", textAlign:"center" }}>
        If you didn't expect this invite, you can safely ignore this page.{" "}
        <a href="https://aliena.co.uk" style={{ color:"#94a3b8" }}>aliena.co.uk</a>
      </p>
    </div>
  );
}

function Card({ children, borderColor = "#e2e8f0" }: { children: React.ReactNode; borderColor?: string }) {
  return (
    <div style={{
      background:"white", borderRadius:20,
      border:"1.5px solid " + borderColor,
      padding:"32px 28px",
      boxShadow:"0 4px 24px rgba(0,0,0,0.06)",
    }}>{children}</div>
  );
}

function IconBox({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div style={{ display:"flex", justifyContent:"center", marginBottom:20 }}>
      <div style={{ width:64, height:64, borderRadius:18, background:color, display:"flex", alignItems:"center", justifyContent:"center" }}>
        {children}
      </div>
    </div>
  );
}

function PrimaryBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      width:"100%", padding:"13px", borderRadius:12,
      background:"#0e7490", color:"white",
      fontSize:14, fontWeight:700, border:"none", cursor:"pointer",
      boxShadow:"0 2px 12px rgba(14,116,144,0.25)",
    }}>{children}</button>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card borderColor="#fee2e2">
      <IconBox color="#fef2f2">
        <AlertTriangle style={{ width:32, height:32, color:"#ef4444" }} />
      </IconBox>
      <h2 style={{ fontSize:20, fontWeight:800, color:"#0f172a", textAlign:"center", margin:"0 0 8px" }}>
        Something went wrong
      </h2>
      <p style={{ fontSize:13, color:"#64748b", textAlign:"center", margin:"0 0 20px" }}>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} style={{
          width:"100%", padding:"10px", borderRadius:10,
          border:"1.5px solid #e2e8f0", background:"white",
          fontSize:13, fontWeight:600, color:"#475569", cursor:"pointer",
        }}>Try again</button>
      )}
    </Card>
  );
}