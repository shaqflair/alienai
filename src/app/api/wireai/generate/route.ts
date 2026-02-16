1) Update types (add optional meta + milestone map)

Find type WeeklyReportDocV1 = { ... } and update it to:

type WeeklyReportDocV1 = {
  version: 1;
  type: "weekly_report";
  periodFrom: string; // YYYY-MM-DD
  periodTo: string; // YYYY-MM-DD
  rag: WeeklyRag;

  executiveSummary: WeeklyExecutiveSummary;

  completedThisPeriod: { columns: number; rows: RowObj[] };
  nextPeriodFocus: { columns: number; rows: RowObj[] };

  resourceSummary?: { columns: number; rows: RowObj[] } | null;

  keyDecisionsTaken: { columns: number; rows: RowObj[] };

  operationalBlockers: string; // bullets, one per line

  // ✅ ADD: optional meta used by exports (non-breaking)
  meta?: {
    previous?: {
      rag?: WeeklyRag;
      milestonesByName?: Record<string, { rag?: WeeklyRag }>;
    };
    dimensions?: {
      time?: WeeklyRag;
      scope?: WeeklyRag;
      cost?: WeeklyRag;
      quality?: WeeklyRag;
    };
    milestones?: Array<{ name: string; due?: string | null }>;
  };
};

2) Preserve meta in normalizeWeeklyDoc (so it survives)

At the end of normalizeWeeklyDoc(...), add:

  const metaIn = doc?.meta && typeof doc.meta === "object" ? doc.meta : undefined;


and include it in the return:

  return {
    version: 1,
    type: "weekly_report",
    periodFrom,
    periodTo,
    rag,
    executiveSummary,
    completedThisPeriod,
    nextPeriodFocus,
    resourceSummary,
    keyDecisionsTaken,
    operationalBlockers,
    ...(metaIn ? { meta: metaIn } : {}),
  };


This is important: your PPT exporter will read model.meta.previous + model.meta.dimensions.

3) Add Supabase + lookups (OPTIONAL, only when projectId provided)

At the very top imports, add:

import { createClient } from "@/utils/supabase/server";


Then add these helpers somewhere above POST:

function isEarlier(aYmd: string, bYmd: string) {
  // true if a < b
  return aYmd && bYmd && aYmd < bYmd;
}

function pickLatestDocBeforePeriod(docs: WeeklyReportDocV1[], fromYmd: string) {
  // choose the report whose periodTo is < fromYmd, with the latest periodTo
  const candidates = docs
    .filter((d) => looksLikeYmd(s(d?.periodTo)) && isEarlier(s(d.periodTo), fromYmd))
    .sort((a, b) => (s(a.periodTo) < s(b.periodTo) ? 1 : -1));
  return candidates[0] ?? null;
}

function tableFirstColBullets(table: { rows: RowObj[] } | null | undefined, max = 6) {
  const rows = Array.isArray(table?.rows) ? table!.rows : [];
  const data = rows.filter((r) => r?.type === "data");
  const out = data.map((r) => s((r.cells ?? [])[0] ?? "").trim()).filter(Boolean);
  return out.slice(0, max);
}

// --- compute Time/Scope from schedule+wbs (simple stable heuristics)
function computeTimeRagFromSchedule(scheduleJson: any, periodTo: string): WeeklyRag {
  // expect your schedule doc shape: items[] with type/status/end/due/start fields
  const items = Array.isArray(scheduleJson?.items) ? scheduleJson.items : [];
  const milestones = items.filter((it: any) => s(it?.type).toLowerCase() === "milestone");

  // overdue milestone => red
  const overdue = milestones.some((m: any) => {
    const due = s(m?.end || m?.due || m?.date || "").slice(0, 10);
    const status = s(m?.status).toLowerCase();
    if (!looksLikeYmd(due)) return false;
    const done = status === "done" || status === "completed";
    return !done && isEarlier(due, periodTo);
  });
  if (overdue) return "red";

  // due in next 7 days and not on_track/done => amber
  const toDt = new Date(`${periodTo}T00:00:00Z`);
  const soon = milestones.some((m: any) => {
    const due = s(m?.end || m?.due || m?.date || "").slice(0, 10);
    const status = s(m?.status).toLowerCase();
    if (!looksLikeYmd(due)) return false;
    const done = status === "done" || status === "completed";
    const dt = new Date(`${due}T00:00:00Z`);
    const diffDays = Math.floor((dt.getTime() - toDt.getTime()) / (24 * 3600 * 1000));
    const atRisk = status === "delayed" || status === "at_risk" || status === "blocked";
    return !done && (diffDays >= 0 && diffDays <= 7) && atRisk;
  });
  if (soon) return "amber";

  return "green";
}

function computeScopeRagFromWbs(wbsJson: any): WeeklyRag {
  // expect wbs tasks/items list with status
  const items = Array.isArray(wbsJson?.items) ? wbsJson.items : Array.isArray(wbsJson?.workItems) ? wbsJson.workItems : [];
  if (!items.length) return "green";

  const blocked = items.filter((it: any) => s(it?.status).toLowerCase() === "blocked").length;
  const total = items.length;

  // simple thresholds
  const ratio = total ? blocked / total : 0;
  if (ratio >= 0.25) return "red";
  if (ratio >= 0.10) return "amber";
  return "green";
}

async function loadProjectArtifacts(projectId: string) {
  const sb = await createClient();

  // You may need to adjust table/columns to your schema.
  // Assumption: artifacts table has { project_id, type, content_json, updated_at }
  const { data, error } = await sb
    .from("artifacts")
    .select("id,type,content_json,updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

4) Enrich meta inside the Weekly branch (core change)

Inside your Weekly branch, after you compute fallbackFrom/fallbackTo/meta/context, add:

    const projectId = s(body?.projectId || body?.project_id || meta?.projectId || meta?.project_id).trim();

    // ✅ We'll enrich meta if projectId exists. Otherwise zero behavior change.
    let enrichedMeta: any = meta;

    if (projectId) {
      try {
        const rows = await loadProjectArtifacts(projectId);

        // collect weekly reports (same schema)
        const weeklyDocs: WeeklyReportDocV1[] = rows
          .filter((r: any) => s(r?.type).toLowerCase() === "weekly_report")
          .map((r: any) => r?.content_json)
          .filter((x: any) => x && typeof x === "object" && s(x.type) === "weekly_report");

        const prev = pickLatestDocBeforePeriod(weeklyDocs, fallbackFrom);

        // schedule + wbs artifacts (adjust type names if yours differ)
        const schedule = rows.find((r: any) => s(r?.type).toLowerCase() === "schedule")?.content_json ?? null;
        const wbs = rows.find((r: any) => s(r?.type).toLowerCase() === "wbs")?.content_json ?? null;

        // milestones from schedule (if present)
        const schedItems = Array.isArray(schedule?.items) ? schedule.items : [];
        const scheduleMilestones = schedItems
          .filter((it: any) => s(it?.type).toLowerCase() === "milestone")
          .map((it: any) => ({
            name: s(it?.name).trim(),
            due: s(it?.end || it?.due || it?.date || "").slice(0, 10) || null,
          }))
          .filter((m: any) => m.name)
          .slice(0, 8);

        // dimension rags
        const timeRag = schedule ? computeTimeRagFromSchedule(schedule, fallbackTo) : undefined;
        const scopeRag = wbs ? computeScopeRagFromWbs(wbs) : undefined;

        // previous milestone rag map (optional)
        const prevMilestones: Record<string, { rag?: WeeklyRag }> = {};
        if (prev && prev?.completedThisPeriod) {
          // we can’t truly know milestone rag from the old schema,
          // but we can store previous overall rag per milestone name if it appeared.
          const prevItems = tableFirstColBullets(prev.completedThisPeriod, 20);
          for (const t of prevItems) {
            prevMilestones[t] = { rag: prev.rag };
          }
        }

        enrichedMeta = {
          ...(meta || {}),
          previous: prev
            ? {
                rag: prev.rag,
                milestonesByName: prevMilestones,
              }
            : undefined,
          dimensions: {
            ...(meta?.dimensions || {}),
            ...(timeRag ? { time: timeRag } : {}),
            ...(scopeRag ? { scope: scopeRag } : {}),
          },
          milestones: scheduleMilestones.length ? scheduleMilestones : undefined,
        };
      } catch {
        // swallow errors to keep behaviour stable
        enrichedMeta = meta;
      }
    }


Then make sure both mock + LLM paths use enrichedMeta instead of meta.

Mock path: replace meta block usage

In mock path, when you build weeklyDoc, include meta: enrichedMeta:

      const weeklyDoc = normalizeWeeklyDoc(
        {
          ...,
          operationalBlockers: "",
          meta: enrichedMeta,
        },
        { from: fallbackFrom, to: fallbackTo, rag }
      );

LLM path: pass enrichedMeta into the user prompt + also merge into candidate

Replace JSON.stringify(meta ?? {}, null, 2) with JSON.stringify(enrichedMeta ?? {}, null, 2).

Then right before normalizing, merge:

      const candidate = parsed?.content_json ?? parsed?.contentJson ?? parsed;

      // ✅ ensure meta survives even if the model doesn't echo it back
      const weeklyDoc = normalizeWeeklyDoc(
        { ...(candidate || {}), meta: { ...(candidate?.meta || {}), ...(enrichedMeta || {}) } },
        { from: fallbackFrom, to: fallbackTo, rag }
      );

Important note about “milestones = schedule milestones”

Right now your weekly doc schema has tables, not a milestones[] list — so we don’t “force” milestones into the table automatically unless you want that.

If you do want the milestone table (in PPT) to be schedule milestones, your PPT exporter should read:

model.meta.milestones[] (schedule milestones)

and use meta.previous to colour-compare

That is exactly why I added meta.milestones.