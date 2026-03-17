// src/components/InviteSignupForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InviteSignupForm({
  token, orgName, role, email: prefillEmail,
}: {
  token: string; orgName: string; role: string; email?: string;
}) {
  const router = useRouter();
  const [email,    setEmail]    = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState<string | null>(null);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== confirm)  { setErr("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res  = await fetch("/api/organisation-invites/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password }),
      });
      const json = await res.json().catch(() => ({ ok: false, error: "Bad response" }));
      if (!json?.ok) {
        if (res.status === 409) {
          router.replace(`/login?next=/organisations/invite/${encodeURIComponent(token)}`);
          return;
        }
        setErr(json?.error || "Failed to create account");
        return;
      }
      if (json.redirect) { window.location.href = json.redirect; }
      else               { router.replace("/onboarding"); }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create account");
    } finally {
      setLoading(false);
    }
  }

  const inp: React.CSSProperties = {
    width:"100%", padding:"10px 12px", borderRadius:9,
    border:"1.5px solid #e2e8f0", fontSize:14,
    fontFamily:"inherit", outline:"none", color:"#0f172a",
    background:"white", boxSizing:"border-box",
  };
  const lbl: React.CSSProperties = {
    display:"block", fontSize:11, fontWeight:700,
    color:"#64748b", marginBottom:5,
    textTransform:"uppercase", letterSpacing:"0.06em",
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#f8fafc", padding:24, fontFamily:"system-ui,-apple-system,sans-serif" }}>
      <div style={{ width:"100%", maxWidth:440 }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", borderRadius:12, background:"#0e7490", padding:"8px 18px", marginBottom:8 }}>
            <span style={{ fontSize:15, fontWeight:800, color:"white", letterSpacing:"0.5px" }}>Aliena</span>
          </div>
          <p style={{ fontSize:11, color:"#94a3b8", margin:0 }}>Governance intelligence</p>
        </div>

        <div style={{ background:"white", borderRadius:20, border:"1.5px solid #e2e8f0", padding:"32px 28px", boxShadow:"0 4px 24px rgba(0,0,0,0.06)" }}>
          <div style={{ padding:"12px 16px", borderRadius:12, background:"#f0fdfa", border:"1.5px solid rgba(14,116,144,0.2)", marginBottom:24 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#0e7490", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Invitation</div>
            <div style={{ fontSize:14, color:"#0f172a", fontWeight:600, marginBottom:2 }}>
              You have been invited to join <strong>{orgName}</strong> as a <span style={{ textTransform:"capitalize" }}>{role}</span>.
            </div>
            <div style={{ fontSize:12, color:"#64748b" }}>Create your account below to get started.</div>
          </div>

          <h1 style={{ fontSize:20, fontWeight:800, color:"#0f172a", margin:"0 0 20px", letterSpacing:"-0.3px" }}>Create your account</h1>

          {err && (
            <div style={{ padding:"10px 14px", borderRadius:8, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", color:"#dc2626", fontSize:13, marginBottom:16 }}>
              {err}
            </div>
          )}

          <form onSubmit={handleSignup} style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div>
              <label style={lbl}>Email address</label>
              <input style={{ ...inp, background: prefillEmail ? "#f8fafc" : "white" }}
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com" readOnly={!!prefillEmail} />
              {prefillEmail && <div style={{ fontSize:11, color:"#94a3b8", marginTop:4 }}>Email is set by your invitation and cannot be changed.</div>}
            </div>
            <div>
              <label style={lbl}>Password</label>
              <input style={inp} type="password" required value={password}
                onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" autoComplete="new-password" />
            </div>
            <div>
              <label style={lbl}>Confirm password</label>
              <input style={inp} type="password" required value={confirm}
                onChange={e => setConfirm(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" />
            </div>
            <button type="submit" disabled={loading} style={{
              width:"100%", padding:"12px", borderRadius:10, marginTop:4,
              background: loading ? "#94a3b8" : "#0e7490", color:"white",
              fontSize:14, fontWeight:700, border:"none", cursor: loading ? "wait" : "pointer",
              boxShadow: loading ? "none" : "0 2px 12px rgba(14,116,144,0.25)",
            }}>
              {loading ? "Creating account..." : "Create account and join"}
            </button>
          </form>

          <div style={{ marginTop:18, textAlign:"center", fontSize:12, color:"#94a3b8" }}>
            Already have an account?{" "}
            <a href={`/login?next=/organisations/invite/${encodeURIComponent(token)}`}
              style={{ color:"#0e7490", fontWeight:600, textDecoration:"none" }}>Sign in instead</a>
          </div>
        </div>

        <p style={{ marginTop:20, textAlign:"center", fontSize:11, color:"#94a3b8" }}>
          Access to Aliena requires an invitation.{" "}
          <a href="https://aliena.co.uk" style={{ color:"#94a3b8" }}>aliena.co.uk</a>
        </p>
      </div>
    </div>
  );
}