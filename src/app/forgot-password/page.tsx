"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL || window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${baseUrl}/auth/reset`,
      });
      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; background: #0a0e1a; }
        .fp-input {
          width: 100%;
          padding: 10px 14px;
          border-radius: 6px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          color: #ffffff;
          font-size: 14px;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.2s;
        }
        .fp-input:focus { border-color: rgba(56,189,248,0.5); }
        .fp-input::placeholder { color: rgba(255,255,255,0.25); }
        .fp-btn {
          width: 100%;
          padding: 11px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          background: rgba(56,189,248,0.15);
          border: 1px solid rgba(56,189,248,0.3);
          color: #7dd3fc;
          cursor: pointer;
          transition: all 0.2s;
        }
        .fp-btn:hover:not(:disabled) {
          background: rgba(56,189,248,0.25);
          border-color: rgba(56,189,248,0.5);
        }
        .fp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
      <main style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
        background: "linear-gradient(135deg, #0a0e1a 0%, #0d1526 50%, #0a0e1a 100%)",
      }}>
        {/* Stars */}
        <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
          {[...Array(40)].map((_, i) => (
            <div key={i} style={{
              position: "absolute",
              width: i % 5 === 0 ? 2 : 1,
              height: i % 5 === 0 ? 2 : 1,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.6)",
              left: `${(i * 37 + 11) % 100}%`,
              top: `${(i * 23 + 7) % 100}%`,
              opacity: 0.3 + (i % 4) * 0.15,
            }} />
          ))}
        </div>

        <div style={{
          position: "relative", zIndex: 1,
          width: "100%", maxWidth: 360,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: "36px 32px",
          backdropFilter: "blur(12px)",
        }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.35em", color: "#ffffff", fontFamily: "monospace" }}>
              <span style={{ color: "#38bdf8", textShadow: "0 0 12px #38bdf8, 0 0 24px #38bdf8" }}>Λ</span> L <span style={{ color: "#38bdf8", textShadow: "0 0 12px #38bdf8, 0 0 24px #38bdf8" }}>I</span> Ξ N Λ
            </div>
            <div style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
              Project Intelligence Platform
            </div>
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginBottom: 24 }} />

          <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", textAlign: "center", marginBottom: 20 }}>
            Reset Password
          </div>

          {sent ? (
            <div style={{
              background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)",
              borderRadius: 8, padding: "14px 16px", fontSize: 13,
              color: "#4ade80", textAlign: "center", lineHeight: 1.6,
            }}>
              ✓ If an account exists for <strong>{email}</strong>, a reset link has been sent. Check your inbox and spam folder.
            </div>
          ) : (
            <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
                  Email
                </label>
                <input
                  type="email"
                  required
                  className="fp-input"
                  placeholder="operator@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {error && (
                <div style={{
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 6, padding: "10px 12px", fontSize: 12, color: "#f87171",
                }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="fp-btn">
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <Link href="/login" style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", textDecoration: "underline" }}>
              Back to login
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}