// FILE: src/app/api/ai/project-health/route.ts
// Aliena — Project Health (AI + rules fallback)
// ✅ Aligns to artifacts.content_json (NOT data)
// ✅ Uses artifacts.is_current = true
// ✅ Enforces active organisation via getActiveOrgId()
// ✅ Thresholds: Green ≥ 85, Amber 70–84, Red < 70
//
// UPDATE (this revision):
// ✅ Uses *real* project_members table (removed_at is null = active)
// ✅ Counts assigned project resources as active project_members where role != 'viewer'
// ✅ Adds explicit resourcing risk signals:
//    - NO_ASSIGNED_RESOURCES
//    - UNASSIGNED_ROLES (from resource plan content_json)
//    - UNASSIGNED_WORK (from WBS content_json)
//    - CAPACITY_SHORTFALL / RESOURCE_OVERALLOCATED (from utilisation/gaps hints)
// ✅ Returns drivers for hover tooltips: drivers.overall + drivers.parts.*

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RagLetter = "G" | "A" | "R";
type PartKey = "schedule" | "raid" | "financial" | "resource";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function clamp01to100(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function scoreToRag(score: number): RagLetter {
  const s = clamp01to100(score);
  if (s >= 85) return "G";
  if (s >= 70) return "A";
  return "R";
}

function canonType(a: any) {
  return safeStr(a?.artifact_type || a?.type).trim().toUpperCase();
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/* =============================================================================
   Resource heuristics helpers
============================================================================= */

type ResourceContext = {
  assignedCount?: number | null;
  roleSlotsTotal?: number | null;
  roleSlotsUnassigned?: number | null;
  wbsTasksTotal?: number | null;
  wbsTasksUnassigned?: number | null;
};

function findArraysDeep(root: any, maxNodes = 2500): any[][] {
  const out: any[][] = [];
  const seen = new Set<any>();
  const q: any[] = [root];
  let steps = 0;

  while (q.length && steps < maxNodes) {
    steps++;
    const cur = q.shift();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    if (Array.isArray(cur)) {
      out.push(cur);
      for (const it of cur) q.push(it);
      continue;
    }

    for (const k of Object.keys(cur)) {
      const v = (cur as any)[k];
      if (!v || typeof v !== "object") continue;
      q.push(v);
    }
  }

  return out;
}

function pickIdLike(x: any): string {
  return safeStr(x).trim();
}

function looksLikePersonId(v: any) {
  const s = pickIdLike(v);
  if (!s) return false;
  if (s.includes("@")) return true;
  if (isUuidLike(s)) return true;
  if (s.length >= 6) return true;
  return false;
}

function extractResourceRoleStatsFromJson(j: any): { total: number; unassigned: number } {
  if (!j || typeof j !== "object") return { total: 0, unassigned: 0 };

  const arrays = findArraysDeep(j);
  let best: { total: number; unassigned: number } = { total: 0, unassigned: 0 };

  for (const arr of arrays) {
    if (!arr || arr.length < 1) continue;

    let total = 0;
    let unassigned = 0;

    for (const row of arr) {
      if (!row || typeof row !== "object") continue;

      const role = safeStr(
        (row as any).role ||
          (row as any).role_name ||
          (row as any).roleName ||
          (row as any).capability ||
          (row as any).title
      );
      const isRoleLike = role.length > 0;

      const person =
        (row as any).personId ??
        (row as any).person_id ??
        (row as any).assigneeId ??
        (row as any).assignee_id ??
        (row as any).ownerId ??
        (row as any).owner_id ??
        (row as any).userId ??
        (row as any).user_id ??
        (row as any).email ??
        (row as any).assigneeEmail ??
        (row as any).assignee_email ??
        (row as any).name_id;

      const hasPerson = looksLikePersonId(person);

      if (isRoleLike) {
        total++;
        if (!hasPerson) unassigned++;
      }
    }

    if (total > best.total) best = { total, unassigned };
  }

  return best;
}

function extractWbsAssignmentStatsFromJson(j: any): { total: number; unassigned: number } {
  if (!j || typeof j !== "object") return { total: 0, unassigned: 0 };

  const arrays = findArraysDeep(j);
  let best: { total: number; unassigned: number } = { total: 0, unassigned: 0 };

  for (const arr of arrays) {
    if (!arr || arr.length < 1) continue;

    let total = 0;
    let unassigned = 0;

    for (const row of arr) {
      if (!row || typeof row !== "object") continue;

      const label = safeStr(
        (row as any).title || (row as any).name || (row as any).task || (row as any).work_item || (row as any).workItem || ""
      );
      const maybeWbs =
        label.length > 0 ||
        safeStr((row as any).wbs_code || (row as any).wbsCode || (row as any).code || "").length > 0 ||
        typeof (row as any).duration === "number" ||
        safeStr((row as any).start_date || (row as any).startDate || "").length > 0;

      if (!maybeWbs) continue;

      const assignee =
        (row as any).assigned_to ??
        (row as any).assignedTo ??
        (row as any).assignee ??
        (row as any).assigneeId ??
        (row as any).assignee_id ??
        (row as any).owner ??
        (row as any).ownerId ??
        (row as any).owner_id ??
        (row as any).userId ??
        (row as any).user_id ??
        (row as any).email;

      const hasAssignee = looksLikePersonId(assignee);

      total++;
      if (!hasAssignee) unassigned++;
    }

    if (total > best.total) best = { total, unassigned };
  }

  return best;
}

/* =============================================================================
   Per-part scoring
============================================================================= */

function scoreFinancialFromData(j: any): { score: number; signals: string[] } {
  const signals: string[] = [];
  if (!j || typeof j !== "object") return { score: 0, signals: ["No financial content_json"] };

  const variancePct =
    j.variance_pct ??
    j.variancePct ??
    j?.summary?.variance_pct ??
    j?.summary?.variancePct ??
    j?.metrics?.variance_pct ??
    j?.metrics?.variancePct ??
    null;

  const spent = j.total_spent ?? j.totalSpent ?? j?.summary?.total_spent ?? j?.summary?.totalSpent ?? null;
  const budget = j.total_approved_budget ?? j.totalApprovedBudget ?? j?.summary?.total_approved_budget ?? j?.summary?.totalApprovedBudget ?? null;

  const rag = safeStr(j.rag || j?.summary?.rag || j?.status?.rag || "").toUpperCase().trim() as "G" | "A" | "R" | "";
  if (rag === "G") return { score: 92, signals: [] };
  if (rag === "A") return { score: 78, signals: ["Financial plan flagged AMBER"] };
  if (rag === "R") return { score: 55, signals: ["Financial plan flagged RED"] };

  let score = 90;

  const vp = variancePct == null ? null : Number(variancePct);
  if (Number.isFinite(vp)) {
    const penalty = Math.max(0, vp) * 2.0;
    score = Math.max(45, 92 - penalty);
    if (vp > 5) signals.push(`Cost variance +${Math.round(vp * 10) / 10}%`);
  } else if (budget != null && spent != null) {
    const b = Number(budget);
    const s = Number(spent);
    if (Number.isFinite(b) && Number.isFinite(s) && b > 0) {
      const pct = (s / b) * 100;
      if (pct > 95) {
        score = 70;
        signals.push("Spend approaching budget cap");
      }
      if (pct > 110) {
        score = 55;
        signals.push("Spend exceeds approved budget");
      }
    }
  } else {
    score = 75;
    signals.push("Financial metrics incomplete");
  }

  return { score: clamp01to100(score), signals };
}

function scoreResourceFromData(j: any, ctx: ResourceContext): { score: number; signals: string[]; drivers: string[] } {
  const signals: string[] = [];
  const drivers: string[] = [];

  const assignedCount = num(ctx?.assignedCount, 0);
  const roleSlotsTotal = num(ctx?.roleSlotsTotal, 0);
  const roleSlotsUnassigned = num(ctx?.roleSlotsUnassigned, 0);
  const wbsTasksTotal = num(ctx?.wbsTasksTotal, 0);
  const wbsTasksUnassigned = num(ctx?.wbsTasksUnassigned, 0);

  // R1 — No assigned resources (project_members based)
  if ((ctx?.assignedCount ?? null) != null && assignedCount <= 0) {
    signals.push("NO_ASSIGNED_RESOURCES");
    drivers.push("No active (non-viewer) resources assigned to the project");
    return { score: 12, signals, drivers };
  }

  if (!j || typeof j !== "object") {
    let score = 72;
    drivers.push("Resource plan missing or incomplete");

    if (roleSlotsTotal > 0 && roleSlotsUnassigned > 0) {
      signals.push("UNASSIGNED_ROLES");
      drivers.push(`${roleSlotsUnassigned}/${roleSlotsTotal} role slot${roleSlotsTotal > 1 ? "s" : ""} unassigned`);
      score = Math.min(score, roleSlotsUnassigned >= 3 ? 55 : 68);
    }

    if (wbsTasksTotal > 0 && wbsTasksUnassigned > 0) {
      const pct = (wbsTasksUnassigned / Math.max(1, wbsTasksTotal)) * 100;
      signals.push("UNASSIGNED_WORK");
      drivers.push(`${wbsTasksUnassigned}/${wbsTasksTotal} work items unassigned (${Math.round(pct)}%)`);
      score = Math.min(score, pct >= 35 ? 55 : 70);
    }

    return { score: clamp01to100(score), signals, drivers };
  }

  const util =
    j.utilisation_pct ??
    j.utilisationPct ??
    j?.summary?.utilisation_pct ??
    j?.summary?.utilisationPct ??
    j?.metrics?.utilisation_pct ??
    j?.metrics?.utilisationPct ??
    null;

  const gaps =
    j.open_roles ??
    j.openRoles ??
    j.staffing_gaps ??
    j.staffingGaps ??
    j?.summary?.open_roles ??
    j?.summary?.openRoles ??
    null;

  const rag = safeStr(j.rag || j?.summary?.rag || j?.status?.rag || "").toUpperCase().trim() as "G" | "A" | "R" | "";
  if (rag === "G") return { score: 92, signals: [], drivers: [] };
  if (rag === "A") return { score: 78, signals: ["Resourcing flagged AMBER"], drivers: ["Resourcing flagged AMBER"] };
  if (rag === "R") return { score: 55, signals: ["Resourcing flagged RED"], drivers: ["Resourcing flagged RED"] };

  let score = 90;

  const u = util == null ? null : Number(util);
  if (Number.isFinite(u)) {
    if (u > 120) {
      score = Math.min(score, 55);
      signals.push("RESOURCE_OVERALLOCATED");
      drivers.push(`Severe overallocation (${Math.round(u)}% utilisation)`);
    } else if (u > 110) {
      score = Math.min(score, 62);
      signals.push("RESOURCE_OVERALLOCATED");
      drivers.push(`Overallocation risk (${Math.round(u)}% utilisation)`);
    } else if (u > 95) {
      score = Math.min(score, 68);
      drivers.push(`High utilisation ${Math.round(u)}% (overload risk)`);
    } else if (u < 35) {
      score = Math.min(score, 76);
      drivers.push(`Low utilisation ${Math.round(u)}% (plan may be stale)`);
    }
  } else {
    score = Math.min(score, 78);
    drivers.push("Resourcing utilisation not provided");
  }

  const g = gaps == null ? null : Number(gaps);
  if (Number.isFinite(g) && g > 0) {
    score = Math.min(score, g >= 3 ? 60 : 70);
    signals.push("CAPACITY_SHORTFALL");
    drivers.push(`${g} open role gap${g > 1 ? "s" : ""}`);
  }

  if (roleSlotsTotal > 0 && roleSlotsUnassigned > 0) {
    const pct = (roleSlotsUnassigned / Math.max(1, roleSlotsTotal)) * 100;
    signals.push("UNASSIGNED_ROLES");
    drivers.push(`${roleSlotsUnassigned}/${roleSlotsTotal} roles unassigned (${Math.round(pct)}%)`);
    score = Math.min(score, roleSlotsUnassigned >= 3 ? 55 : pct >= 25 ? 65 : 72);
  }

  if (wbsTasksTotal > 0 && wbsTasksUnassigned > 0) {
    const pct = (wbsTasksUnassigned / Math.max(1, wbsTasksTotal)) * 100;
    signals.push("UNASSIGNED_WORK");
    drivers.push(`${wbsTasksUnassigned}/${wbsTasksTotal} work items unassigned (${Math.round(pct)}%)`);
    score = Math.min(score, pct >= 35 ? 55 : pct >= 20 ? 66 : 72);
  }

  if ((ctx?.assignedCount ?? null) != null && assignedCount > 0 && roleSlotsTotal === 0 && !Number.isFinite(u)) {
    score = Math.min(score, 78);
    drivers.push("Project has members but lacks a usable resource plan");
  }

  return { score: clamp01to100(score), signals, drivers };
}

function scoreRaidFromData(j: any): { score: number; signals: string[] } {
  const signals: string[] = [];
  if (!j || typeof j !== "object") return { score: 0, signals: ["No RAID content_json"] };

  const items = (Array.isArray(j.items) ? j.items : null) || (Array.isArray(j.register) ? j.register : null) || null;
  const risks = Array.isArray(j.risks) ? j.risks : null;
  const issues = Array.isArray(j.issues) ? j.issues : null;

  const all: any[] = ([] as any[]).concat(items ?? []).concat(risks ?? []).concat(issues ?? []);
  if (!all.length) return { score: 78, signals: ["RAID register empty or not parsed"] };

  const isOpen = (x: any) => {
    const s = safeStr(x?.status || x?.state || x?.lifecycle || "").toLowerCase();
    if (!s) return true;
    return !["closed", "resolved", "complete", "completed", "cancelled", "canceled"].some((k) => s.includes(k));
  };

  const sevVal = (x: any) => {
    const s = safeStr(x?.severity || x?.impact || x?.priority || x?.rag || "").toLowerCase();
    if (["high", "critical", "severe", "red", "r"].some((k) => s === k || s.includes(k))) return 3;
    if (["medium", "med", "amber", "a"].some((k) => s === k || s.includes(k))) return 2;
    if (["low", "green", "g"].some((k) => s === k || s.includes(k))) return 1;
    const n = Number(x?.severity_score ?? x?.severityScore ?? x?.impact_score ?? x?.impactScore);
    if (Number.isFinite(n)) return n >= 8 ? 3 : n >= 5 ? 2 : 1;
    return 1;
  };

  const open = all.filter(isOpen);
  const openHigh = open.filter((x) => sevVal(x) >= 3);
  const openMed = open.filter((x) => sevVal(x) === 2);

  let score = 92;
  score -= Math.min(25, openHigh.length * 8);
  score -= Math.min(18, openMed.length * 3);
  score -= Math.min(12, Math.max(0, open.length - 10));

  if (openHigh.length > 0) signals.push(`${openHigh.length} high severity risk/issue open`);
  if (openMed.length > 0) signals.push(`${openMed.length} medium severity risk/issue open`);

  return { score: clamp01to100(score), signals };
}

function scoreScheduleFromData(j: any): { score: number; signals: string[] } {
  const signals: string[] = [];
  if (!j || typeof j !== "object") return { score: 0, signals: ["No schedule content_json"] };

  const slipDays =
    j.slip_days ??
    j.slipDays ??
    j?.summary?.slip_days ??
    j?.summary?.slipDays ??
    j?.metrics?.slip_days ??
    j?.metrics?.slipDays ??
    null;

  const overdueCount =
    j.overdue_count ??
    j.overdueCount ??
    j?.summary?.overdue_count ??
    j?.summary?.overdueCount ??
    j?.metrics?.overdue_count ??
    j?.metrics?.overdueCount ??
    null;

  const rag = safeStr(j.rag || j?.summary?.rag || j?.status?.rag || "").toUpperCase().trim() as "G" | "A" | "R" | "";
  if (rag === "G") return { score: 92, signals: [] };
  if (rag === "A") return { score: 78, signals: ["Schedule flagged AMBER"] };
  if (rag === "R") return { score: 55, signals: ["Schedule flagged RED"] };

  let score = 92;

  const sd = slipDays == null ? null : Number(slipDays);
  if (Number.isFinite(sd)) {
    if (sd >= 20) {
      score = 55;
      signals.push(`Schedule slip ${Math.round(sd)} days`);
    } else if (sd >= 10) {
      score = 68;
      signals.push(`Schedule slip ${Math.round(sd)} days`);
    } else if (sd >= 5) {
      score = 78;
      signals.push(`Minor slip ${Math.round(sd)} days`);
    }
  }

  const oc = overdueCount == null ? null : Number(overdueCount);
  if (Number.isFinite(oc) && oc > 0) {
    score = Math.min(score, oc >= 5 ? 60 : 72);
    signals.push(`${oc} overdue milestone${oc > 1 ? "s" : ""}`);
  }

  const milestones = Array.isArray(j.milestones) ? j.milestones : Array.isArray(j.items) ? j.items : null;
  if (milestones && milestones.length) {
    const now = Date.now();
    const isDone = (m: any) => {
      const s = safeStr(m?.status || m?.state || "").toLowerCase();
      return ["done", "completed", "complete", "closed", "delivered"].some((k) => s.includes(k));
    };
    const due = (m: any) => {
      const d = safeStr(m?.dueDate || m?.due_date || m?.due_at || m?.date || "");
      const t = new Date(d).getTime();
      return Number.isFinite(t) ? t : NaN;
    };
    const overdue = milestones.filter((m: any) => !isDone(m) && Number.isFinite(due(m)) && due(m) < now - 30000);
    if (overdue.length) {
      score = Math.min(score, overdue.length >= 5 ? 58 : 70);
      signals.push(`${overdue.length} overdue milestone${overdue.length > 1 ? "s" : ""} (inferred)`);
    }
  }

  return { score: clamp01to100(score), signals };
}

function weightedAverage(parts: Record<PartKey, number>) {
  const w: Record<PartKey, number> = { schedule: 0.3, raid: 0.3, financial: 0.2, resource: 0.2 };
  const sumW = Object.values(w).reduce((a, b) => a + b, 0);
  const score =
    (parts.schedule * w.schedule + parts.raid * w.raid + parts.financial * w.financial + parts.resource * w.resource) / sumW;
  return clamp01to100(score);
}

/* =============================================================================
   Project member count (real table)
============================================================================= */

async function getAssignedCountFromProjectMembers(
  supabase: any,
  projectId: string
): Promise<{ count: number; source: string }> {
  // Count active members, excluding viewers (viewers aren't "resources" for delivery health).
  const { count, error } = await supabase
    .from("project_members")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("removed_at", null)
    .neq("role", "viewer");

  if (error) throw error;
  return { count: Math.max(0, typeof count === "number" ? count : 0), source: "project_members" };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });

  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : "";
  if (!organisationId) {
    return NextResponse.json({ ok: false, error: "No active organisation" }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const projectRef = safeStr(sp.get("projectId") || sp.get("project_id") || sp.get("project") || "").trim();
  if (!projectRef) {
    return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
  }

  try {
    // Resolve project (accept UUID or project_code-like reference)
    let project: any = null;

    const { data: p1 } = await supabase
      .from("projects")
      .select("id,title,project_code,organisation_id,deleted_at")
      .eq("id", projectRef)
      .maybeSingle();

    project = p1 ?? null;

    if (!project) {
      const { data: p2 } = await supabase
        .from("projects")
        .select("id,title,project_code,organisation_id,deleted_at")
        .eq("organisation_id", organisationId)
        .eq("project_code", projectRef)
        .maybeSingle();
      project = p2 ?? null;
    }

    if (!project || project?.deleted_at) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }

    if (String(project.organisation_id || "") !== organisationId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Pull only current artifacts for this project
    const { data: artifacts, error: artErr } = await supabase
      .from("artifacts")
      .select("id,project_id,type,artifact_type,status,updated_at,content_json,is_current")
      .eq("project_id", project.id)
      .eq("is_current", true)
      .limit(300);

    if (artErr) throw artErr;

    const list = Array.isArray(artifacts) ? artifacts : [];

    const TYPES = {
      FINANCIAL: ["FINANCIAL_PLAN"],
      RESOURCE: ["RESOURCE_PLAN", "RESOURCING_PLAN", "CAPACITY_PLAN"],
      RAID: ["RAID", "RISK_REGISTER", "ISSUE_LOG"],
      SCHEDULE: ["SCHEDULE", "PROJECT_SCHEDULE", "MILESTONE_PLAN"],
      WBS: ["WBS", "WORK_BREAKDOWN_STRUCTURE"],
    } as const;

    const byType = (wanted: readonly string[]) =>
      list
        .filter((a: any) => wanted.includes(canonType(a)))
        .sort((a: any, b: any) => new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime());

    const fin = byType(TYPES.FINANCIAL)[0] ?? null;
    const res = byType(TYPES.RESOURCE)[0] ?? null;
    const raid = byType(TYPES.RAID)[0] ?? null;
    const sch = byType(TYPES.SCHEDULE)[0] ?? null;
    const wbs = byType(TYPES.WBS)[0] ?? null;

    // Assigned resources count (active non-viewers)
    let assignedCount: number | null = null;
    let assignedSource: string | null = null;
    try {
      const assigned = await getAssignedCountFromProjectMembers(supabase, String(project.id));
      assignedCount = assigned.count;
      assignedSource = assigned.source;
    } catch {
      // If RLS blocks count or anything odd happens, treat as unknown (don’t break the endpoint).
      assignedCount = null;
      assignedSource = null;
    }

    // Parse role slots from resource plan JSON (if any)
    const roleStats = extractResourceRoleStatsFromJson(res?.content_json);
    // Parse WBS task assignment stats (if any)
    const wbsStats = extractWbsAssignmentStatsFromJson(wbs?.content_json);

    const resourceCtx: ResourceContext = {
      assignedCount,
      roleSlotsTotal: roleStats.total || 0,
      roleSlotsUnassigned: roleStats.unassigned || 0,
      wbsTasksTotal: wbsStats.total || 0,
      wbsTasksUnassigned: wbsStats.unassigned || 0,
    };

    const finSc = scoreFinancialFromData(fin?.content_json);
    const raidSc = scoreRaidFromData(raid?.content_json);
    const schSc = scoreScheduleFromData(sch?.content_json);
    const resSc = scoreResourceFromData(res?.content_json, resourceCtx);

    const partsRaw: Record<PartKey, number> = {
      financial: fin ? finSc.score : 0,
      resource: res ? resSc.score : 0,
      raid: raid ? raidSc.score : 0,
      schedule: sch ? schSc.score : 0,
    };

    const neutral = 78;
    const resourceIsHardFail = resSc.signals.includes("NO_ASSIGNED_RESOURCES");

    const partsForRollup: Record<PartKey, number> = {
      schedule: sch ? partsRaw.schedule : neutral,
      raid: raid ? partsRaw.raid : neutral,
      financial: fin ? partsRaw.financial : neutral,
      // Resource is special: if membership says 0 resources, don't neutralise.
      resource: resourceIsHardFail ? partsRaw.resource : res ? partsRaw.resource : neutral,
    };

    const overall = weightedAverage(partsForRollup);
    const rag = scoreToRag(overall);

    const signals = [
      ...schSc.signals.map((s) => ({ part: "schedule" as const, signal: s })),
      ...raidSc.signals.map((s) => ({ part: "raid" as const, signal: s })),
      ...finSc.signals.map((s) => ({ part: "financial" as const, signal: s })),
      ...resSc.signals.map((s) => ({ part: "resource" as const, signal: s })),
    ].slice(0, 30);

    const driversByPart: Record<PartKey, string[]> = {
      schedule: schSc.signals.slice(0, 4),
      raid: raidSc.signals.slice(0, 4),
      financial: finSc.signals.slice(0, 4),
      resource: resSc.drivers.slice(0, 8),
    };

    const overallDrivers: string[] = [];
    if (resourceIsHardFail) overallDrivers.push("No active resources assigned (non-viewers)");
    if (driversByPart.schedule[0]) overallDrivers.push(`Schedule: ${driversByPart.schedule[0]}`);
    if (driversByPart.raid[0]) overallDrivers.push(`RAID: ${driversByPart.raid[0]}`);
    if (driversByPart.financial[0]) overallDrivers.push(`Financial: ${driversByPart.financial[0]}`);
    if (driversByPart.resource[0] && !resourceIsHardFail) overallDrivers.push(`Resourcing: ${driversByPart.resource[0]}`);

    return NextResponse.json(
      {
        ok: true,
        project: {
          id: project.id,
          title: project.title ?? null,
          project_code: project.project_code ?? null,
          organisation_id: project.organisation_id ?? null,
        },
        score: overall,
        rag,
        parts: {
          schedule: { score: partsForRollup.schedule, artifact_id: sch?.id ?? null, updated_at: sch?.updated_at ?? null },
          raid: { score: partsForRollup.raid, artifact_id: raid?.id ?? null, updated_at: raid?.updated_at ?? null },
          financial: { score: partsForRollup.financial, artifact_id: fin?.id ?? null, updated_at: fin?.updated_at ?? null },
          resource: {
            score: partsForRollup.resource,
            artifact_id: res?.id ?? null,
            updated_at: res?.updated_at ?? null,
            meta: {
              assignedCount,
              assignedSource,
              roleSlots: { total: resourceCtx.roleSlotsTotal, unassigned: resourceCtx.roleSlotsUnassigned },
              wbsAssignments: { total: resourceCtx.wbsTasksTotal, unassigned: resourceCtx.wbsTasksUnassigned },
              wbs_artifact_id: wbs?.id ?? null,
              wbs_updated_at: wbs?.updated_at ?? null,
            },
          },
        },
        drivers: {
          overall: overallDrivers.slice(0, 10),
          parts: driversByPart,
        },
        signals,
        meta: {
          thresholds: { green_gte: 85, amber_gte: 70 },
          usedNeutralForMissing: {
            schedule: !sch,
            raid: !raid,
            financial: !fin,
            resource: !res && !resourceIsHardFail,
          },
          resourceHardFailApplied: resourceIsHardFail,
        },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err: any) {
    console.error("[ai/project-health]", err);
    return NextResponse.json({ ok: false, error: safeStr(err?.message || "Project health failed") }, { status: 500 });
  }
}