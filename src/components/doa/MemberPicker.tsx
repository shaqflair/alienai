// src/components/doa/MemberPicker.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Member = {
  userId: string;
  name: string;
  email?: string;
  role?: string;
};

export default function MemberPicker({
  projectId,
  value,
  onChange,
  placeholder = "Select approver…",
}: {
  projectId: string;
  value?: Member | null;
  onChange: (m: Member | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [q, setQ] = useState("");

  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const el = e.target as Node;
      if (!boxRef.current) return;
      if (!boxRef.current.contains(el)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!projectId) return;
      setLoading(true);
      try {
        const url = new URL("/api/projects/members", window.location.origin);
        url.searchParams.set("projectId", projectId);

        const res = await fetch(url.toString(), { method: "GET" });
        const json = await res.json().catch(() => ({}));
        if (!cancelled) {
          setMembers(Array.isArray(json?.members) ? json.members : []);
        }
      } catch {
        if (!cancelled) setMembers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return members;
    return members.filter((m) => {
      const hay = `${m.name} ${m.email ?? ""} ${m.role ?? ""}`.toLowerCase();
      return hay.includes(t);
    });
  }, [members, q]);

  const label = value?.name || value?.email || "";

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(18,18,26,0.6)",
          color: "rgba(255,255,255,0.92)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ opacity: label ? 1 : 0.7 }}>{label || placeholder}</span>
          <span style={{ opacity: 0.6 }}>{open ? "▴" : "▾"}</span>
        </div>
        {value?.email ? (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            {value.email} {value.role ? `• ${value.role}` : ""}
          </div>
        ) : value?.role ? (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{value.role}</div>
        ) : null}
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 50,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(12,12,18,0.98)",
            boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={loading ? "Loading…" : "Search name, email, role…"}
              style={{
                width: "100%",
                padding: "10px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.92)",
                outline: "none",
              }}
            />
          </div>

          <div style={{ maxHeight: 280, overflow: "auto" }}>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                background: "transparent",
                color: "rgba(255,255,255,0.8)",
                border: "none",
                cursor: "pointer",
              }}
            >
              Clear selection
            </button>

            <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />

            {filtered.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.75 }}>No members found.</div>
            ) : (
              filtered.map((m) => {
                const selected = value?.userId === m.userId;
                return (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => {
                      onChange(m);
                      setOpen(false);
                      setQ("");
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      background: selected ? "rgba(125, 90, 255, 0.18)" : "transparent",
                      color: "rgba(255,255,255,0.92)",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{m.role || ""}</div>
                    </div>
                    {m.email ? <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{m.email}</div> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
