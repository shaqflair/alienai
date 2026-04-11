// src/app/settings/security/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/utils/supabase/client";
import Image from "next/image";

type MFAFactor = {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
  created_at: string;
};

type Step = "idle" | "enroll" | "verify" | "done";

function fmtDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch { return iso; }
}

export default function SecuritySettingsPage() {
  const supabase = createClient();

  const [factors,   setFactors]   = useState<MFAFactor[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [step,      setStep]      = useState<Step>("idle");
  const [qr,        setQr]        = useState<string>("");
  const [secret,    setSecret]    = useState<string>("");
  const [factorId,  setFactorId]  = useState<string>("");
  const [code,      setCode]      = useState<string>("");
  const [error,     setError]     = useState<string | null>(null);
  const [removing,  setRemoving]  = useState<string | null>(null);
  const [assuranceLevel, setAssuranceLevel] = useState<string>("");

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setFactors(data?.totp ?? []);

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      setAssuranceLevel(aal?.currentLevel ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Failed to load MFA factors");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void loadFactors(); }, [loadFactors]);

  async function startEnroll() {
    setError(null);
    setStep("enroll");
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `AlienAI TOTP ${new Date().toLocaleDateString("en-GB")}`,
      });
      if (error) throw error;
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
      setStep("verify");
    } catch (e: any) {
      setError(e?.message ?? "Failed to start MFA enrollment");
      setStep("idle");
    }
  }

  async function verifyAndActivate() {
    if (code.length !== 6) { setError("Enter the 6-digit code from your authenticator app"); return; }
    setError(null);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
      if (cErr) throw cErr;

      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (vErr) throw vErr;

      setStep("done");
      void loadFactors();
    } catch (e: any) {
      setError(e?.message ?? "Invalid code. Please try again.");
    }
  }

  async function removeFactor(id: string) {
    setRemoving(id);
    setError(null);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
      if (error) throw error;
      void loadFactors();
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove MFA factor");
    } finally {
      setRemoving(null);
    }
  }

  const hasMFA = factors.some(f => f.status === "verified");

  const S = {
    card: { background: "#ffffff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "20px 24px", marginBottom: 16 } as React.CSSProperties,
    label: { fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 5, display: "block" },
    input: { padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 16, fontFamily: "monospace", outline: "none", color: "#0f172a", background: "white", width: "100%", boxSizing: "border-box" as const, letterSpacing: "0.2em", textAlign: "center" as const },
    btn: (variant: "primary" | "danger" | "ghost"): React.CSSProperties => ({
      padding: "9px 18px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700,
      cursor: "pointer", fontFamily: "inherit",
      background: variant === "primary" ? "#0e7490" : variant === "danger" ? "#dc2626" : "#f1f5f9",
      color: variant === "ghost" ? "#475569" : "white",
    }),
  };

  return (
    <div style={{ padding: "32px 40px", maxWidth: 600, fontFamily: "'DM Sans', sans-serif" }}>
      <h1 style={{ fontSize: 18, fontWeight: 900, color: "#0f172a", margin: "0 0 4px" }}>
        Security
      </h1>
      <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 28px" }}>
        Manage two-factor authentication and account security.
      </p>

      {/* MFA status banner */}
      <div style={{ ...S.card, background: hasMFA ? "#f0fdf4" : "#fffbeb", border: `1.5px solid ${hasMFA ? "#bbf7d0" : "#fde68a"}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: hasMFA ? "#059669" : "#d97706", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ color: "white", fontSize: 18, fontWeight: 700 }}>{hasMFA ? "\u2713" : "!"}</span>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: hasMFA ? "#059669" : "#d97706" }}>
            {hasMFA ? "Two-factor authentication is enabled" : "Two-factor authentication is not enabled"}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {hasMFA
              ? `MFA level: ${assuranceLevel === "aal2" ? "Verified (AAL2)" : "Enrolled"}`
              : "Add an authenticator app to protect your account."}
          </div>
        </div>
      </div>

      {/* Existing factors */}
      {factors.length > 0 && (
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>
            Enrolled authenticators
          </div>
          {factors.map(f => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                  {f.friendly_name ?? "Authenticator app"}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                  Added {fmtDate(f.created_at)} --
                  <span style={{ marginLeft: 6, fontWeight: 700, color: f.status === "verified" ? "#059669" : "#d97706" }}>
                    {f.status === "verified" ? "Active" : "Pending verification"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeFactor(f.id)}
                disabled={removing === f.id}
                style={{ ...S.btn("danger"), padding: "6px 12px", fontSize: 11, opacity: removing === f.id ? 0.6 : 1 }}
              >
                {removing === f.id ? "Removing..." : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Enroll new */}
      {step === "idle" && (
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
            {hasMFA ? "Add another authenticator" : "Set up authenticator app"}
          </div>
          <p style={{ fontSize: 13, color: "#475569", margin: "0 0 16px", lineHeight: 1.6 }}>
            Use an authenticator app like Google Authenticator, Authy, or 1Password
            to generate time-based one-time codes.
          </p>
          <button type="button" onClick={startEnroll} style={S.btn("primary")}>
            Set up authenticator app
          </button>
        </div>
      )}

      {/* QR code + verify */}
      {(step === "verify" || step === "enroll") && (
        <div style={S.card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>
            Scan QR code
          </div>

          {step === "enroll" && (
            <div style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              Generating QR code...
            </div>
          )}

          {step === "verify" && qr && (
            <>
              <div style={{ display: "flex", gap: 24, alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap" }}>
                <div style={{ background: "white", padding: 12, border: "1.5px solid #e2e8f0", borderRadius: 8, flexShrink: 0 }}>
                  <img src={qr} alt="MFA QR Code" width={160} height={160} style={{ display: "block" }} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{ fontSize: 13, color: "#475569", margin: "0 0 12px", lineHeight: 1.6 }}>
                    1. Open your authenticator app<br />
                    2. Tap <strong>Add account</strong> or the <strong>+</strong> button<br />
                    3. Scan this QR code<br />
                    4. Enter the 6-digit code below
                  </p>
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 4 }}>MANUAL ENTRY CODE</div>
                    <div style={{ fontFamily: "monospace", fontSize: 13, color: "#0f172a", wordBreak: "break-all", letterSpacing: "0.1em" }}>{secret}</div>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={S.label}>Enter 6-digit code from your app</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  style={S.input}
                  autoFocus
                />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={verifyAndActivate} style={S.btn("primary")} disabled={code.length !== 6}>
                  Verify and activate
                </button>
                <button type="button" onClick={() => { setStep("idle"); setCode(""); setError(null); }} style={S.btn("ghost")}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Success */}
      {step === "done" && (
        <div style={{ ...S.card, background: "#f0fdf4", border: "1.5px solid #bbf7d0" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#059669", marginBottom: 8 }}>
            {"\u2713"} Authenticator app added successfully
          </div>
          <p style={{ fontSize: 13, color: "#475569", margin: "0 0 14px" }}>
            Your account is now protected with two-factor authentication.
            You will be asked for a code when you sign in.
          </p>
          <button type="button" onClick={() => setStep("idle")} style={S.btn("primary")}>
            Done
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "#fff5f5", border: "1px solid #fecaca", fontSize: 13, color: "#dc2626", marginTop: 12 }}>
          {error}
        </div>
      )}

      {/* Password change hint */}
      <div style={{ ...S.card, marginTop: 8, background: "#f8fafc" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>Password</div>
        <p style={{ fontSize: 13, color: "#475569", margin: "0 0 12px" }}>
          To change your password, use the forgot password flow from the login page.
        </p>
        <a href="/forgot-password" style={{ fontSize: 13, fontWeight: 700, color: "#0e7490", textDecoration: "none" }}>
          Change password
        </a>
      </div>
    </div>
  );
}