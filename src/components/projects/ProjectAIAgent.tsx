"use client";
// src/components/projects/ProjectAIAgent.tsx
// Conversational AI agent with full project context
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Send, Bot, User, Loader, Sparkles, RefreshCw } from "lucide-react";

type Message = {
  id:      string;
  role:    "user" | "assistant";
  content: string;
  ts:      number;
};

type ProjectContext = {
  projectId:    string;
  projectTitle: string;
};

const SUGGESTED_PROMPTS = [
  "What are the biggest risks right now?",
  "What decisions need to be made today?",
  "Is this project on track to deliver?",
  "What should I escalate to the sponsor?",
  "Summarise the governance position",
];

export default function ProjectAIAgent({ projectId, projectTitle }: ProjectContext) {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text.trim(), ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const history = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res  = await fetch("/api/ai/project-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, messages: history }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Agent failed");

      const assistantMsg: Message = {
        id:      (Date.now() + 1).toString(),
        role:    "assistant",
        content: json.content,
        ts:      Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to get response");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [messages, loading, projectId]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function reset() {
    setMessages([]);
    setError(null);
    setInput("");
  }

  const isEmpty = messages.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0 8px", borderBottom: "1px solid #e8ecf0", marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Bot style={{ width: 12, height: 12, color: "#6366f1" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#0d1117" }}>Project Agent</span>
          <span style={{ fontSize: 10, color: "#8b949e", background: "#f6f8fa", padding: "1px 6px", borderRadius: 20, border: "1px solid #e8ecf0" }}>Beta</span>
        </div>
        {messages.length > 0 && (
          <button onClick={reset} style={{ background: "none", border: "none", cursor: "pointer", color: "#8b949e", display: "flex", alignItems: "center", gap: 3, fontSize: 11 }}>
            <RefreshCw style={{ width: 11, height: 11 }} /> Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, minHeight: 0, paddingBottom: 8 }}>

        {isEmpty && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", background: "#f8faff", border: "1px solid #c7d2fe", borderRadius: 10 }}>
              <Sparkles style={{ width: 14, height: 14, color: "#6366f1", flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 12, color: "#3730a3", lineHeight: 1.5 }}>
                Ask me anything about <strong>{projectTitle}</strong> — risks, decisions, governance, timeline, or next steps.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {SUGGESTED_PROMPTS.map(p => (
                <button key={p} onClick={() => send(p)} style={{ textAlign: "left", padding: "7px 10px", borderRadius: 8, border: "1px solid #e8ecf0", background: "#ffffff", cursor: "pointer", fontSize: 11, color: "#374151", transition: "all 0.15s", lineHeight: 1.4 }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
            <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: msg.role === "user" ? "#6366f1" : "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {msg.role === "user"
                ? <User    style={{ width: 12, height: 12, color: "#fff" }} />
                : <Bot     style={{ width: 12, height: 12, color: "#6366f1" }} />}
            </div>
            <div style={{
              maxWidth: "82%",
              padding: "8px 12px",
              borderRadius: msg.role === "user" ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
              background: msg.role === "user" ? "#6366f1" : "#f6f8fa",
              border: msg.role === "assistant" ? "1px solid #e8ecf0" : "none",
              fontSize: 12,
              lineHeight: 1.6,
              color: msg.role === "user" ? "#ffffff" : "#0d1117",
              whiteSpace: "pre-wrap",
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bot style={{ width: 12, height: 12, color: "#6366f1" }} />
            </div>
            <div style={{ padding: "8px 12px", background: "#f6f8fa", border: "1px solid #e8ecf0", borderRadius: "4px 12px 12px 12px" }}>
              <Loader style={{ width: 14, height: 14, color: "#6366f1", animation: "spin 1s linear infinite" }} />
            </div>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 11, color: "#dc2626", padding: "6px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ flexShrink: 0, borderTop: "1px solid #e8ecf0", paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about this project…"
            rows={2}
            disabled={loading}
            style={{
              flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #e8ecf0",
              fontSize: 12, fontFamily: "inherit", resize: "none", outline: "none",
              lineHeight: 1.5, color: "#0d1117", background: loading ? "#f6f8fa" : "#ffffff",
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            style={{
              flexShrink: 0, width: 34, height: 34, borderRadius: 8,
              background: !input.trim() || loading ? "#e8ecf0" : "#6366f1",
              border: "none", cursor: !input.trim() || loading ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s",
            }}
          >
            <Send style={{ width: 14, height: 14, color: !input.trim() || loading ? "#8b949e" : "#ffffff" }} />
          </button>
        </div>
        <p style={{ margin: "5px 0 0", fontSize: 10, color: "#8b949e" }}>Enter to send · Shift+Enter for new line</p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}