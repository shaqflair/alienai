// src/hooks/useOrgFy.ts
// Fetches org FY start month once and caches it for the session.
// Returns { fyStartMonth, fyYear, fyLabel, loading }

"use client";

import { useEffect, useState } from "react";

type OrgFy = {
  fyStartMonth: number;
  fyYear: number;
  fyLabel: string;
  loading: boolean;
};

function computeFy(fyStartMonth: number): { fyYear: number; fyLabel: string } {
  const now = new Date();
  const m = now.getMonth() + 1;
  const fyYear = m >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1;
  const fyLabel = fyStartMonth === 1 ? String(fyYear) : `${fyYear}/${String(fyYear + 1).slice(2)}`;
  return { fyYear, fyLabel };
}

// Simple in-memory cache — survives re-renders, resets on page refresh
let cachedFyStart: number | null = null;

export function useOrgFy(): OrgFy {
  const [fyStartMonth, setFyStartMonth] = useState<number>(cachedFyStart ?? 4);
  const [loading, setLoading] = useState(cachedFyStart === null);

  useEffect(() => {
    if (cachedFyStart !== null) {
      setFyStartMonth(cachedFyStart);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch("/api/org/fy-config", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const start = [1, 4, 7, 10].includes(d?.fyStartMonth) ? d.fyStartMonth : 4;
        cachedFyStart = start;
        setFyStartMonth(start);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          cachedFyStart = 4; // fallback to UK default
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const { fyYear, fyLabel } = computeFy(fyStartMonth);
  return { fyStartMonth, fyYear, fyLabel, loading };
}
