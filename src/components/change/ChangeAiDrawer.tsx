"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Utility functions (preserved from your original)
function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function isObj(x: any): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function tryJsonParse<T = any>(x: any): T | null {
  if (typeof x !== "string") return null;
  const s = x.trim();
  if (!s) return null;
  if (!(s.startsWith("{") || s.startsWith("["))) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function toObj(x: any): Record<string, any> {
  if (isObj(x)) return x;
  const parsed = tryJsonParse<Record<string, any>>(x);
  return parsed && isObj(parsed) ? parsed : {};
}

function toArr<T = any>(x: any): T[] {
  if (Array.isArray(x)) return x as T[];
  const parsed = tryJsonParse<any[]>(x);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function fmtWhen(x: any): string {
  const s = safeStr(x).trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function apiGet(url: string) {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) {
    throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  }
  return json;
}

async function apiPost(url: string, body?: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) {
    throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  }
  return json;
}

// Types
type AiSummary = {
  headline?: string;
  schedule?: string;
  cost?: string;
  scope?: string;
  risk?: string;
  next_action?: string;
};

type Alternative = {
  title?: string;
  summary?: string;
  tradeoff?: string;
};

// CSS Module styles object (inline for now to avoid file confusion)
const styles = {
  overlay: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 50,
    backgroundColor: "rgba(2, 6, 23, 0.4)",
    backdropFilter: "blur(4px)",
  },
  drawer: {
    position: "fixed" as const,
    right: 0,
    top: 0,
    height: "100%",
    width: "100%",
    maxWidth: "672px",
    backgroundColor: "white",
    boxShadow: "-20px 0 50px rgba(0,0,0,0.2)",
    display: "flex",
    flexDirection: "column" as const,
    zIndex: 51, // ✅ ensure above overlay
  },
  header: {
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
    borderBottom: "1px solid #e2e8f0",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    backdropFilter: "blur(12px)",
    padding: "16px 24px",
  },
  content: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "24px",
  },
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 16px",
    backgroundColor: "#4f46e5",
    color: "white",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 16px",
    backgroundColor: "white",
    color: "#475569",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  headlineCard: {
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    color: "white",
    padding: "24px",
    borderRadius: "16px",
    marginBottom: "20px",
    position: "relative" as const,
    overflow: "hidden",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "12px",
    marginBottom: "20px",
  },
  insightCard: {
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "16px",
    backgroundColor: "white",
  },
  alternativeCard: {
    position: "relative" as const,
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "16px 16px 16px 20px",
    backgroundColor: "white",
    marginBottom: "12px",
    overflow: "hidden",
  },
  accentBorder: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    bottom: 0,
    width: "4px",
    background: "linear-gradient(to bottom, #4f46e5, #7c3aed)",
  },
  error: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: "#fee2e2",
    color: "#991b1b",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px",
  },
  emptyState: {
    textAlign: "center" as const,
    padding: "48px 24px",
    border: "2px dashed #e2e8f0",
    borderRadius: "16px",
    backgroundColor: "#f8fafc",
  },
  spinnerLight: {
    width: "16px",
    height: "16px",
    border: "2px solid rgba(255,255,255,0.3)",
    borderRadius: "50%",
    borderTopColor: "white",
    animation: "spin 1s linear infinite",
  },
  spinnerDark: {
    width: "16px",
    height: "16px",
    border: "2px solid rgba(0,0,0,0.1)",
    borderRadius: "50%",
    borderTopColor: "#475569",
    animation: "spin 1s linear infinite",
  },
};

// ✅ small helper for robust "high" detection
function looksHigh(s: any) {
  return safeStr(s).toLowerCase().includes("high");
}

export default function ChangeAiDrawer({
  open,
  onClose,
  projectId,
  changeId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  changeId: string;
  title?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [ai, setAi] = useState<AiSummary | null>(null);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [meta, setMeta] = useState<{ model?: string; updated_at?: string; rationale?: string } | null>(null);

  const drawerTitle = useMemo(() => safeStr(title).trim() || "Change request", [title]);

  const unpackFromGetRoute = useCallback((j: any) => {
    const root = toObj(j);
    const item = root.item;

    if (!item) {
      setAi(null);
      setAlternatives([]);
      setMeta(null);
      return;
    }

    const it = toObj(item);
    const summaryObj = toObj(it.summary);
    const altsArr = toArr<Alternative>(it.alternatives);

    setAi(Object.keys(summaryObj).length ? (summaryObj as AiSummary) : null);
    setAlternatives(altsArr);

    setMeta({
      model: safeStr(it.model) || undefined,
      updated_at: safeStr(it.updated_at) || undefined,
      rationale: safeStr(it.rationale) || undefined,
    });
  }, []);

  const fetchLatest = useCallback(async () => {
    if (!changeId) return;
    setErr("");
    setLoading(true);
    try {
      const j = await apiGet(`/api/change/${encodeURIComponent(changeId)}/ai-summary`);
      unpackFromGetRoute(j);
    } catch (e: any) {
      setAi(null);
      setAlternatives([]);
      setMeta(null);
      setErr(safeStr(e?.message) || "Failed to load AI summary");
    } finally {
      setLoading(false);
    }
  }, [changeId, unpackFromGetRoute]);

  const runScan = useCallback(async () => {
    if (!changeId || !projectId) return;
    setErr("");
    setBusy(true);
    try {
      await apiPost("/api/ai/events", {
        projectId,
        artifactId: null,
        eventType: "change_ai_scan_requested",
        severity: "info",
        source: "change_ai_drawer",
        payload: { changeId },
      });
      await fetchLatest();
    } catch (e: any) {
      setErr(safeStr(e?.message) || "AI scan failed");
    } finally {
      setBusy(false);
    }
  }, [changeId, projectId, fetchLatest]);

  useEffect(() => {
    if (!open) return;
    fetchLatest();
  }, [open, changeId, fetchLatest]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // ✅ prevent background scroll when drawer open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const modelTxt = safeStr(meta?.model);
  const updatedTxt = fmtWhen(meta?.updated_at);
  const subtitle =
    modelTxt || updatedTxt ? [modelTxt, updatedTxt ? `Updated ${updatedTxt}` : ""].filter(Boolean).join(" • ") : "";

  // ✅ keep AnimatePresence working (don't early-return null)
  return (
    <>
      {/* inline keyframes for spinner + pulse */}
      <style jsx global>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 0.55;
          }
          50% {
            opacity: 1;
          }
        }
      `}</style>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={styles.overlay}
              onClick={onClose}
            />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              style={styles.drawer}
            >
              {/* Header */}
              <header style={styles.header}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "4px",
                        color: "#4f46e5",
                        fontSize: "12px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      <span>✨</span>
                      AI Analysis
                    </div>
                    <h2
                      style={{
                        fontSize: "20px",
                        fontWeight: 700,
                        color: "#0f172a",
                        margin: 0,
                        marginBottom: "4px",
                      }}
                    >
                      {drawerTitle}
                    </h2>
                    {subtitle && (
                      <div style={{ fontSize: "13px", color: "#64748b", display: "flex", alignItems: "center", gap: "8px" }}>
                        {modelTxt && (
                          <span
                            style={{
                              backgroundColor: "#eef2ff",
                              color: "#4338ca",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              fontSize: "12px",
                              fontWeight: 500,
                            }}
                          >
                            {modelTxt}
                          </span>
                        )}
                        {updatedTxt && <span>Updated {updatedTxt}</span>}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={onClose}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "8px",
                      cursor: "pointer",
                      borderRadius: "8px",
                      color: "#64748b",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#f1f5f9";
                      e.currentTarget.style.color = "#475569";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "#64748b";
                    }}
                    aria-label="Close"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </header>

              {/* Content */}
              <div style={styles.content}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {/* Action Bar */}
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={runScan}
                      disabled={busy || !projectId || !changeId}
                      style={{
                        ...styles.btnPrimary,
                        opacity: busy || !projectId || !changeId ? 0.5 : 1,
                        cursor: busy || !projectId || !changeId ? "not-allowed" : "pointer",
                      }}
                    >
                      {busy ? (
                        <>
                          <span style={styles.spinnerLight} />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <span>🤖</span>
                          Run AI Scan
                        </>
                      )}
                    </motion.button>

                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={fetchLatest}
                      disabled={loading || busy || !changeId}
                      style={{
                        ...styles.btnSecondary,
                        opacity: loading || busy || !changeId ? 0.5 : 1,
                        cursor: loading || busy || !changeId ? "not-allowed" : "pointer",
                      }}
                    >
                      {loading ? (
                        <>
                          <span style={styles.spinnerDark} />
                          Refreshing...
                        </>
                      ) : (
                        "Refresh"
                      )}
                    </motion.button>

                    {err && (
                      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} style={styles.error}>
                        <span>⚠</span>
                        {err}
                      </motion.div>
                    )}
                  </div>

                  {/* Divider */}
                  <div style={{ borderTop: "1px solid #e2e8f0", marginTop: "8px" }} />

                  {/* Main Content */}
                  {loading ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div style={{ height: "80px", backgroundColor: "#f1f5f9", borderRadius: "12px", animation: "pulse 2s infinite" }} />
                      <div style={styles.grid}>
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} style={{ height: "120px", backgroundColor: "#f1f5f9", borderRadius: "12px", animation: "pulse 2s infinite" }} />
                        ))}
                      </div>
                    </div>
                  ) : !ai ? (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={styles.emptyState}>
                      <div style={{ fontSize: "48px", marginBottom: "16px" }}>🤖</div>
                      <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px", color: "#0f172a" }}>No AI Summary Yet</h3>
                      <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "16px" }}>
                        Run an AI scan to analyze this change request for schedule impact, cost, scope, and risks.
                      </p>
                      {meta?.rationale && (
                        <div style={{ backgroundColor: "#fef3c7", color: "#92400e", padding: "12px", borderRadius: "8px", fontSize: "13px" }}>
                          <strong>Note:</strong> {meta.rationale}
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      {/* Headline */}
                      <div style={styles.headlineCard}>
                        <div
                          style={{
                            position: "absolute",
                            top: "-50%",
                            right: "-10%",
                            width: "200px",
                            height: "200px",
                            background: "rgba(255,255,255,0.1)",
                            borderRadius: "50%",
                            filter: "blur(40px)",
                          }}
                        />
                        <div style={{ position: "relative", zIndex: 1 }}>
                          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.8, marginBottom: "8px" }}>
                            Executive Summary
                          </div>
                          <h3 style={{ fontSize: "18px", fontWeight: 700, lineHeight: 1.4, margin: 0 }}>{safeStr(ai.headline) || "Analysis Complete"}</h3>
                        </div>
                      </div>

                      {/* Insights Grid */}
                      <div style={styles.grid}>
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={styles.insightCard}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                            <div style={{ width: "32px", height: "32px", backgroundColor: "#eef2ff", color: "#4f46e5", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>
                              ⏱
                            </div>
                            <h4 style={{ fontWeight: 600, fontSize: "14px", margin: 0 }}>Schedule Impact</h4>
                          </div>
                          <p style={{ fontSize: "13px", lineHeight: 1.5, color: "#475569", margin: 0 }}>{safeStr(ai.schedule) || "No schedule impact detected"}</p>
                        </motion.div>

                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} style={styles.insightCard}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                            <div style={{ width: "32px", height: "32px", backgroundColor: "#fef3c7", color: "#d97706", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>
                              💰
                            </div>
                            <h4 style={{ fontWeight: 600, fontSize: "14px", margin: 0 }}>Cost Analysis</h4>
                          </div>
                          <p style={{ fontSize: "13px", lineHeight: 1.5, color: "#475569", margin: 0 }}>{safeStr(ai.cost) || "No additional costs forecasted"}</p>
                        </motion.div>

                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={styles.insightCard}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                            <div style={{ width: "32px", height: "32px", backgroundColor: "#f0fdf4", color: "#059669", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>
                              🎯
                            </div>
                            <h4 style={{ fontWeight: 600, fontSize: "14px", margin: 0 }}>Scope Changes</h4>
                          </div>
                          <p style={{ fontSize: "13px", lineHeight: 1.5, color: "#475569", margin: 0 }}>{safeStr(ai.scope) || "No scope modifications identified"}</p>
                        </motion.div>

                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.4 }}
                          style={{
                            ...styles.insightCard,
                            backgroundColor: looksHigh(ai.risk) ? "#fef2f2" : "white",
                            borderColor: looksHigh(ai.risk) ? "#fecaca" : "#e2e8f0",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                            <div
                              style={{
                                width: "32px",
                                height: "32px",
                                backgroundColor: looksHigh(ai.risk) ? "#fee2e2" : "#fef2f2",
                                color: looksHigh(ai.risk) ? "#dc2626" : "#ea580c",
                                borderRadius: "8px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "16px",
                              }}
                            >
                              ⚠
                            </div>
                            <h4 style={{ fontWeight: 600, fontSize: "14px", margin: 0 }}>Risk Assessment</h4>
                          </div>
                          <p style={{ fontSize: "13px", lineHeight: 1.5, color: "#475569", margin: 0 }}>{safeStr(ai.risk) || "Low risk profile"}</p>
                        </motion.div>
                      </div>

                      {/* Next Action */}
                      {safeStr(ai.next_action) && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.5 }}
                          style={{
                            backgroundColor: "#eef2ff",
                            border: "1px solid #c7d2fe",
                            borderRadius: "12px",
                            padding: "16px",
                          }}
                        >
                          <div style={{ fontWeight: 600, color: "#4338ca", marginBottom: "6px", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}>
                            → Recommended Next Action
                          </div>
                          <p style={{ color: "#3730a3", fontSize: "14px", lineHeight: 1.5, margin: 0 }}>{safeStr(ai.next_action)}</p>
                        </motion.div>
                      )}

                      {/* Alternatives */}
                      {alternatives.length > 0 && (
                        <div style={{ marginTop: "8px" }}>
                          <h4 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ color: "#059669" }}>✓</span>
                            Alternative Approaches
                          </h4>
                          <div>
                            {alternatives.map((alt, idx) => (
                              <motion.div
                                key={idx}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.6 + idx * 0.1 }}
                                style={styles.alternativeCard}
                              >
                                <div style={styles.accentBorder} />
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                                  <span
                                    style={{
                                      width: "24px",
                                      height: "24px",
                                      backgroundColor: "#eef2ff",
                                      color: "#4f46e5",
                                      borderRadius: "50%",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "12px",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {idx + 1}
                                  </span>
                                  <h5 style={{ fontWeight: 600, fontSize: "14px", margin: 0 }}>{safeStr(alt.title) || `Option ${idx + 1}`}</h5>
                                </div>

                                {safeStr(alt.summary) && (
                                  <p style={{ fontSize: "13px", color: "#475569", marginBottom: "8px", marginTop: 0 }}>{safeStr(alt.summary)}</p>
                                )}

                                {safeStr(alt.tradeoff) && (
                                  <div
                                    style={{
                                      backgroundColor: "#fef3c7",
                                      color: "#92400e",
                                      padding: "10px",
                                      borderRadius: "8px",
                                      fontSize: "12px",
                                      display: "flex",
                                      alignItems: "flex-start",
                                      gap: "6px",
                                    }}
                                  >
                                    <span>⚠</span>
                                    <span>{safeStr(alt.tradeoff)}</span>
                                  </div>
                                )}
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Rationale */}
                      {meta?.rationale && (
                        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "16px", fontSize: "13px", color: "#64748b", marginTop: "8px" }}>
                          <span style={{ fontWeight: 500, color: "#475569" }}>Analysis Note:</span> {meta.rationale}
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

