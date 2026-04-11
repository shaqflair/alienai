// Drop-in replacement for the "Convert to confirmed" button on the project page
"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

const Gate1Checker = dynamic(() => import("./Gate1Checker"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 32, textAlign: "center", color: "#8b949e", fontSize: 13 }}>
      Loading gate checker…
    </div>
  ),
});

type Props = {
  projectId: string;
  isAdmin: boolean;
  returnTo?: string;
};

export default function Gate1Modal({ projectId, isAdmin, returnTo }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 14px", borderRadius: 8,
          border: "1px solid #7c3aed", background: "#7c3aed",
          color: "white", fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s",
        }}
      >
        🚀 Convert to Active
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(10,10,10,0.35)",
            backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              background: "#ffffff", borderRadius: 16,
              width: "100%", maxWidth: 560,
              boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
              border: "1px solid #e8ecf0",
              maxHeight: "90vh", overflowY: "auto",
              display: "flex", flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "18px 20px", borderBottom: "1px solid #e8ecf0",
            }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8b949e", marginBottom: 4 }}>
                  Governance Gate
                </div>
                <h2 style={{ fontSize: 17, fontWeight: 750, color: "#0d1117", margin: 0, letterSpacing: "-0.02em" }}>
                  Gate 1 — Baseline Readiness
                </h2>
                <p style={{ fontSize: 12, color: "#57606a", margin: "4px 0 0", lineHeight: 1.5 }}>
                  All criteria must be met before this project can move to active delivery.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  border: "1px solid #e8ecf0", background: "#f6f8fa",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", fontSize: 14, color: "#57606a", flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Gate checker */}
            <Gate1Checker
              projectId={projectId}
              isAdmin={isAdmin}
              returnTo={returnTo}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
