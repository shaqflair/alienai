"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

type Member = {
  user_id: string;
  name: string;
  email: string;
  full_name?: string | null;
  avatar_url?: string | null;
  department?: string | null;
  job_title?: string | null;
  role?: string | null;
};

type Props = {
  projectId: string;
  currentPmName: string;
  currentPmUserId: string | null;
  orgId: string;
};

function initialsFromName(name: string) {
  const clean = String(name || "").trim();
  if (!clean) return "U";

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function safeRoleLabel(member: Member) {
  return member.job_title?.trim() || member.role?.trim() || member.department?.trim() || "";
}

function avatarBg(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const palette = [
    "linear-gradient(135deg, #0ea5e9, #2563eb)",
    "linear-gradient(135deg, #14b8a6, #0f766e)",
    "linear-gradient(135deg, #8b5cf6, #6d28d9)",
    "linear-gradient(135deg, #f59e0b, #d97706)",
    "linear-gradient(135deg, #ec4899, #be185d)",
    "linear-gradient(135deg, #22c55e, #15803d)",
  ];
  return palette[Math.abs(hash) % palette.length];
}

export default function AssignPmButton({
  projectId,
  currentPmName,
  currentPmUserId,
  orgId,
}: Props) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pmName, setPmName] = useState(currentPmName?.trim() || "Unassigned");
  const [pmUserId, setPmUserId] = useState<string | null>(currentPmUserId ?? null);

  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPmName(currentPmName?.trim() || "Unassigned");
  }, [currentPmName]);

  useEffect(() => {
    setPmUserId(currentPmUserId ?? null);
  }, [currentPmUserId]);

  useEffect(() => {
    if (!open || members.length > 0) return;

    let cancelled = false;
    setLoading(true);

    fetch(`/api/org/members?orgId=${encodeURIComponent(orgId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.members)) {
          setMembers(d.members);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, orgId, members.length]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }

    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return members;

    return members.filter((m) => {
      const roleLabel = safeRoleLabel(m);
      return (
        (m.name || "").toLowerCase().includes(q) ||
        (m.email || "").toLowerCase().includes(q) ||
        roleLabel.toLowerCase().includes(q)
      );
    });
  }, [members, search]);

  async function assign(member: Member) {
    setSaving(true);
    try {
      const nextName = member.name?.trim() || member.email || "Unassigned";

      const res = await fetch("/api/projects/assign-pm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          project_id: projectId,
          pm_user_id: member.user_id,
          pm_name: nextName,
        }),
      });

      if (!res.ok) return;

      setPmName(nextName);
      setPmUserId(member.user_id);
      setOpen(false);
      setSearch("");
      router.refresh();
    } catch {
      //
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
        cache: "no-store",
        body: JSON.stringify({
          project_id: projectId,
          pm_user_id: null,
          pm_name: null,
        }),
      });

      if (!res.ok) return;

      setPmName("Unassigned");
      setPmUserId(null);
      setOpen(false);
      setSearch("");
      router.refresh();
    } catch {
      //
    } finally {
      setSaving(false);
    }
  }

  const displayName = pmName?.trim() || "Unassigned";

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: saving ? "wait" : "pointer",
          color: displayName === "Unassigned" ? "#94a3b8" : "#2563eb",
          fontWeight: 500,
          fontSize: 13,
          fontFamily: "inherit",
          textDecoration: displayName === "Unassigned" ? "underline dotted" : "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          opacity: saving ? 0.7 : 1,
          minWidth: 80,
        }}
      >
        {saving ? "Saving…" : displayName}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.45, flexShrink: 0 }}>
          <path
            d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 300,
            width: 340,
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 14,
            boxShadow: "0 14px 40px rgba(15,23,42,0.14)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid #f1f5f9",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#fcfdff",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="#94a3b8" strokeWidth="2" />
              <path d="m21 21-4.35-4.35" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
            </svg>

            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                fontSize: 13,
                color: "#0f172a",
                fontFamily: "inherit",
                background: "transparent",
              }}
            />

            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "#94a3b8",
                  fontSize: 16,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>

          <div style={{ maxHeight: 300, overflowY: "auto", background: "#fff" }}>
            {loading ? (
              <div style={{ padding: "18px 16px", fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
                Loading members...
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "18px 16px", fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
                {members.length === 0 ? "No members found" : "No matches"}
              </div>
            ) : (
              filtered.map((m) => {
                const selected = m.user_id === pmUserId;
                const label = m.name?.trim() || m.email || m.user_id.slice(0, 8);
                const roleLabel = safeRoleLabel(m);
                const initials = initialsFromName(label);

                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => assign(m)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "11px 14px",
                      border: "none",
                      background: selected ? "#eff6ff" : "#ffffff",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      borderBottom: "1px solid #f8fafc",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = selected ? "#eff6ff" : "#f8fafc";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = selected ? "#eff6ff" : "#ffffff";
                    }}
                  >
                    {m.avatar_url ? (
                      <img
                        src={m.avatar_url}
                        alt={label}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: "50%",
                          objectFit: "cover",
                          flexShrink: 0,
                          border: "1px solid #e2e8f0",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#ffffff",
                          fontSize: 12,
                          fontWeight: 700,
                          flexShrink: 0,
                          background: avatarBg(label || m.user_id),
                          border: "1px solid rgba(255,255,255,0.15)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15)",
                        }}
                      >
                        {initials}
                      </div>
                    )}

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#0f172a",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </span>

                        {selected && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              background: "#dbeafe",
                              color: "#2563eb",
                              padding: "2px 6px",
                              borderRadius: 999,
                              flexShrink: 0,
                            }}
                          >
                            Current
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        {roleLabel && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#475569",
                              fontWeight: 500,
                            }}
                          >
                            {roleLabel}
                          </span>
                        )}

                        {roleLabel && m.email && (
                          <span style={{ fontSize: 10, color: "#cbd5e1" }}>•</span>
                        )}

                        {m.email && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#94a3b8",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {m.email}
                          </span>
                        )}
                      </div>
                    </div>

                    {selected && (
                      <div style={{ flexShrink: 0, color: "#2563eb" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path
                            d="m20 6-11 11-5-5"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {pmUserId && (
            <div
              style={{
                borderTop: "1px solid #f1f5f9",
                padding: "10px 12px",
                background: "#fcfcfd",
              }}
            >
              <button
                type="button"
                onClick={unassign}
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: "1px solid #fee2e2",
                  borderRadius: 10,
                  background: "#fef2f2",
                  color: "#dc2626",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
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