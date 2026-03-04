// src/app/(app)/change/ChangeClientPage.tsx — RAID Intelligence style
"use client";
import React, { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ─── Design tokens ─────────────────────────────────────────────────────────── */
const T = {
  bg:      "#f9f7f4",
  surface: "#ffffff",
  hr:      "#e7e5e4",
  ink:     "#1c1917",
  ink2:    "#44403c",
  ink3:    "#78716c",
  ink4:    "#a8a29e",
  ink5:    "#d6d3d1",
  mono:    "'IBM Plex Mono', 'Menlo', monospace",
  serif:   "'Playfair Display', 'Georgia', serif",
  body:    "'Source Serif 4', 'Georgia', serif",
};

export default function ChangeClientPage() {
  const router    = useRouter();
  const sp        = useSearchParams();

  const projectId = useMemo(() => {
    const v =
      sp?.get("projectId") ||
      sp?.get("project_id") ||
      sp?.get("pid") ||
      sp?.get("id") ||
      "";
    return String(v).trim();
  }, [sp]);

  useEffect(() => {
    if (!projectId) return;
    router.replace(`/projects/${encodeURIComponent(projectId)}/change`);
  }, [projectId, router]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes ragPulse { 0%,100%{opacity:.2} 50%{opacity:.45} }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body }}>

        {/* ── Header bar ── */}
        <div style={{ background: T.ink, borderBottom: "1px solid #292524", padding: "0 40px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", height: 56, display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase", color: "#a8a29e" }}>
              Change Intelligence
            </span>
            <span style={{ color: "#44403c", fontSize: 10 }}>·</span>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: "#78716c" }}>
              Change Control
            </span>
          </div>
        </div>

        {/* ── Content ── */}
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 40px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 4, padding: "48px 56px", maxWidth: 480, width: "100%" }}>

            {projectId ? (
              /* Redirecting state */
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%",
                    border: `2px solid ${T.ink5}`, borderTopColor: T.ink,
                    animation: "spin 0.8s linear infinite",
                    flexShrink: 0,
                  }} />
                  <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink4 }}>
                    Redirecting
                  </span>
                </div>

                <div style={{ fontFamily: T.serif, fontSize: 28, fontWeight: 700, color: T.ink, marginBottom: 12, lineHeight: 1.2 }}>
                  Opening Change Control
                </div>

                <div style={{ fontFamily: T.body, fontSize: 14, color: T.ink3, lineHeight: 1.6, marginBottom: 24 }}>
                  Navigating to the project change register…
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: T.bg, border: `1px solid ${T.hr}`, borderRadius: 2 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink4 }}>Project</span>
                  <span style={{ flex: 1, height: 1, background: T.hr }} />
                  <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, color: T.ink2 }}>{projectId}</span>
                </div>
              </>
            ) : (
              /* Error state */
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                  <div style={{ position: "relative", width: 12, height: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ position: "absolute", inset: -3, borderRadius: "50%", background: "#7f1d1d", opacity: 0.15, animation: "ragPulse 2.2s ease-in-out infinite" }} />
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#7f1d1d", display: "inline-block" }} />
                  </div>
                  <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase", color: "#7f1d1d" }}>
                    Missing Context
                  </span>
                </div>

                <div style={{ fontFamily: T.serif, fontSize: 28, fontWeight: 700, color: T.ink, marginBottom: 12, lineHeight: 1.2 }}>
                  No Project Selected
                </div>

                <div style={{ fontFamily: T.body, fontSize: 14, color: T.ink3, lineHeight: 1.6, marginBottom: 28 }}>
                  Change Control must be opened from within a project. A{" "}
                  <span style={{ fontFamily: T.mono, fontSize: 12, background: T.bg, border: `1px solid ${T.hr}`, borderRadius: 2, padding: "1px 6px" }}>projectId</span>
                  {" "}parameter is required to load the change register.
                </div>

                <a href="/projects" style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.07em", textTransform: "uppercase",
                  color: T.ink, textDecoration: "none",
                  padding: "8px 16px", border: `1px solid ${T.hr}`, borderRadius: 2,
                  background: T.bg, transition: "all 0.13s ease",
                }}>
                  View Projects →
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}