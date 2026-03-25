"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [isInvite, setIsInvite] = useState(false);

  // Handle hash-based tokens from Supabase invite/recovery emails
  // Supabase sends: /auth/reset#access_token=...&type=invite
  useEffect(() => {
    const supabase = createClient();

    async function handleHashSession() {
      const hash = window.location.hash;

      if (hash && hash.includes("access_token")) {
        const params = new URLSearchParams(hash.replace("#", ""));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token") ?? "";
        const type = params.get("type"); // "invite" | "recovery"

        if (accessToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            setError("Invalid or expired link. Please request a new one.");
            return;
          }
          if (type === "invite") setIsInvite(true);
          // Clear hash from URL so it's not visible
          window.history.replaceState(null, "", window.location.pathname);
          setSessionReady(true);
          return;
        }
      }

      // No hash — check if already have a session (PKCE flow via callback)
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        setSessionReady(true);
      } else {
        setError("No valid session. Please use the link from your email or request a new one.");
      }
    }

    handleHashSession();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => { router.replace("/projects"); router.refresh(); }, 1500);
    } catch (e: any) {
      setError(e?.message ?? "Failed to set password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; background: #0a0e1a; }
        .rp-input {
          width: 100%; padding: 10px 14px; border-radius: 6px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          color: #ffffff; font-size: 14px; outline: none;
          box-sizing: border-box; transition: border-color 0.2s;
        }
        .rp-input:focus { border-color: rgba(56,189,248,0.5); }
        .rp-input::placeholder { color: rgba(255,255,255,0.25); }
        .rp-btn {
          width: 100%; padding: 11px; border-radius: 6px;
          font-size: 13px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase;
          background: rgba(56,189,248,0.15);
          border: 1px solid rgba(56,189,248,0.3);
          color: #7dd3fc; cursor: pointer; transition: all 0.2s;
        }
        .rp-btn:hover:not(:disabled) {
          background: rgba(56,189,248,0.25);
          border-color: rgba(56,189,248,0.5);
        }
        .rp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>

      <main style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", padding: "16px",
        background: "linear-gradient(135deg, #0a0e1a 0%, #0d1526 50%, #0a0e1a 100%)",
      }}>
        {/* Stars */}
        <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
          {[...Array(40)].map((_, i) => (
            <div key={i} style={{
              position: "absolute",
              width: i % 5 === 0 ? 2 : 1, height: i % 5 === 0 ? 2 : 1,
              borderRadius: "50%", background: "rgba(255,255,255,0.6)",
              left: `${(i * 37 + 11) % 100}%`, top: `${(i * 23 + 7) % 100}%`,
              opacity: 0.3 + (i % 4) * 0.15,
            }} />
          ))}
        </div>

        <div style={{
          position: "relative", zIndex: 1, width: "100%", maxWidth: 380,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12, padding: "36px 32px",
          backdropFilter: "blur(12px)",
        }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.35em", color: "#ffffff", fontFamily: "monospace" }}>
              <span style={{ color: "#38bdf8", textShadow: "0 0 12px #38bdf8, 0 0 24px #38bdf8" }}>Λ</span>{" "}
              L{" "}
              <span style={{ color: "#38bdf8", textShadow: "0 0 12px #38bdf8, 0 0 24px #38bdf8" }}>I</span>{" "}
              Ξ N Λ
            </div>
            <div style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
              Project Intelligence Platform
            </div>
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginBottom: 24 }} />

          <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", textAlign: "center", marginBottom: 20 }}>
            {isInvite ? "Welcome — Set Your Password" : "Set New Password"}
          </div>

          {success ? (
            <div style={{
              background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)",
              borderRadius: 8, padding: "14px 16px", fontSize: 13,
              color: "#4ade80", textAlign: "center", lineHeight: 1.6,
            }}>
              ✓ Password set. Taking you in…
            </div>
          ) : !sessionReady && !error ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13, padding: "20px 0" }}>
              Verifying your link…
            </div>
          ) : error && !sessionReady ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6, padding: "10px 12px", fontSize: 12, color: "#f87171",
              }}>
                {error}
              </div>
              <a href="/forgot-password" style={{
                display: "block", textAlign: "center", padding: "10px",
                borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)",
                color: "#7dd3fc", textDecoration: "none",
              }}>
                Request a new reset link →
              </a>
              <a href="/login" style={{ display: "block", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.3)", textDecoration: "underline" }}>
                Back to login
              </a>
            </div>
          ) : (
            <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
                  New Password
                </label>
                <input
                  type="password" required className="rp-input"
                  placeholder="Min. 8 characters"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
                  Confirm Password
                </label>
                <input
                  type="password" required className="rp-input"
                  placeholder="Re-enter password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)}
                />
                {confirm.length > 0 && (
                  <div style={{ fontSize: 11, marginTop: 5, color: password === confirm ? "#4ade80" : "#f87171" }}>
                    {password === confirm ? "✓ Passwords match" : "✗ Passwords do not match"}
                  </div>
                )}
              </div>

              {error && (
                <div style={{
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 6, padding: "10px 12px", fontSize: 12, color: "#f87171",
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || password !== confirm || password.length < 8}
                className="rp-btn"
              >
                {loading ? "Setting password…" : isInvite ? "Set password & enter" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </main>
    </>
  );
}