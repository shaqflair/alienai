"use client";

import { useEffect } from "react";

function canSpeak() {
  if (typeof window === "undefined") return false;
  if (!("speechSynthesis" in window)) return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return false;
  return true;
}

export default function VoiceGreeting({
  userName,
  enabled = true,
}: {
  userName: string | null;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    if (!userName) return;
    if (!canSpeak()) return;

    // once per day per browser
    const key = "aliena.voiceGreeting.last";
    const today = new Date().toISOString().slice(0, 10);
    const last = localStorage.getItem(key);
    if (last === today) return;

    // avoid blasting if user has muted / no permission vibe
    const msg = `Welcome to ΛLIΞNΛ. Governance intelligence ready.`;

    try {
      const u = new SpeechSynthesisUtterance(msg);
      u.rate = 0.95;
      u.pitch = 1.05;
      u.volume = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      localStorage.setItem(key, today);
    } catch {
      // ignore
    }
  }, [enabled, userName]);

  return null;
}