"use client";

import { useState, useRef, useEffect } from "react";

type Member = { user_id: string; name: string; email: string };

type Props = {
  projectId: string;
  currentPmName: string;
  currentPmUserId: string | null;
  orgId: string;
};

export default function AssignPmButton({ projectId, currentPmName, currentPmUserId, orgId }: Props) {
  const [open, setOpen]       = useState(false);
  const [search, setSearch]   = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [pmName, setPmName]   = useState(currentPmName);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Load members once when dropdown opens
  useEffect(() => {
    if (!open || members.length > 0) return;
    setLoading(true);
    fetch(`/api/org/members?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.members)) setMembers(d.members); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, orgId, members.length]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = members.filter((m) => {
    const q = search.toLowerCase();
    return (m.name || "").toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q);
  });

  async function assign(member: Member) {
    setSaving(true);
    try {
      const res = await fetch("/api/projects/assign-pm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, pm_user_id: member.user_id, pm_name: member.name || member.email }),
      });
      if (res.ok) {
        setPmName(member.name || member.email);
        setOpen(false);
        setSearch("");
      }
    } finally {
      setSaving(false);
    }
  }

  async function unassign() {
    setSaving(true);
    try {
      const res = await fetch("/api/projects/assign-pm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, pm_user_id: null, pm_name: null }),
      });
      if (res.ok) {
        setPmName("Unassigned");
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          color: "#3b82f6", fontWeight: 500, fontSize: 13, fontFamily: "inherit",
          textDecoration: pmName === "Unassigned" ? "underline dotted" : "none",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        {saving ? "Saving…" : pmName}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.5 }}>
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300,
          width: 280, background: "white", border: "1.5px solid #e2e8f0",
          borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,0.13)", overflow: "hidden",
        }}>
          {/* Search */}
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="#94a3b8" strokeWidth="2"/>
              <path d="m21 21-4.35-4.35" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              style={{
                flex: 1, border: "none", outline: "none", fontSize: 13,
                color: "#0f172a", fontFamily: "inherit", background: "transparent",
              }}
            />
          </div>

          {/* List */}
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: "14px 16px", fontSize: 13, color: "#94a3b8", textAlign: "center" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "14px 16px", fontSize: 13, color: "#94a3b8", textAlign: "center" }}>No members found</div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.user_id}
                  onClick={() => assign(m)}
                  style={{
                    width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start",
                    padding: "9px 14px", border: "none", background: m.user_id === currentPmUserId ? "#f0f6ff" : "white",
                    cursor: "pointer", fontFamily: "inherit", borderBottom: "1px solid #f8fafc",
                    gap: 1,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = m.user_id === currentPmUserId ? "#f0f6ff" : "white")}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{m.name || "—"}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{m.email}</span>
                </button>
              ))
            )}
          </div>

          {/* Unassign footer */}
          {pmName !== "Unassigned" && (
            <div style={{ borderTop: "1px solid #f1f5f9", padding: "8px 12px" }}>
              <button
                onClick={unassign}
                style={{
                  width: "100%", padding: "7px", border: "1px solid #fee2e2",
                  borderRadius: 8, background: "#fef2f2", color: "#dc2626",
                  fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Remove PM assignment
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}