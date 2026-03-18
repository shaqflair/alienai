import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { filterActiveProjectIds } from "@/lib/server/project-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- utils ---------------- */

function safeNum(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function pct(num: number, denom: number): number {
  if (!denom) return 0;
  return Math.round((num / denom) * 100);
}

/* ---------------- handler ---------------- */

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* ---------------- resolve scope ---------------- */

  const scoped = await resolvePortfolioScope(supabase, user.id);
  const projectIds = await filterActiveProjectIds(
    supabase,
    scoped.projectIds
  );

  if (!projectIds.length) {
    return NextResponse.json(
      {
        window_24h: emptyWindow(),
        window_7d: emptyWindow(),
        by_type: [],
        generated_at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  /* ---------------- fetch events ---------------- */

  const now = new Date();
  const d24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Querying from project_events which contains the AI health payloads
  const { data: events, error } = await supabase
    .from("project_events")
    .select("event_type, severity, payload, created_at")
    .in("project_id", projectIds)
    .gte("created_at", d7);

  if (error) {
    console.error("AI health fetch error", error);
    return NextResponse.json(
      { error: "Failed to load health data" },
      { status: 500 }
    );
  }

  /* ---------------- aggregation ---------------- */

  const agg24 = buildWindow(events || [], d24);
  const agg7 = buildWindow(events || [], d7);
  const byType = buildByType(events || []);

  return NextResponse.json(
    {
      window_24h: agg24,
      window_7d: agg7,
      by_type: byType,
      generated_at: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

/* ---------------- builders ---------------- */

function emptyWindow() {
  return {
    total_events: 0,
    failures: 0,
    warnings: 0,
    success_rate: 0,
    avg_latency_ms: 0,
  };
}

function buildWindow(events: any[], sinceIso: string) {
  const sinceTime = new Date(sinceIso).getTime();
  const filtered = events.filter(
    (e) => new Date(e.created_at).getTime() >= sinceTime
  );

  let total = 0;
  let failures = 0;
  let warnings = 0;
  let latencySum = 0;
  let latencyCount = 0;

  for (const e of filtered) {
    total++;

    if (e.severity === "critical") failures++;
    if (e.severity === "warning") warnings++;

    const latency = safeNum(e.payload?.latency_ms);
    if (latency > 0) {
      latencySum += latency;
      latencyCount++;
    }
  }

  return {
    total_events: total,
    failures,
    warnings,
    success_rate: total ? pct(total - failures, total) : 0,
    avg_latency_ms: latencyCount
      ? Math.round(latencySum / latencyCount)
      : 0,
  };
}

function buildByType(events: any[]) {
  const map = new Map<
    string,
    { count: number; failures: number }
  >();

  for (const e of events) {
    const key = e.event_type || "unknown";

    if (!map.has(key)) {
      map.set(key, { count: 0, failures: 0 });
    }

    const entry = map.get(key)!;
    entry.count++;

    if (e.severity === "critical") {
      entry.failures++;
    }
  }

  return Array.from(map.entries()).map(([event_type, v]) => ({
    event_type,
    count: v.count,
    failure_rate: pct(v.failures, v.count),
  }));
}