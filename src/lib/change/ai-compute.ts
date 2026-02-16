import "server-only";

type AnyRow = Record<string, any>;

function clamp(n: number, a = 0, b = 100) {
  n = Number.isFinite(n) ? n : 0;
  return Math.max(a, Math.min(b, n));
}
function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function num(x: any, d = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : d;
}

/**
 * Your artifacts are stored in: public.artifacts
 * Relevant columns per your page.tsx:
 * - content_json (JSON doc)
 * - type (string)
 * - is_current (bool)
 */
async function fetchLatestArtifactContentJson(supabase: any, projectId: string, types: string[]) {
  const { data, error } = await supabase
    .from("artifacts")
    .select("id, content_json, updated_at, is_current, type")
    .eq("project_id", projectId)
    .in("type", types)
    .eq("is_current", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

function normalizeLinks(existing: any) {
  const links = typeof existing === "object" && existing ? existing : {};
  const wbsIds = Array.isArray(links.wbs_ids) ? links.wbs_ids.map(String) : [];
  const scheduleIds = Array.isArray(links.schedule_ids) ? links.schedule_ids.map(String) : [];
  const riskIds = Array.isArray(links.risk_ids) ? links.risk_ids.map(String) : [];
  return { ...links, wbs_ids: wbsIds, schedule_ids: scheduleIds, risk_ids: riskIds };
}

function extractWbsRows(wbsDoc: any): AnyRow[] {
  // WBSEditor commonly uses { rows: [...] } (your app), but keep tolerant:
  if (Array.isArray(wbsDoc?.rows)) return wbsDoc.rows;
  if (Array.isArray(wbsDoc?.items)) return wbsDoc.items;
  if (Array.isArray(wbsDoc?.data)) return wbsDoc.data;
  return [];
}

function extractScheduleItems(scheduleDoc: any): AnyRow[] {
  // ScheduleGanttEditor uses { items: [...] }
  if (Array.isArray(scheduleDoc?.items)) return scheduleDoc.items;
  if (Array.isArray(scheduleDoc?.rows)) return scheduleDoc.rows;
  return [];
}

function computeFromWbsDoc(wbsDoc: any, wbsIds: string[]) {
  const rows = extractWbsRows(wbsDoc);
  const byId = new Map<string, AnyRow>();
  for (const r of rows) {
    const id = safeStr(r?.id);
    if (id) byId.set(id, r);
  }

  const affected = wbsIds.length ? wbsIds.map((id) => byId.get(id)).filter(Boolean) as AnyRow[] : [];
  const affectedCount = affected.length;

  // scope proxy: number of affected deliverables
  const ai_scope = clamp(affectedCount * 12); // 8 items -> ~96

  // cost proxy: effort S/M/L -> 20/45/70
  const effortScore = affected.reduce((acc, r) => {
    const e = String(r?.effort ?? "").toUpperCase();
    if (e === "L") return acc + 70;
    if (e === "M") return acc + 45;
    if (e === "S") return acc + 20;
    return acc + 25;
  }, 0);

  const ai_cost = clamp(Math.round(effortScore / 2)); // compress to 0-100

  return { wbsAffected: affectedCount, ai_scope, ai_cost };
}

function computeFromScheduleDoc(scheduleDoc: any, scheduleIds: string[]) {
  const items = extractScheduleItems(scheduleDoc);
  const byId = new Map<string, AnyRow>();
  for (const it of items) {
    const id = safeStr(it?.id);
    if (id) byId.set(id, it);
  }

  const affected = scheduleIds.length ? scheduleIds.map((id) => byId.get(id)).filter(Boolean) as AnyRow[] : [];
  const affectedCount = affected.length;

  const score = affected.reduce((acc, it) => {
    const st = String(it?.status ?? "").toLowerCase();
    let base = 18;
    if (st === "at_risk") base = 35;
    if (st === "delayed") base = 55;
    if (st === "done") base = 8;

    const start = safeStr(it?.start);
    const end = safeStr(it?.end);
    if (start && end) base += 8;

    return acc + base;
  }, 0);

  const ai_schedule = clamp(Math.round(score / 1.6)); // 160 -> 100 approx
  return { scheduleAffected: affectedCount, ai_schedule };
}

export async function computeChangeAIFields({
  supabase,
  projectId,
  changeRow,
}: {
  supabase: any;
  projectId: string;
  changeRow: AnyRow;
}) {
  const links0 = normalizeLinks(changeRow?.links);

  // ✅ Look at BOTH WBS and Schedule/Roadmap
  const wbsArt = await fetchLatestArtifactContentJson(supabase, projectId, ["wbs", "work breakdown structure", "work_breakdown_structure"]).catch(
    () => null
  );

  const scheduleArt = await fetchLatestArtifactContentJson(supabase, projectId, [
    "schedule",
    "roadmap",
    "schedule / roadmap",
    "schedule_roadmap",
    "schedule_road_map",
    "gantt",
  ]).catch(() => null);

  const wbsDoc = wbsArt?.content_json ?? null;
  const scheduleDoc = scheduleArt?.content_json ?? null;

  const w = computeFromWbsDoc(wbsDoc, links0.wbs_ids);
  const s = computeFromScheduleDoc(scheduleDoc, links0.schedule_ids);

  // Blend in explicit impact_analysis if present
  const ia = changeRow?.impact_analysis ?? {};
  const explicitCost = num(ia?.cost ?? 0, 0);
  const explicitDays = num(ia?.days ?? 0, 0);

  const costBoost = explicitCost > 0 ? clamp(Math.round(Math.log10(explicitCost + 10) * 18)) : 0;
  const schedBoost = explicitDays !== 0 ? clamp(Math.round(Math.abs(explicitDays) * 6)) : 0;

  const ai_cost = clamp(Math.round(w.ai_cost * 0.75 + costBoost * 0.25));
  const ai_schedule = clamp(Math.round(s.ai_schedule * 0.75 + schedBoost * 0.25));
  const ai_scope = clamp(w.ai_scope);

  const ai_score = clamp(Math.round(ai_schedule * 0.40 + ai_cost * 0.35 + ai_scope * 0.25));

  const links = {
    ...links0,
    wbs: w.wbsAffected,
    schedule: s.scheduleAffected,
    risks: Array.isArray(links0.risk_ids) ? links0.risk_ids.length : 0,
    wbs_artifact_id: wbsArt?.id ?? null,
    schedule_artifact_id: scheduleArt?.id ?? null,
  };

  return { ai_score, ai_schedule, ai_cost, ai_scope, links };
}
