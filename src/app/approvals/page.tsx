// src/app/approvals/page.tsx — Control Centre v2
// Tabs: Overview · PM Performance · Bottlenecks · At Risk Predictor
//
// ✅ FIX: Never crash the page if executive APIs 404/500 or return non-JSON
// ✅ FIX: /api/executive/projects payload differences handled (projects/items; name/title)
// ✅ FIX: PM cards tolerate missing nested fields safely (decisions/project_list)
// ✅ FIX: Shows lightweight inline error banners instead of “Application error”

"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  ShieldCheck,
  Users,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  Layers,
  ChevronDown,
  X,
  BarChart2,
  Flame,
  Activity,
  RefreshCw,
  UserCheck,
  Zap,
  FileText,
  Download,
  ExternalLink,
  Calendar,
} from "lucide-react";
import { m, LazyMotion, domAnimation, AnimatePresence } from "framer-motion";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Rag = "R" | "A" | "G";
type Tab = "overview" | "pm" | "bottlenecks" | "atrisk" | "digest";
type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

interface RiskSignal {
  key: string;
  label: string;
  detail: string;
  score: number;
  triggered: boolean;
}
interface ProjectRisk {
  project_id: string;
  project_code: string | null;
  project_title: string | null;
  risk_score: number;
  risk_level: RiskLevel;
  signals: RiskSignal[];
  days_since_activity: number | null;
  overdue_steps: number;
  rejection_rate: number | null;
  total_decisions: number;
}

interface PmItem {
  user_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  color: string;
  projects_managed: number;
  project_list: { id: string; title: string | null; project_code: string | null }[];
  decisions: { approved: number; rejected: number; total: number; approval_rate: number | null };
  pending_as_approver: number;
  overdue_items: number;
  rag: Rag;
}

interface CacheItem {
  project_id: string;
  project_title: string | null;
  project_code: string | null;
  approver_label: string | null;
  sla_status: string;
  window_days: number;
}

interface Project {
  id: string;
  title: string | null;
  project_code: string | null;
  project_manager_id: string | null;
}

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background:
    "linear-gradient(145deg,rgba(255,255,255,0.99),rgba(248,250,255,0.97))",
  border: "1px solid rgba(226,232,240,0.8)",
  boxShadow:
    "0 1px 1px rgba(0,0,0,0.02),0 4px 8px rgba(0,0,0,0.03),0 12px 32px rgba(99,102,241,0.06)",
  backdropFilter: "blur(20px) saturate(1.8)",
  borderRadius: 16,
};

const RAG_CFG: Record<
  Rag,
  { dot: string; bg: string; border: string; color: string; label: string }
> = {
  R: {
    dot: "#f43f5e",
    bg: "rgba(255,241,242,0.9)",
    border: "rgba(253,164,175,0.6)",
    color: "#9f1239",
    label: "At Risk",
  },
  A: {
    dot: "#f59e0b",
    bg: "rgba(255,251,235,0.9)",
    border: "rgba(252,211,77,0.6)",
    color: "#92400e",
    label: "Monitor",
  },
  G: {
    dot: "#10b981",
    bg: "rgba(236,253,245,0.9)",
    border: "rgba(110,231,183,0.6)",
    color: "#065f46",
    label: "On Track",
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const ss = (x: any) => (typeof x === "string" ? x : x == null ? "" : String(x));

function initials(name: string) {
  return (
    name
      .split(" ")
      .map((w) => w[0] || "")
      .join("")
      .toUpperCase()
      .slice(0, 2) || "??"
  );
}

/**
 * ✅ Critical hardening: tolerate 404/500 + non-JSON bodies without throwing.
 * Returns { ok:false, status, error } when it can't parse JSON.
 */
async function fetchJsonSafe(
  url: string,
  init?: RequestInit
): Promise<any & { ok?: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(url, init);
    const status = res.status;

    // Some 500s return HTML — json() would throw. Read text first.
    const txt = await res.text();
    try {
      const j = txt ? JSON.parse(txt) : {};
      // Preserve HTTP error if server didn't include ok flag
      if (typeof j?.ok !== "boolean" && !res.ok) {
        return { ok: false, status, error: `HTTP ${status}` };
      }
      return { ...j, status };
    } catch {
      // Non JSON
      return {
        ok: false,
        status,
        error: txt?.slice(0, 160) || `HTTP ${status}`,
      };
    }
  } catch (e: any) {
    return { ok: false, status: 0, error: ss(e?.message) || "Network error" };
  }
}

function RagBadge({ rag }: { rag: Rag }) {
  const c = RAG_CFG[rag];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        borderRadius: 20,
        padding: "2px 9px",
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.color,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: c.dot,
        }}
      />
      {c.label}
    </span>
  );
}

function Avatar({
  name,
  color,
  url,
  size = 36,
}: {
  name: string;
  color: string;
  url?: string | null;
  size?: number;
}) {
  if (url)
    return (
      <img
        src={url}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          border: "2px solid rgba(255,255,255,0.8)",
        }}
      />
    );
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `linear-gradient(135deg,${color},${color}bb)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.33,
        fontWeight: 700,
        color: "white",
        border: "2px solid rgba(255,255,255,0.8)",
        flexShrink: 0,
        boxShadow: `0 2px 8px ${color}44`,
      }}
    >
      {initials(name)}
    </div>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "8px 12px",
        borderRadius: 10,
        background: "rgba(248,250,255,0.8)",
        border: "1px solid rgba(226,232,240,0.6)",
      }}
    >
      <div
        style={{
          fontFamily: "'DM Mono',monospace",
          fontSize: 18,
          fontWeight: 700,
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9,
          color: "#94a3b8",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginTop: 3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ErrorBanner({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      style={{
        ...CARD,
        padding: "12px 14px",
        border: "1px solid rgba(253,164,175,0.5)",
        background: "rgba(255,241,242,0.75)",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <AlertTriangle size={16} color="#e11d48" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#9f1239" }}>
            {title}
          </div>
          {detail ? (
            <div
              style={{
                fontSize: 11,
                color: "#64748b",
                marginTop: 4,
                lineHeight: 1.35,
              }}
            >
              {detail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── APPROVAL DONUT ───────────────────────────────────────────────────────────

function ApprovalDonut({
  approved,
  rejected,
  size = 56,
}: {
  approved: number;
  rejected: number;
  size?: number;
}) {
  const total = approved + rejected;
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const approvedPct = total > 0 ? approved / total : 0;
  const approvedDash = approvedPct * circ;
  const cx = size / 2,
    cy = size / 2;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgba(241,245,249,0.9)"
        strokeWidth={6}
      />
      {total > 0 && (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#10b981"
            strokeWidth={6}
            strokeDasharray={`${approvedDash} ${circ - approvedDash}`}
            strokeLinecap="round"
          />
          {rejected > 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#f43f5e"
              strokeWidth={6}
              strokeDasharray={`${(rejected / total) * circ} ${
                circ - (rejected / total) * circ
              }`}
              strokeDashoffset={-approvedDash}
              strokeLinecap="round"
            />
          )}
        </>
      )}
    </svg>
  );
}

// ─── PM CARD ─────────────────────────────────────────────────────────────────

function PmCard({
  pm,
  idx,
  projects,
  onAssignProject,
}: {
  pm: PmItem;
  idx: number;
  projects: Project[];
  onAssignProject: (pmId: string, projectId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // ✅ tolerate missing nested fields
  const decisions = pm?.decisions ?? {
    approved: 0,
    rejected: 0,
    total: 0,
    approval_rate: null,
  };
  const plist = Array.isArray(pm?.project_list) ? pm.project_list : [];

  const total = decisions.total ?? 0;
  const rate = decisions.approval_rate;

  return (
    <m.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.38,
        delay: idx * 0.07,
        ease: [0.16, 1, 0.3, 1],
      }}
      style={{ ...CARD, position: "relative", overflow: "hidden" }}
    >
      {/* Left accent */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "15%",
          bottom: "15%",
          width: 3,
          borderRadius: "0 2px 2px 0",
          background: pm.color,
          boxShadow: `0 0 10px ${pm.color}55`,
        }}
      />

      <div style={{ padding: "16px 16px 16px 20px" }}>
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <Avatar name={pm.full_name} color={pm.color} url={pm.avatar_url} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#0f172a",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {pm.full_name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#94a3b8",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {pm.email}
            </div>
          </div>
          <RagBadge rag={pm.rag} />
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 8,
            marginBottom: 14,
          }}
        >
          <StatPill label="Projects" value={pm.projects_managed ?? 0} color="#6366f1" />
          <StatPill
            label="Overdue"
            value={pm.overdue_items ?? 0}
            color={(pm.overdue_items ?? 0) > 0 ? "#e11d48" : "#10b981"}
          />
          <StatPill label="Approved" value={decisions.approved ?? 0} color="#10b981" />
          <StatPill
            label="Rejected"
            value={decisions.rejected ?? 0}
            color={(decisions.rejected ?? 0) > 0 ? "#f43f5e" : "#94a3b8"}
          />
        </div>

        {/* Approval rate bar */}
        {total > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 5,
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b" }}>
                Approval rate
              </span>
              <span
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  color: rate != null && rate >= 70 ? "#10b981" : "#f43f5e",
                }}
              >
                {rate ?? 0}%
              </span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 4,
                background: "rgba(241,245,249,0.9)",
                overflow: "hidden",
                display: "flex",
              }}
            >
              <m.div
                initial={{ width: 0 }}
                animate={{ width: `${rate ?? 0}%` }}
                transition={{ duration: 0.8, delay: idx * 0.07 + 0.2 }}
                style={{
                  height: "100%",
                  background:
                    rate != null && rate >= 70
                      ? "linear-gradient(90deg,#10b981,#34d399)"
                      : "linear-gradient(90deg,#f59e0b,#fbbf24)",
                  borderRadius: 4,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 3,
                fontSize: 9,
                color: "#94a3b8",
              }}
            >
              <span>✅ {decisions.approved ?? 0} approved</span>
              <span>❌ {decisions.rejected ?? 0} rejected</span>
            </div>
          </div>
        )}

        {/* Pending badge */}
        {(pm.pending_as_approver ?? 0) > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 10,
              padding: "6px 10px",
              borderRadius: 8,
              background: "rgba(255,251,235,0.8)",
              border: "1px solid rgba(252,211,77,0.5)",
            }}
          >
            <Clock size={12} color="#d97706" />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#92400e" }}>
              {pm.pending_as_approver} pending approval
              {pm.pending_as_approver !== 1 ? "s" : ""} awaiting this user
            </span>
          </div>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 0",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            color: "#6366f1",
          }}
        >
          <span>
            {expanded ? "Hide" : "Show"} projects ({plist.length})
          </span>
          <ChevronDown
            size={14}
            style={{
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }}
          />
        </button>

        {/* Expanded project list */}
        <AnimatePresence>
          {expanded && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              style={{ overflow: "hidden" }}
            >
              <div
                style={{
                  paddingTop: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {plist.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 8,
                      background: "rgba(238,242,255,0.6)",
                      border: "1px solid rgba(199,210,254,0.4)",
                    }}
                  >
                    {p.project_code && (
                      <span
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#4338ca",
                          background: "rgba(238,242,255,0.8)",
                          border: "1px solid rgba(199,210,254,0.6)",
                          borderRadius: 4,
                          padding: "1px 5px",
                        }}
                      >
                        {p.project_code}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#374151",
                        flex: 1,
                      }}
                    >
                      {p.title || "Untitled"}
                    </span>
                  </div>
                ))}
                {plist.length === 0 && (
                  <div style={{ fontSize: 11, color: "#94a3b8", padding: "4px 0" }}>
                    No projects assigned yet
                  </div>
                )}

                {/* Assign project dropdown */}
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => setAssigning((a) => !a)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px dashed rgba(99,102,241,0.4)",
                      background: "rgba(238,242,255,0.4)",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6366f1",
                    }}
                  >
                    <UserCheck size={12} /> Assign a project
                  </button>
                  {assigning && (
                    <div
                      style={{
                        marginTop: 6,
                        borderRadius: 10,
                        border: "1px solid rgba(226,232,240,0.8)",
                        background: "rgba(255,255,255,0.95)",
                        overflow: "hidden",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                      }}
                    >
                      {projects
                        .filter((p) => p.project_manager_id !== pm.user_id)
                        .map((p) => (
                          <div
                            key={p.id}
                            onClick={() => {
                              onAssignProject(pm.user_id, p.id);
                              setAssigning(false);
                            }}
                            style={{
                              padding: "8px 12px",
                              cursor: "pointer",
                              fontSize: 12,
                              color: "#374151",
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              borderBottom: "1px solid rgba(226,232,240,0.4)",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.background =
                                "rgba(238,242,255,0.6)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.background = "transparent")
                            }
                          >
                            {p.project_code && (
                              <span
                                style={{
                                  fontFamily: "'DM Mono',monospace",
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color: "#4338ca",
                                }}
                              >
                                {p.project_code}
                              </span>
                            )}
                            <span>{p.title || "Untitled"}</span>
                          </div>
                        ))}
                      {projects.filter((p) => p.project_manager_id !== pm.user_id)
                        .length === 0 && (
                        <div
                          style={{
                            padding: "8px 12px",
                            fontSize: 11,
                            color: "#94a3b8",
                          }}
                        >
                          All projects already assigned
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </m.div>
  );
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────────────────────

function OverviewTab({
  cacheItems,
  loading,
}: {
  cacheItems: CacheItem[];
  loading: boolean;
}) {
  const counts = useMemo(() => {
    let pending = 0,
      at_risk = 0,
      breached = 0;
    for (const it of cacheItems) {
      const s = ss(it?.sla_status).toLowerCase();
      if (s === "overdue" || s === "breached" || s === "overdue_undecided")
        breached++;
      else if (s === "warn" || s === "at_risk") at_risk++;
      else pending++;
    }
    return { pending, at_risk, breached, total: cacheItems.length };
  }, [cacheItems]);

  const byProject = useMemo(() => {
    const map = new Map<
      string,
      {
        title: string | null;
        code: string | null;
        count: number;
        breached: number;
        at_risk: number;
      }
    >();
    for (const it of cacheItems) {
      const pid = ss(it?.project_id);
      if (!pid) continue;
      const s = ss(it?.sla_status).toLowerCase();
      let p = map.get(pid);
      if (!p) {
        p = {
          title: it.project_title,
          code: it.project_code,
          count: 0,
          breached: 0,
          at_risk: 0,
        };
        map.set(pid, p);
      }
      p.count++;
      if (s === "overdue" || s === "breached" || s === "overdue_undecided")
        p.breached++;
      else if (s === "warn" || s === "at_risk") p.at_risk++;
    }
    return Array.from(map.values()).sort(
      (a, b) => b.breached - a.breached || b.at_risk - a.at_risk
    );
  }, [cacheItems]);

  if (loading)
    return (
      <div
        style={{
          padding: "40px 0",
          textAlign: "center",
          color: "#94a3b8",
          fontSize: 13,
        }}
      >
        Loading overview...
      </div>
    );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {/* Summary cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            color: "#94a3b8",
            marginBottom: 4,
          }}
        >
          Portfolio Summary
        </div>
        {[
          {
            label: "Total Pending",
            value: counts.total,
            color: "#6366f1",
            icon: <Clock size={16} color="#6366f1" />,
          },
          {
            label: "SLA Breached",
            value: counts.breached,
            color: "#e11d48",
            icon: <Flame size={16} color="#e11d48" />,
          },
          {
            label: "At Risk",
            value: counts.at_risk,
            color: "#d97706",
            icon: <AlertTriangle size={16} color="#d97706" />,
          },
          {
            label: "Within SLA",
            value: counts.pending,
            color: "#10b981",
            icon: <CheckCircle2 size={16} color="#10b981" />,
          },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              ...CARD,
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: `${s.color}15`,
                border: `1px solid ${s.color}30`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {s.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 22,
                  fontWeight: 700,
                  color: s.color,
                  lineHeight: 1.2,
                }}
              >
                {s.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* By project */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            color: "#94a3b8",
            marginBottom: 12,
          }}
        >
          By Project
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {byProject.length === 0 && (
            <div style={{ fontSize: 13, color: "#94a3b8", padding: "20px 0" }}>
              No data
            </div>
          )}
          {byProject.map((p, i) => {
            const rag: Rag = p.breached > 0 ? "R" : p.at_risk > 0 ? "A" : "G";
            return (
              <div
                key={i}
                style={{
                  ...CARD,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 3,
                    }}
                  >
                    {p.code && (
                      <span
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#4338ca",
                          background: "rgba(238,242,255,0.8)",
                          border: "1px solid rgba(199,210,254,0.6)",
                          borderRadius: 4,
                          padding: "1px 5px",
                        }}
                      >
                        {p.code}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#0f172a",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.title || "Untitled"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>
                    {p.count} pending · {p.breached} breached · {p.at_risk} at risk
                  </div>
                </div>
                <RagBadge rag={rag} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── BOTTLENECKS TAB ──────────────────────────────────────────────────────────

function BottlenecksTab({
  cacheItems,
  loading,
}: {
  cacheItems: CacheItem[];
  loading: boolean;
}) {
  const bottlenecks = useMemo(() => {
    const map = new Map<
      string,
      { label: string; count: number; breached: number; projects: Set<string> }
    >();
    for (const it of cacheItems) {
      const label = ss(it?.approver_label).trim();
      if (!label || label === "—") continue;
      const s = ss(it?.sla_status).toLowerCase();
      let b = map.get(label);
      if (!b) {
        b = { label, count: 0, breached: 0, projects: new Set() };
        map.set(label, b);
      }
      b.count++;
      if (s === "overdue" || s === "breached" || s === "overdue_undecided")
        b.breached++;
      if (it.project_id) b.projects.add(it.project_id);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.breached - a.breached || b.count - a.count
    );
  }, [cacheItems]);

  const maxCount = bottlenecks.length
    ? Math.max(...bottlenecks.map((b) => b.count))
    : 1;

  if (loading)
    return (
      <div
        style={{
          padding: "40px 0",
          textAlign: "center",
          color: "#94a3b8",
          fontSize: 13,
        }}
      >
        Loading bottlenecks...
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {bottlenecks.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <Activity size={32} color="#cbd5e1" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>
            No bottlenecks detected
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            All approvals flowing freely
          </div>
        </div>
      )}
      {bottlenecks.map((b, i) => {
        const pct = Math.max(8, (b.count / maxCount) * 100);
        const heat: Rag = b.breached >= 3 ? "R" : b.breached >= 1 ? "A" : "G";
        const rc = RAG_CFG[heat];
        return (
          <m.div
            key={i}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
            style={{ ...CARD, position: "relative", overflow: "hidden" }}
          >
            <m.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, delay: i * 0.06 + 0.1 }}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                background: rc.dot,
                opacity: 0.06,
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "relative",
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: `${rc.dot}15`,
                  border: `1px solid ${rc.dot}30`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Users size={16} color={rc.dot} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#0f172a",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginBottom: 3,
                  }}
                >
                  {b.label}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>
                  {b.count} pending · {b.breached} breached · {b.projects.size}{" "}
                  project{b.projects.size !== 1 ? "s" : ""}
                </div>
              </div>
              <RagBadge rag={heat} />
            </div>
          </m.div>
        );
      })}
    </div>
  );
}

// ─── AT RISK TAB ─────────────────────────────────────────────────────────────

const RISK_CFG: Record<
  RiskLevel,
  { dot: string; bg: string; border: string; color: string; label: string; barColor: string }
> = {
  HIGH: {
    dot: "#f43f5e",
    bg: "rgba(255,241,242,0.92)",
    border: "rgba(253,164,175,0.6)",
    color: "#9f1239",
    label: "High Risk",
    barColor: "#f43f5e",
  },
  MEDIUM: {
    dot: "#f59e0b",
    bg: "rgba(255,251,235,0.92)",
    border: "rgba(252,211,77,0.6)",
    color: "#92400e",
    label: "Medium Risk",
    barColor: "#f59e0b",
  },
  LOW: {
    dot: "#10b981",
    bg: "rgba(236,253,245,0.92)",
    border: "rgba(110,231,183,0.6)",
    color: "#065f46",
    label: "Low Risk",
    barColor: "#10b981",
  },
};

function RiskScoreBar({ score, level }: { score: number; risk_level?: RiskLevel; level: RiskLevel }) {
  const cfg = RISK_CFG[level];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 4,
          background: "rgba(241,245,249,0.9)",
          overflow: "hidden",
        }}
      >
        <m.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          style={{ height: "100%", borderRadius: 4, background: cfg.barColor }}
        />
      </div>
      <span
        style={{
          fontFamily: "'DM Mono',monospace",
          fontSize: 11,
          fontWeight: 700,
          color: cfg.color,
          minWidth: 30,
          textAlign: "right",
        }}
      >
        {score}
      </span>
    </div>
  );
}

function SignalRow({ signal }: { signal: RiskSignal }) {
  const triggered = signal.triggered;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px solid rgba(226,232,240,0.4)",
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          flexShrink: 0,
          marginTop: 1,
          background: triggered ? "rgba(244,63,94,0.12)" : "rgba(16,185,129,0.12)",
          border: `1px solid ${
            triggered ? "rgba(244,63,94,0.3)" : "rgba(16,185,129,0.3)"
          }`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
        }}
      >
        {triggered ? "!" : "✓"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: triggered ? "#9f1239" : "#065f46",
          }}
        >
          {signal.label}
        </div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
          {signal.detail}
        </div>
      </div>
      {triggered && (
        <div
          style={{
            fontFamily: "'DM Mono',monospace",
            fontSize: 10,
            fontWeight: 700,
            color: "#f43f5e",
            flexShrink: 0,
          }}
        >
          +{signal.score}
        </div>
      )}
    </div>
  );
}

function RiskCard({ item, idx }: { item: ProjectRisk; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = RISK_CFG[item.risk_level];

  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
      style={{ ...CARD, position: "relative", overflow: "hidden" }}
    >
      {/* left accent */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "15%",
          bottom: "15%",
          width: 3,
          borderRadius: "0 2px 2px 0",
          background: cfg.dot,
          boxShadow: `0 0 8px ${cfg.dot}55`,
        }}
      />

      <div style={{ padding: "14px 16px 14px 20px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              {item.project_code && (
                <span
                  style={{
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#4338ca",
                    background: "rgba(238,242,255,0.8)",
                    border: "1px solid rgba(199,210,254,0.6)",
                    borderRadius: 4,
                    padding: "1px 5px",
                  }}
                >
                  {item.project_code}
                </span>
              )}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#0f172a",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.project_title || "Untitled Project"}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>
              {[
                item.overdue_steps > 0 &&
                  `${item.overdue_steps} overdue step${item.overdue_steps !== 1 ? "s" : ""}`,
                item.days_since_activity != null && `${item.days_since_activity}d since activity`,
                item.rejection_rate != null && `${item.rejection_rate}% rejection rate`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              borderRadius: 20,
              padding: "3px 9px",
              fontSize: 9,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
              color: cfg.color,
              flexShrink: 0,
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.dot }} />
            {cfg.label}
          </span>
        </div>

        {/* Risk score bar */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b" }}>Risk Score</span>
            <span style={{ fontSize: 9, color: "#94a3b8" }}>
              {item.signals.filter((s) => s.triggered).length} of {item.signals.length} signals triggered
            </span>
          </div>
          <RiskScoreBar score={item.risk_score} level={item.risk_level} />
        </div>

        {/* Triggered signals summary chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {item.signals
            .filter((s) => s.triggered)
            .map((s) => (
              <span
                key={s.key}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 8,
                  padding: "2px 8px",
                  fontSize: 9,
                  fontWeight: 600,
                  background: "rgba(255,241,242,0.8)",
                  border: "1px solid rgba(253,164,175,0.4)",
                  color: "#9f1239",
                }}
              >
                ⚠ {s.label}
              </span>
            ))}
          {item.signals.filter((s) => s.triggered).length === 0 && (
            <span style={{ fontSize: 10, color: "#10b981", fontWeight: 600 }}>
              ✓ No risk signals triggered
            </span>
          )}
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "5px 0",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 600,
            color: "#6366f1",
          }}
        >
          <span>{expanded ? "Hide" : "Show"} signal breakdown</span>
          <ChevronDown
            size={13}
            style={{
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }}
          />
        </button>

        <AnimatePresence>
          {expanded && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              style={{ overflow: "hidden" }}
            >
              <div style={{ paddingTop: 8 }}>
                {item.signals.map((s) => (
                  <SignalRow key={s.key} signal={s} />
                ))}
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </m.div>
  );
}

function AtRiskTab() {
  const [data, setData] = useState<{
    items: ProjectRisk[];
    summary: { total: number; high: number; medium: number; low: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | RiskLevel>("ALL");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);

    fetchJsonSafe("/api/executive/projects/at-risk", {
      credentials: "include",
      cache: "no-store",
    })
      .then((j) => {
        if (!alive) return;
        if (j?.ok) {
          setData({
            items: j.items ?? [],
            summary: j.summary ?? { total: 0, high: 0, medium: 0, low: 0 },
          });
        } else {
          setData({ items: [], summary: { total: 0, high: 0, medium: 0, low: 0 } });
          setErr(j?.error || "At-risk endpoint unavailable");
        }
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    if (filter === "ALL") return data.items;
    return data.items.filter((i) => i.risk_level === filter);
  }, [data, filter]);

  if (loading)
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
        Analysing project risk signals...
      </div>
    );

  const summary = data?.summary ?? { total: 0, high: 0, medium: 0, low: 0 };

  return (
    <div>
      {err && <ErrorBanner title="At Risk Predictor is temporarily unavailable" detail={err} />}

      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Projects", value: summary.total, color: "#6366f1" },
          { label: "High Risk", value: summary.high, color: "#e11d48" },
          { label: "Medium Risk", value: summary.medium, color: "#d97706" },
          { label: "Low Risk", value: summary.low, color: "#10b981" },
        ].map((s, i) => (
          <div key={i} style={{ ...CARD, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 28, fontWeight: 700, color: s.color, lineHeight: 1 }}>
              {s.value}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#94a3b8",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginTop: 5,
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: