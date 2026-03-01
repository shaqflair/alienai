"use client";

import { useState, useRef, useEffect } from "react";

/* =============================================================================
   TYPES & CONSTANTS
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

const SUGGESTIONS = [
  { label: "Who's available?",        prompt: "Who has capacity available in the next 4 weeks?" },
  { label: "Over-allocated",          prompt: "Which team members are over-allocated right now?" },
  { label: "Understaffed projects",   prompt: "Which confirmed projects have no allocations in the next 4 weeks?" },
  { label: "Team utilisation",        prompt: "What is the overall team utilisation this quarter?" },
  { label: "Staffing recommendation", prompt: "We need someone for a new 3-month project starting next month. Who would you suggest and why?" },
  { label: "Capacity overview",       prompt: "Give me a full capacity overview for the next 8 weeks." },
  { label: "Pipeline risk",           prompt: "Which pipeline projects are at risk of not being staffed if they convert?" },
  { label: "Bench report",            prompt: "Who is on the bench (under 20% utilised) right now?" },
];

/* =============================================================================
   HELPERS
============================================================================= */
function uid() { return Math.random().toString(36).slice(2, 10); }

function formatMessage(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith("### ")) {
      elements.push(<div key={i} style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a", marginTop: "10px", marginBottom: "4px" }}>{line.slice(4)}</div>);
    } else if (line.startsWith("## ")) {
      elements.push(<div key={i} style={{ fontSize: "14px", fontWeight: 900, color: "#0f172a", marginTop: "12px", marginBottom: "4px" }}>{line.slice(3)}</div>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "2px" }}>
          <span style={{ color: "#0e7490", fontWeight: 800, flexShrink: 0 }}>-</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: "6px" }} />);
    } else {
      elements.push(<div key={i} style={{ marginBottom: "2px" }}>{renderInline(line)}</div>);
    }
  });

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ fontWeight: 800, color: "#0f172a" }}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/* =============================================================================
   COMPONENTS
============================================================================= */
function StatCard({ label, value, colour, onClick }: { label: string; value: number | string; colour: string; onClick?: () => void; }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: 1, minWidth: "80px", background: "white", borderRadius: "10px", border: "1.5px solid #e2e8f0", padding: "12px 14px",
      cursor: onClick ? "pointer" : "default", textAlign: "left", transition: "border-color 0.15s",
    }}>
      <div style={{ fontSize: "20px", fontWeight: 900, color, fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px" }}>{label}</div>
    </button>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", gap: "10px", marginBottom: "16px", alignItems: "flex-start" }}>
      {!isUser && <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg, #0e7490, #0891b2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 900, color: "white", flexShrink: 0, marginTop: "2px" }}>AI</div>}
      <div style={{
        maxWidth: isUser ? "75%" : "85%", background: isUser ? "#0e7490" : "white", color: isUser ? "white" : "#0f172a",
        borderRadius: isUser ? "14px 14px 4px 14px" : "4px 14px 14px 14px", border: isUser ? "none" : "1.5px solid #e2e8f0", padding: "10px 14px", fontSize: "13px", lineHeight: 1.5,
      }}>
        {message.loading ? <div className="loading-dots"><span>.</span><span>.</span><span>.</span></div> : formatMessage(message.content)}
      </div>
    </div>
  );
}

/* =============================================================================
   MAIN EXPORT
============================================================================= */
export default function AssistantClient({ stats, hasOpenAI, userEmail }: { stats: Stats; hasOpenAI: boolean; userEmail: string; }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    setError(null);
    const userMsg: Message = { id: uid(), role: "user", content: text.trim() };
    const loadingMsg: Message = { id: uid(), role: "assistant", content: "", loading: true };
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput("");
    setStreaming(true);

    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })) }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error("Assistant failed to respond.");
      
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      const assistantId = uid();

      setMessages(prev => [...prev.filter(m => !m.loading), { id: assistantId, role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullText } : m));
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message);
      setMessages(prev => prev.filter(m => !m.loading));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
        .loading-dots span { animation: bounce 1.2s infinite ease-in-out; display: inline-block; font-size: 20px; }
        .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
      `}</style>
      
      <div style={{ background: "white", borderBottom: "1.5px solid #e2e8f0", padding: "16px 28px" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 900, margin: 0 }}>AI Assistant</h1>
        <p style={{ fontSize: "12px", color: "#94a3b8" }}>{stats.orgName} • GPT-4o</p>
      </div>

      <div style={{ padding: "12px 28px", display: "flex", gap: "10px", overflowX: "auto", background: "#f8fafc" }}>
        <StatCard label="People" value={stats.peopleCount} colour="#0e7490" onClick={() => sendMessage("Give me an overview of all team members.")} />
        <StatCard label="Over-allocated" value={stats.overAllocCount} colour="#dc2626" onClick={() => sendMessage("Who is over-allocated?")} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", maxWidth: "820px", width: "100%", margin: "0 auto" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 900 }}>What would you like to know?</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "20px" }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => sendMessage(s.prompt)} style={{ padding: "12px", border: "1.5px solid #e2e8f0", borderRadius: "10px", background: "white", cursor: "pointer", fontSize: "12px" }}>{s.label}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map(m => <MessageBubble key={m.id} message={m} />)}
        <div ref={bottomRef} />
      </div>

      <div style={{ borderTop: "1.5px solid #e2e8f0", background: "white", padding: "16px 28px" }}>
        <div style={{ maxWidth: "820px", margin: "0 auto", display: "flex", gap: "10px" }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendMessage(input))} placeholder="Ask about capacity..." style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "1.5px solid #e2e8f0", resize: "none" }} rows={2} />
          <button onClick={() => sendMessage(input)} disabled={!input.trim() || streaming} style={{ padding: "0 20px", background: "#0e7490", color: "white", borderRadius: "10px", border: "none", cursor: "pointer" }}>Send</button>
        </div>
      </div>
    </div>
  );
}
