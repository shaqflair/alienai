"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type {
  LivePerson, LiveProject, LiveAllocation, LiveException,
  ScenarioChange, ComputedState, PersonDiff,
} from "../_lib/scenario-engine";

/* =============================================================================
   TYPES
============================================================================= */
type Message = {
  id:       string;
  role:     "user" | "assistant";
  content:  string;
  loading?: boolean;
  suggestions?: SuggestedChange[];
};

type SuggestedChange = ScenarioChange & { label: string };

type Props = {
  people:        LivePerson[];
  projects:      LiveProject[];
  allocations:   LiveAllocation[];
  liveState:     ComputedState;
  scenarioState: ComputedState;
  diffs:         PersonDiff[];
  changes:       ScenarioChange[];
  onApplyChange: (c: ScenarioChange) => void;
  onClose:       () => void;
};

/* =============================================================================
   HELPERS
============================================================================= */
function uid() { return Math.random().toString(36).slice(2, 9); }

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("### ")) return <div key={i} style={{ fontWeight: 800, fontSize: "13px", marginTop: "10px", marginBottom: "3px", color: "#0f172a" }}>{line.slice(4)}</div>;
    if (line.startsWith("## "))  return <div key={i} style={{ fontWeight: 900, fontSize: "14px", marginTop: "12px", marginBottom: "4px", color: "#0f172a" }}>{line.slice(3)}</div>;
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return (
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "2px" }}>
          <span style={{ color: "#00b8db", fontWeight: 800, flexShrink: 0 }}>·</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    }
    if (line.trim() === "") return <div key={i} style={{ height: "5px" }} />;
    return <div key={i} style={{ marginBottom: "2px" }}>{renderInline(line)}</div>;
  });
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} style={{ fontWeight: 800, color: "#0f172a" }}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

function parseSuggestions(text: string): SuggestedChange[] {
  try {
    const match = text.match(/```json\s*([\s\S]*?)```/);
    if (!match) return [];
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed?.suggestedChanges) ? parsed.suggestedChanges : [];
  } catch {
    return [];
  }
}

function stripJsonBlock(text: string): string {
  return text.replace(/```json[\s\S]*?```/g, "").trim();
}

const QUICK_PROMPTS = [
  "Analyse conflicts and suggest fixes",
  "Who can I move to reduce overload?",
  "Which projects are under-staffed?",
  "Suggest the best staffing for all confirmed projects",
  "What happens if I add a new project?",
  "Who is free for new work right now?",
];

/* =============================================================================
   SUGGESTION CARD
============================================================================= */
function SuggestionCard({
  suggestion, people, projects, onApply,
}: {
  suggestion:  SuggestedChange;
  people:      LivePerson[];
  projects:    LiveProject[];
  onApply:     (c: ScenarioChange) => void;
}) {
  const [applied, setApplied] = useState(false);

  function getPersonName(id: string) {
    return people.find(p => p.personId === id)?.fullName ?? id.slice(0, 8);
  }
  function getProjectName(id: string) {
    return projects.find(p => p.projectId === id)?.title ?? id.slice(0, 8);
  }

  const typeIcon: Record<string, string> = {
    add_allocation:    "➕",
    remove_allocation: "➖",
    swap_allocation:   "🔄",
    change_capacity:   "⚡",
    shift_project:     "📅",
    add_project:       "🆕",
  };

  return (
    <div style={{
      border: `1.5px solid ${applied ? "#10b981" : "#e2e8f0"}`,
      borderRadius: "10px",
      background: applied ? "rgba(16,185,129,0.06)" : "#fafafa",
      padding: "10px 12px",
      transition: "all 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <span style={{ fontSize: "14px", flexShrink: 0, marginTop: "1px" }}>
          {typeIcon[suggestion.type] ?? "✏️"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", marginBottom: "2px" }}>
            {suggestion.label}
          </div>
          <div style={{ fontSize: "10px", color: "#94a3b8" }}>
            {suggestion.type === "add_allocation" && `${getPersonName((suggestion as any).personId)} → ${getProjectName((suggestion as any).projectId)}`}
            {suggestion.type === "remove_allocation" && `${getPersonName((suggestion as any).personId)} off ${getProjectName((suggestion as any).projectId)}`}
            {suggestion.type === "swap_allocation" && `${getPersonName((suggestion as any).fromPersonId)} → ${getPersonName((suggestion as any).toPersonId)} on ${getProjectName((suggestion as any).projectId)}`}
            {suggestion.type === "change_capacity" && `${getPersonName((suggestion as any).personId)}: ${(suggestion as any).newCapacity}d/wk`}
          </div>
        </div>
        <button
          type="button"
          disabled={applied}
          onClick={() => {
            const { label, ...change } = suggestion as any;
            onApply(change as ScenarioChange);
            setApplied(true);
          }}
          style={{
            padding: "5px 12px", borderRadius: "7px", border: "none",
            background: applied ? "#10b981" : "#00b8db",
            color: "white", fontSize: "10px", fontWeight: 800,
            cursor: applied ? "default" : "pointer", flexShrink: 0,
            transition: "background 0.2s",
          }}
        >
          {applied ? "✓ Applied" : "Apply"}
        </button>
      </div>
    </div>
  );
}

/* =============================================================================
   MAIN PANEL
============================================================================= */
export default function ScenarioAIPanel({
  people, projects, allocations, liveState, scenarioState,
  diffs, changes, onApplyChange, onClose,
}: Props) {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,      setInput]      = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const abortRef   = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const buildPayload = useCallback((userMessage: string, history: Message[]) => {
    const allocSummary = allocations.slice(0, 150).map(a => ({
      personName:    people.find(p => p.personId === a.personId)?.fullName ?? a.personId,
      projectTitle:  projects.find(p => p.projectId === a.projectId)?.title ?? a.projectId,
      weekStart:     a.weekStart,
      daysAllocated: a.daysAllocated,
    }));

    return {
      people: people.map(p => ({
        personId:   p.personId,
        fullName:   p.fullName,
        jobTitle:   p.jobTitle,
        department: p.department,
        capacityDays: p.capacityDays,
      })),
      projects: projects.map(p => ({
        projectId:   p.projectId,
        title:       p.title,
        projectCode: p.projectCode,
        status:      p.status,
        startDate:   p.startDate,
        endDate:     p.endDate,
        winProb:     p.winProb,
      })),
      allocations: allocSummary,
      changes,
      warnings: (scenarioState.warnings ?? []).map(w => ({
        severity: w.severity,
        message:  w.message,
      })),
      liveConflictScore:     liveState?.conflictScore ?? 0,
      scenarioConflictScore: scenarioState?.conflictScore ?? 0,
      userMessage,
      messages: history.filter(m => !m.loading).slice(-8).map(m => ({
        role:    m.role,
        content: stripJsonBlock(m.content),
      })),
    };
  }, [people, projects, allocations, changes, liveState, scenarioState]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    setError(null);
    setInput("");

    const userMsg: Message = { id: uid(), role: "user", content: text };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "", loading: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const history = messages.filter(m => !m.loading);
      const payload = buildPayload(text, history);

      const res = await fetch("/api/scenario-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });

        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: fullText, loading: false }
            : m
        ));
      }

      const suggestions = parseSuggestions(fullText);
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: fullText, loading: false, suggestions }
          : m
      ));

    } catch (e: any) {
      if (e.name === "AbortError") return;
      setError(e.message ?? "Failed to get AI response");
      setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
    } finally {
      setStreaming(false);
    }
  }

  useEffect(() => {
    if (messages.length === 0) {
      sendMessage("Analyse this scenario and suggest improvements to reduce conflicts and improve resource utilisation.");
    }
  }, []);

  const scoreDelta = (scenarioState?.conflictScore ?? 0) - (liveState?.conflictScore ?? 0);

  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0,
      width: "380px", background: "white",
      borderLeft: "1.5px solid #e2e8f0",
      display: "flex", flexDirection: "column",
      zIndex: 100, fontFamily: "'DM Sans', sans-serif",
      boxShadow: "-8px 0 32px rgba(0,0,0,0.08)",
    }}>
      <div style={{
        padding: "16px 16px 12px",
        borderBottom: "1.5px solid #f1f5f9",
        background: "linear-gradient(135deg, rgba(0,184,219,0.06) 0%, white 60%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%",
              background: "linear-gradient(135deg, #00b8db, #0e7490)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "13px", fontWeight: 900, color: "white",
            }}>AI</div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>AI Scenario Advisor</div>
              <div style={{ fontSize: "10px", color: "#94a3b8" }}>GPT-4o · What-If Analysis</div>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: "16px", color: "#94a3b8", padding: "4px",
          }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          {[
            { label: "Live score",     value: liveState?.conflictScore ?? 0,      colour: "#64748b" },
            { label: "Scenario score", value: scenarioState?.conflictScore ?? 0, colour: scoreDelta < 0 ? "#10b981" : scoreDelta > 0 ? "#ef4444" : "#64748b" },
            { label: "Changes",        value: changes.length,                               colour: "#00b8db" },
          ].map(s => (
            <div key={s.label} style={{
              flex: 1, padding: "7px 8px", borderRadius: "8px",
              background: "#f8fafc", border: "1px solid #f1f5f9",
              textAlign: "center",
            }}>
              <div style={{ fontSize: "14px", fontWeight: 900, color: s.colour,
                            fontFamily: "'DM Mono', monospace" }}>{s.value}</div>
              <div style={{ fontSize: "9px", color: "#94a3b8", fontWeight: 700,
                            textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {messages.length === 0 && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "#94a3b8",
                          textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
              Quick prompts
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {QUICK_PROMPTS.map(p => (
                <button key={p} type="button"
                  onClick={() => sendMessage(p)}
                  style={{
                    padding: "7px 10px", borderRadius: "8px",
                    border: "1.5px solid #e2e8f0", background: "white",
                    fontSize: "11px", fontWeight: 600, color: "#334155",
                    cursor: "pointer", textAlign: "left",
                    transition: "border-color 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#00b8db"; (e.currentTarget as HTMLElement).style.color = "#00b8db"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; (e.currentTarget as HTMLElement).style.color = "#334155"; }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{
            marginBottom: "14px",
            display: "flex",
            flexDirection: "column",
            alignItems: msg.role === "user" ? "flex-end" : "flex-start",
          }}>
            {msg.role === "user" ? (
              <div style={{
                maxWidth: "85%", background: "#00b8db", color: "white",
                borderRadius: "12px 12px 4px 12px",
                padding: "9px 12px", fontSize: "12px", lineHeight: 1.5,
              }}>
                {msg.content}
              </div>
            ) : (
              <div style={{ maxWidth: "100%" }}>
                {msg.loading ? (
                  <div style={{ display: "flex", gap: "4px", alignItems: "center",
                                padding: "10px 14px", background: "#f8fafc",
                                borderRadius: "4px 12px 12px 12px", border: "1.5px solid #f1f5f9" }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: 6, height: 6, borderRadius: "50%", background: "#00b8db",
                        animation: `bounce 1s ease-in-out ${i * 0.15}s infinite`,
                      }} />
                    ))}
                  </div>
                ) : (
                  <>
                    <div style={{
                      background: "#f8fafc", borderRadius: "4px 12px 12px 12px",
                      border: "1.5px solid #f1f5f9",
                      padding: "10px 12px", fontSize: "12px", lineHeight: 1.6,
                      color: "#334155",
                    }}>
                      {renderMarkdown(stripJsonBlock(msg.content))}
                    </div>

                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                                      textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Suggested changes ({msg.suggestions.length})
                        </div>
                        {msg.suggestions.map((s, i) => (
                          <SuggestionCard
                            key={i}
                            suggestion={s}
                            people={people}
                            projects={projects}
                            onApply={onApplyChange}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {error && (
          <div style={{
            padding: "9px 12px", borderRadius: "8px",
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            color: "#dc2626", fontSize: "11px", marginBottom: "10px",
          }}>
            ⚠ {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div style={{
        padding: "12px 14px",
        borderTop: "1.5px solid #f1f5f9",
        background: "white",
      }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Ask about your scenario..."
            rows={2}
            disabled={streaming}
            style={{
              flex: 1, resize: "none",
              padding: "9px 12px", borderRadius: "9px",
              border: "1.5px solid #e2e8f0", fontSize: "12px",
              fontFamily: "'DM Sans', sans-serif", outline: "none",
              color: "#0f172a", lineHeight: 1.4,
              background: streaming ? "#f8fafc" : "white",
            }}
          />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            style={{
              width: 36, height: 36, borderRadius: "9px", border: "none",
              background: !input.trim() || streaming ? "#e2e8f0" : "#00b8db",
              color: "white", cursor: !input.trim() || streaming ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, fontSize: "15px",
            }}
          >
            {streaming ? "…" : "↑"}
          </button>
        </div>
        <div style={{ fontSize: "9px", color: "#cbd5e1", marginTop: "5px", textAlign: "center" }}>
          Enter to send · Shift+Enter for newline · Powered by GPT-4o
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
