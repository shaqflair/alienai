"use client";

import { useState } from "react";
import AllocateForm from "../../allocations/_components/AllocateForm";
import type { PersonOption, ProjectOption } from "../../allocations/_components/AllocateForm";

export default function AllocateModal({
  projectId,
  people,
  projects,
  organisationId,
  triggerLabel = "Allocate resource",
}: {
  projectId:      string;
  people:          PersonOption[];
  projects:        ProjectOption[];
  organisationId: string;
  triggerLabel?:  string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <style>{`
        @keyframes am-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes am-slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex", alignItems: "center", gap: "7px",
          padding: "9px 18px", borderRadius: "8px",
          background: "#00b8db", border: "none",
          color: "white", fontSize: "13px", fontWeight: 700,
          fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
          boxShadow: "0 2px 10px rgba(0,184,219,0.3)",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.background = "#00a0bf";
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background = "#00b8db";
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.5"
             strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {triggerLabel}
      </button>

      {/* Backdrop + modal */}
      {open && (
        <div
          style={{
            position: "fixed", inset: 0,
            background: "rgba(15,23,42,0.55)",
            backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: "20px",
            animation: "am-fade-in 0.15s ease",
          }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              background: "white", borderRadius: "18px",
              border: "1.5px solid #e2e8f0",
              width: "100%", maxWidth: "720px",
              maxHeight: "90vh", display: "flex", flexDirection: "column",
              boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
              animation: "am-slide-up 0.2s ease",
              overflow: "hidden",
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: "20px 24px 16px",
              borderBottom: "1px solid #f1f5f9",
              background: "linear-gradient(135deg, rgba(0,184,219,0.04) 0%, transparent 60%)",
              display: "flex", alignItems: "center",
              justifyContent: "space-between", flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "9px",
                  background: "rgba(0,184,219,0.1)",
                  border: "1px solid rgba(0,184,219,0.2)",
                  display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: "16px",
                }}>?</div>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                    Allocate Resource
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "1px" }}>
                    Assign a person and auto-generate weekly rows
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  background: "none", border: "none",
                  color: "#94a3b8", cursor: "pointer",
                  fontSize: "20px", lineHeight: 1, padding: "4px",
                  borderRadius: "6px", transition: "color 0.1s",
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#0f172a")}
                onMouseLeave={e => (e.currentTarget.style.color = "#94a3b8")}
              >
                ?
              </button>
            </div>

            {/* Scrollable form body */}
            <div style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
              <AllocateForm
                people={people}
                projects={projects}
                defaultProjectId={projectId}
                returnTo={`/projects/${projectId}`}
                organisationId={organisationId}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
