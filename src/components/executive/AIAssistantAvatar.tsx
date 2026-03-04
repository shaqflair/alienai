"use client";

import React from "react";
import { Sparkles } from "lucide-react";

export default function AIAssistantAvatar({
  label = "Ask ΛLIΞNΛ",
  onClick,
}: {
  label?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 shadow-[0_0_0_1px_rgba(0,184,219,0.10)] hover:bg-white/[0.06] transition"
      title="Ask ΛLIΞNΛ"
    >
      <span className="relative grid place-items-center h-10 w-10 rounded-2xl">
        {/* glow */}
        <span className="absolute inset-0 rounded-2xl bg-cyan-400/30 blur-xl opacity-70 group-hover:opacity-90 transition" />
        {/* orb */}
        <span className="relative h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-300/30 via-blue-500/20 to-white/10 border border-white/10 shadow-[inset_0_0_20px_rgba(0,184,219,0.20)]" />
        <Sparkles className="absolute h-4 w-4 text-cyan-200/90" />
      </span>

      <div className="text-left">
        <div className="text-sm font-semibold tracking-[0.25em] text-slate-200">ΛLIΞNΛ</div>
        <div className="text-xs text-slate-400">{label}</div>
      </div>

      <span className="ml-2 text-xs text-cyan-200/80 opacity-0 group-hover:opacity-100 transition">
        Open
      </span>
    </button>
  );
}