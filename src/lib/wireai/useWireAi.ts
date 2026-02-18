"use client";

import { useState } from "react";

export function useWireAi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(prompt: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wireai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Generate failed");

      return String(data?.text ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
      return "";
    } finally {
      setLoading(false);
    }
  }

  return { generate, loading, error };
}
