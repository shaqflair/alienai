"use client";
// FILE: src/app/assistant/_components/AssistantClient.tsx

import { useState, useRef, useEffect, useTransition } from "react";

/* =============================================================================
   TYPES
============================================================================= */
type Message = {
  id:      string;
  role:    "user" | "assistant";
  content: string;
  loading?: boolean;
};

type Stats = {
  peopleCount:    number;
  projectCount:   number;
  overAllocCount: number;
  freeCount:      number;
  orgName:        string;
};

/* =============================================================================
   SUGGESTED PROMPTS
============================================================================= */
const SUGGESTIONS = [
  { icon: "👥", label: "Who\'s available?",        prompt: "Who has capacity available in the next 4 weeks?" },
  { icon: "⚠️", label: "Over-allocated",          prompt: "Which team members are over-allocated right now?" },
  { icon: "📋", label: "Understaffed projects",   prompt: "Which confirmed projects have no allocations in the next 4 weeks?" },
  { icon: "📊", label: "Team utilisation",        prompt: "What is the overall team utilisation this quarter?" },
  { icon: "💡", label: "Staffing recommendation", prompt: "We need someone for a new 3-month project starting next month. Who would you suggest and why?" },
  { icon: "🗓️", label: "Capacity overview",       prompt: "Give me a full capacity overview for the next 8 weeks." },
  { icon: "🔮", label: "Pipeline risk",           prompt: "Which pipeline projects are at risk of not being staffed if they convert?" },
  { icon: "🪑", label: "Bench report",            prompt: "Who is on the bench (under 20% utilised) right now?" },
];

/* =============================================================================
   HELPERS
============================================================================= */
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatMessage(text: string): React.ReactNode {
  // Very light markdown: **bold**, bullet points, headers
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      elements.push(
        <div key={i} style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a",
                               marginTop: "10px", marginBottom: "4px" }}>
          {line.slice(4)}
        </div>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <div key={i} style={{ fontSize: "14px", fontWeight: 900, color: "#0f172a",
                               marginTop: "12px", marginBottom: "4px" }}>
          {line.slice(3)}
        </div>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "2px" }}>
          <span style={{ color: "#0e7490", fontWeight: 800, flexShrink: 0, marginTop: "1px" }}>-</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: "6px" }} />);
    } else {
      elements.push(
        <div key={i} style={{ marginBottom: "2px" }}>{renderInline(line)}</div>
      );
    }
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ fontWeight: 800, color: "#0f172a" }}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/* =============================================================================
   STAT CARD
============================================================================= */
function StatCard({ label, value, colour, onClick }: {
  label: string; value: number | string; colour: string; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: 1, minWidth: "80px",
      background: "white", borderRadius: "10px",
      border: "1.5px solid #e2e8f0", padding: "12px 14px",
      cursor: onClick ? "pointer" : "default",
      textAlign: "left", transition: "border-color 0.15s",
    }}>
      <div style={{ fontSize: "20px", fontWeight: 900, color: colour, fontFamily: "monospace" }}>
        {value}
      </div>
      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px" }}>
        {label}
      </div>
    </button>
  );
}

/* =============================================================================
   MESSAGE BUBBLE
============================================================================= */
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div style={{
        display: "flex", justifyContent: "flex-end",
        marginBottom: "16px",
      }}>
        <div style={{
          maxWidth: "75%",
          background: "#0e7490", color: "white",
          borderRadius: "14px 14px 4px 14px",
          padding: "10px 14px", fontSize: "13px", lineHeight: 1.5,
        }}>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", gap: "10px", marginBottom: "16px",
      alignItems: "flex-start",
    }}>
      {/* AI avatar */}
      <div style={{
        width: 30, height: 30, borderRadius: "50%",
        background: "linear-gradient(135deg, #0e7490, #0891b2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "11px", fontWeight: 900, color: "white",
        flexShrink: 0, marginTop: "2px",
      }}>AI</div>

      <div style={{
        maxWidth: "85%",
        background: "white", color: "#0f172a",
        borderRadius: "4px 14px 14px 14px",
        border: "1.5px solid #e2e8f0",
        padding: "12px 14px", fontSize: "13px", lineHeight: 1.6,
      }}>
        {message.loading ? (
          <div style={{ display: "flex", gap: "4px", alignItems: "center", padding: "4px 0" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#94a3b8",
                animation: `bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
              }} />
            ))}
          </div>
        ) : (
          formatMessage(message.content)
        )}
      </div>
    </div>
  );
}

/* =============================================================================
   MAIN CLIENT
============================================================================= */
export default function AssistantClient({
  stats, hasOpenAI, userEmail,
}: {
  stats:      Stats;
  hasOpenAI:  boolean;
  userEmail:  string;
}) {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const abortRef   = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;

    setError(null);
    const userMsg: Message = { id: uid(), role: "user", content: text.trim() };
    const loadingMsg: Message = { id: uid(), role: "assistant", content: "", loading: true };

    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, loadingMsg]);
    setInput("");
    setStreaming(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/assistant", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
        signal:  abortRef.current.signal,
        cache:   "no-store",
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }

      // Stream the response
      const reader   = res.body!.getReader();
      const decoder  = new TextDecoder();
      let   fullText = "";
      const assistantId = uid();

      // Replace loading message
      setMessages(prev => [
        ...prev.filter(m => m.id !== loadingMsg.id),
        { id: assistantId, role: "assistant", content: "" },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        const snapshot = fullText;
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: snapshot } : m
        ));
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      setError(e?.message ?? "Failed to get response");
      setMessages(prev => prev.filter(m => !m.loading));
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleSuggestion(prompt: string) {
    sendMessage(prompt);
  }

  function clearChat() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
    inputRef.current?.focus();
  }

  const showSuggestions = messages.length === 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%            { transform: scale(1);   opacity: 1;   }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        textarea:focus { outline: none; border-color: #0e7490 !important; }
        textarea::placeholder { color: #cbd5e1; }
      `}</style>

      <div style={{
        minHeight: "100vh", background: "#f8fafc",
        fontFamily: "'DM Sans', sans-serif",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          background: "white", borderBottom: "1.5px solid #e2e8f0",
          padding: "16px 28px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a",
                         margin: 0, letterSpacing: "-0.2px" }}>
              AI Assistant
            </h1>
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: "2px 0 0" }}>
              {stats.orgName} &middot; Powered by GPT-4o
              {!hasOpenAI && (
                <span style={{ color: "#f59e0b", fontWeight: 700, marginLeft: "8px" }}>
                  OPENAI_API_KEY not set
                </span>
              )}
            </p>
          </div>
          {messages.length > 0 && (
            <button type="button" onClick={clearChat} style={{
              padding: "6px 14px", borderRadius: "8px",
              border: "1.5px solid #e2e8f0", background: "white",
              color: "#64748b", fontSize: "12px", fontWeight: 600,
              cursor: "pointer",
            }}>Clear chat</button>
          )}
        </div>

        {/* Stats strip */}
        <div style={{
          padding: "12px 28px",
          display: "flex", gap: "10px", flexWrap: "wrap",
          borderBottom: "1.5px solid #f1f5f9",
          background: "#f8fafc",
        }}>
          <StatCard
            label="People"  value={stats.peopleCount} colour="#0e7490"
            onClick={() => handleSuggestion("Give me an overview of all team members and their current utilisation.")}
          />
          <StatCard
            label="Confirmed projects" value={stats.projectCount} colour="#7c3aed"
            onClick={() => handleSuggestion("List all confirmed projects and their staffing status.")}
          />
          <StatCard
            label="Over-allocated" value={stats.overAllocCount}
            colour={stats.overAllocCount > 0 ? "#dc2626" : "#059669"}
            onClick={() => handleSuggestion("Who is over-allocated and by how much?")}
          />
          <StatCard
            label="Free next 4 wks" value={stats.freeCount}
            colour={stats.freeCount > 0 ? "#059669" : "#94a3b8"}
            onClick={() => handleSuggestion("Who has no allocations in the next 4 weeks and is available for new work?")}
          />
        </div>

        {/* Chat area */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "24px 28px",
          maxWidth: "820px", width: "100%", margin: "0 auto",
          boxSizing: "border-box",
        }}>
          {/* Welcome + suggestions */}
          {showSuggestions && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <div style={{
                textAlign: "center", marginBottom: "32px", paddingTop: "24px",
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "linear-gradient(135deg, #0e7490, #0891b2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "20px", fontWeight: 900, color: "white",
                  margin: "0 auto 14px",
                  boxShadow: "0 8px 24px rgba(14,116,144,0.3)",
                }}>AI</div>
                <h2 style={{ fontSize: "20px", fontWeight: 900, color: "#0f172a",
                             margin: "0 0 8px" }}>
                  What would you like to know?
                </h2>
                <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
                  Ask me anything about your team's capacity, availability, or project staffing.
                </p>
              </div>

              {/* Suggestions grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "10px", marginBottom: "32px",
              }}>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} type="button"
                    onClick={() => handleSuggestion(s.prompt)}
                    style={{
                      padding: "12px 14px", borderRadius: "10px",
                      border: "1.5px solid #e2e8f0", background: "white",
                      cursor: "pointer", textAlign: "left",
                      transition: "all 0.15s",
                      fontSize: "12px", fontWeight: 600, color: "#334155",
                      lineHeight: 1.4,
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = "#0e7490";
                      (e.currentTarget as HTMLElement).style.color = "#0e7490";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0";
                      (e.currentTarget as HTMLElement).style.color = "#334155";
                    }}
                  >
                    <span style={{ fontSize: "16px", display: "block", marginBottom: "4px", lineHeight: 1 }}>
                      {s.icon}
                    </span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map(m => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {/* Error */}
          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: "8px",
              background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.2)",
              color: "#dc2626", fontSize: "12px", fontWeight: 600,
              marginBottom: "12px",
            }}>
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{
          borderTop: "1.5px solid #e2e8f0", background: "white",
          padding: "16px 28px",
        }}>
          <div style={{
            maxWidth: "820px", margin: "0 auto",
            display: "flex", gap: "10px", alignItems: "flex-end",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about availability, staffing, utilisation... (Enter to send, Shift+Enter for newline)"
              rows={2}
              style={{
                flex: 1, padding: "10px 14px", borderRadius: "10px",
                border: "1.5px solid #e2e8f0", fontSize: "13px",
                fontFamily: "inherit", resize: "none",
                color: "#0f172a", lineHeight: 1.5,
                transition: "border-color 0.15s",
              }}
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || streaming || !hasOpenAI}
              style={{
                padding: "10px 20px", borderRadius: "10px", border: "none",
                background: !input.trim() || streaming || !hasOpenAI ? "#e2e8f0" : "#0e7490",
                color: !input.trim() || streaming || !hasOpenAI ? "#94a3b8" : "white",
                fontSize: "13px", fontWeight: 800,
                cursor: !input.trim() || streaming || !hasOpenAI ? "not-allowed" : "pointer",
                flexShrink: 0, height: "44px",
                transition: "all 0.15s",
                boxShadow: !input.trim() || streaming ? "none" : "0 2px 12px rgba(14,116,144,0.25)",
              }}
            >
              {streaming ? "..." : "Send"}
            </button>
          </div>
          <div style={{
            maxWidth: "820px", margin: "6px auto 0",
            fontSize: "10px", color: "#cbd5e1", textAlign: "right",
          }}>
            Context: live data from {stats.orgName} &middot; Model: GPT-4o
          </div>
        </div>
      </div>
    </>
  );
}

