// src/app/api/ai/project-health/route.ts
// Per-project health scoring — aligned with server/project-health.ts logic
// Schedule: schedule_milestones + wbs_items (DB)
// RAID: type-aware (Issue > Risk > Dependency > Assumption)
// Budget: spend vs budget + overallocation
// Governance: charter, budget plan, stakeholder register, Gate 1, Gate 5

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";
export const revalidate = 0;

type RagLetter = "G" | "A" | "R";
type PartKey   = "schedule" | "raid" | "financial" | "resource";

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function num(x: any, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }
function clamp(x: any) { const n = Number(x); if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); }
function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }
function scoreToRag(s: number): RagLetter { return s >= 85 ? "G" : s >= 70 ? "A" : "R"; }
function canonType(a: any) { return safeStr(a?.artifact_type || a?.type).trim().toUpperCase(); }
function isUuidLike(s: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s); }

/* ─── resource heuristics (unchanged) ─── */

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
    if (Array.isArray(cur)) { out.push(cur); for (const it of cur) q.push(it); continue; }
    for (const k of Object.keys(cur)) { const v = (cur as any)[k]; if (!v || typeof v !== "object") continue; q.push(v); }
  }
  return out;
}
function looksLikePersonId(v: any) {
  const s = safeStr(v).trim();
  if (!s) return false;
  if (s.includes("@")) return true;
  if (isUuidLike(s)) return true;
  return s.length >= 6;
}
function extractResourceRoleStats(j: any): { total: number; unassigned: number } {
  if (!j || typeof j !== "object") return { total: 0, unassigned: 0 };
  let best = { total: 0, unassigned: 0 };
  for (const arr of findArraysDeep(j)) {
    if (!arr?.length) continue;
    let total = 0, unassigned = 0;
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const role = safeStr((row as any).role || (row as any).role_name || (row as any).roleName || (row as any).capability || (row as any).title);
      if (!role.length) continue;
      total++;
      const person = (row as any).personId ?? (row as any).person_id ?? (row as any).assigneeId ?? (row as any).assignee_id ?? (row as any).userId ?? (row as any).user_id ?? (row as any).email;
      if (!looksLikePersonId(person)) unassigned++;
    }
    if (total > best.total) best = { total, unassigned };
  }
  return best;
}
function extractWbsAssignmentStats(j: any): { total: number; unassigned: number } {
  if (!j || typeof j !== "object") return { total: 0, unassigned: 0 };
  let best = { total: 0, unassigned: 0 };
  for (const arr of findArraysDeep(j)) {
    if (!arr?.length) continue;
    let total = 0, unassigned = 0;
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const label = safeStr((row as any).title || (row as any).name || (row as any).task || "");
      const maybeWbs = label.length > 0 || safeStr((row as any).wbs_code || (row as any).code || "").length > 0 || typeof (row as any).duration === "number";
      if (!maybeWbs) continue;
      total++;
      const assignee = (row as any).assigned_to ?? (row as any).assignedTo ?? (row as any).assignee ?? (row as any).owner ?? (row as any).userId ?? (row as any).user_id ?? (row as any).email;
      if (!looksLikePersonId(assignee)) unassigned++;
    }
    if (total > best.total) best = { total, unassigned };
  }
  return best;
}

/* ─── SCHEDULE scorer (DB milestones + WBS) ─── */

function scoreSchedule(milestones: any[], wbsItems: any[], today: string) {
  const signals: string[] = [];
  const detail = { total: 0, overdue: 0, critical: 0, avgSlipDays: 0, wbsTotal: 0, wbsComplete: 0, wbsCompletionPct: 0 };

  if (!milestones.length && !wbsItems.length) return { score: 78, signals: ["No schedule data"], detail };

  // WBS completion
  if (wbsItems.length) {
    detail.wbsTotal = wbsItems.length;
    const done = new Set(["done", "completed", "complete", "closed", "delivered"]);
    detail.wbsComplete = wbsItems.filter((w: any) => done.has(String(w?.delivery_status || w?.status || "").toLowerCase().replace(/\s+/g, "_"))).length;
    detail.wbsCompletionPct = Math.round((detail.wbsComplete / detail.wbsTotal) * 100);
  }

  let score = 100;
  let slipSum = 0, slipCount = 0;
  detail.total = milestones.length;

  for (const m of milestones) {
    const st   = String(m.status ?? "").toLowerCase();
    const done = ["completed", "done", "closed"].includes(st);
    const end  = m.end_date     ? String(m.end_date).slice(0, 10)     : null;
    const base = m.baseline_end ? String(m.baseline_end).slice(0, 10) : null;

    if (!done && end && end < today) {
      detail.overdue++;
      if (m.critical_path_flag) { detail.critical++; score -= 12; } else { score -= 8; }
    }
    if (end && base) {
      const slip = Math.max(0, Math.round((new Date(end + "T00:00:00Z").getTime() - new Date(base + "T00:00:00Z").getTime()) / 86400000));
      slipSum += slip; slipCount++;
    }
  }

  detail.avgSlipDays = slipCount ? Math.round(slipSum / slipCount) : 0;
  score -= Math.min(15, Math.round(detail.avgSlipDays * 1.5));

  if (detail.overdue > 0) signals.push(detail.overdue + " overdue milestone" + (detail.overdue > 1 ? "s" : ""));
  if (detail.avgSlipDays > 0) signals.push("Avg slip " + detail.avgSlipDays + "d");

  // WBS completion penalty
  if (detail.wbsTotal > 0) {
    const pct = detail.wbsCompletionPct;
    if      (pct < 30) { score -= 15; signals.push("WBS completion very low (" + pct + "%)"); }
    else if (pct < 50) { score -= 10; signals.push("WBS completion low (" + pct + "%)"); }
    else if (pct < 70) { score -= 5; }
  }

  return { score: clamp(score), signals, detail };
}

/* ─── RAID scorer (type-aware) ─── */

function raidItemType(r: any): "issue" | "risk" | "dependency" | "assumption" | "other" {
  const t = String(r?.type || r?.item_type || r?.category || r?.kind || "").toLowerCase();
  if (t.includes("issue") || t.includes("action"))  return "issue";
  if (t.includes("risk"))                           return "risk";
  if (t.includes("depend"))                         return "dependency";
  if (t.includes("assump"))                         return "assumption";
  return "other";
}

function raidItemSev(r: any): "high" | "medium" | "low" {
  const p = Number(r.probability ?? 0);
  const s = Number(r.severity ?? 0);
  const composite = (r.probability != null && r.severity != null) ? Math.round((p * s) / 100) : 0;
  if (composite >= 70) return "high";
  if (composite >= 40) return "medium";
  const label = String(r?.severity_label || r?.severity || r?.impact || r?.priority || r?.rag || "").toLowerCase();
  if (["high", "critical", "severe", "red"].some((k) => label.includes(k))) return "high";
  if (["medium", "med", "amber"].some((k) => label.includes(k))) return "medium";
  return "low";
}

function raidItemOpen(r: any): boolean {
  const st = String(r?.status || r?.state || "").toLowerCase();
  if (!st) return true;
  return !["closed", "resolved", "complete", "completed", "cancelled", "canceled"].some((k) => st.includes(k));
}

function scoreRaid(raidItems: any[], today: string) {
  const signals: string[] = [];
  const detail = { total: 0, openIssues: 0, highSeverityIssues: 0, highRisks: 0, openDependencies: 0, openAssumptions: 0, overdue: 0 };

  if (!raidItems.length) return { score: null as number | null, signals: ["No RAID data"], detail };

  detail.total = raidItems.length;
  let score = 100;
  let overduePenalty = 0;

  for (const r of raidItems) {
    if (!raidItemOpen(r)) continue;

    const typ = raidItemType(r);
    const sev = raidItemSev(r);
    const due = r.due_date ? String(r.due_date).slice(0, 10) : null;

    if (due && due < today) { detail.overdue++; overduePenalty = Math.min(20, overduePenalty + 5); }

    if (typ === "issue") {
      detail.openIssues++;
      if      (sev === "high")   { detail.highSeverityIssues++; score -= 12; }
      else if (sev === "medium") { score -= 7;  }
      else                       { score -= 3;  }
    } else if (typ === "risk") {
      if      (sev === "high")   { detail.highRisks++; score -= 8; }
      else if (sev === "medium") { score -= 4; }
      else                       { score -= 2; }
    } else if (typ === "dependency") {
      detail.openDependencies++; score -= 4;
    } else if (typ === "assumption") {
      detail.openAssumptions++; score -= 3;
    } else {
      if      (sev === "high")   score -= 6;
      else if (sev === "medium") score -= 3;
      else                       score -= 1;
    }
  }

  score -= overduePenalty;

  if (detail.highSeverityIssues > 0) signals.push(detail.highSeverityIssues + " high-severity issue" + (detail.highSeverityIssues > 1 ? "s" : "") + " open");
  if (detail.highRisks > 0)          signals.push(detail.highRisks + " high risk" + (detail.highRisks > 1 ? "s" : "") + " open");
  if (detail.openDependencies > 0)   signals.push(detail.openDependencies + " open dependency item" + (detail.openDependencies > 1 ? "s" : ""));
  if (detail.openAssumptions > 0)    signals.push(detail.openAssumptions + " unvalidated assumption" + (detail.openAssumptions > 1 ? "s" : ""));
  if (detail.overdue > 0)            signals.push(detail.overdue + " overdue RAID item" + (detail.overdue > 1 ? "s" : ""));

  return { score: clamp(score), signals, detail };
}

/* ─── FINANCIAL scorer (unchanged from original) ─── */

function scoreFinancial(j: any): { score: number; signals: string[] } {
  const signals: string[] = [];
  if (!j || typeof j !== "object") return { score: 0, signals: ["No financial content_json"] };

  const rag = safeStr(j.rag || j?.summary?.rag || j?.status?.rag || "").toUpperCase().trim() as "G" | "A" | "R" | "";
  if (rag === "G") return { score: 92, signals: [] };
  if (rag === "A") return { score: 78, signals: ["Financial plan flagged AMBER"] };
  if (rag === "R") return { score: 55, signals: ["Financial plan flagged RED"] };

  const variancePct = j.variance_pct ?? j.variancePct ?? j?.summary?.variance_pct ?? j?.summary?.variancePct ?? j?.metrics?.variance_pct ?? null;
  const spent  = j.total_spent  ?? j.totalSpent  ?? j?.summary?.total_spent  ?? null;
  const budget = j.total_approved_budget ?? j.totalApprovedBudget ?? j?.summary?.total_approved_budget ?? null;

  let score = 90;
  const vp = variancePct == null ? null : Number(variancePct);
  if (Number.isFinite(vp)) {
    score = Math.max(45, 92 - Math.max(0, vp) * 2.0);
    if (vp > 5) signals.push("Cost variance +" + Math.round(vp * 10) / 10 + "%");
  } else if (budget != null && spent != null) {
    const b = Number(budget), s = Number(spent);
    if (Number.isFinite(b) && Number.isFinite(s) && b > 0) {
      const pct = (s / b) * 100;
      if (pct > 110) { score = 55; signals.push("Spend exceeds approved budget"); }
      else if (pct > 95) { score = 70; signals.push("Spend approaching budget cap"); }
      // Overallocation signal from resource utilisation in content_json
      const util = j.utilisation_pct ?? j.utilisationPct ?? j?.summary?.utilisation_pct ?? j?.metrics?.utilisation_pct ?? null;
      const u = util == null ? null : Number(util);
      if (Number.isFinite(u) && u > 110) {
        score = Math.min(score, u > 120 ? 45 : 60);
        signals.push("Resource over-allocated (" + Math.round(u) + "% utilisation)");
      }
    }
  } else {
    score = 75; signals.push("Financial metrics incomplete");
  }

  return { score: clamp(score), signals };
}

/* ─── RESOURCE scorer (unchanged from original) ─── */

function scoreResource(j: any, ctx: { assignedCount: number | null; roleSlotsTotal: number; roleSlotsUnassigned: number; wbsTasksTotal: number; wbsTasksUnassigned: number }): { score: number; signals: string[]; drivers: string[] } {
  const signals: string[] = [];
  const drivers: string[] = [];
  const { assignedCount, roleSlotsTotal, roleSlotsUnassigned, wbsTasksTotal, wbsTasksUnassigned } = ctx;

  if (assignedCount != null && assignedCount <= 0) {
    signals.push("NO_ASSIGNED_RESOURCES");
    drivers.push("No active (non-viewer) resources assigned to the project");
    return { score: 12, signals, drivers };
  }

  const rag = j ? safeStr(j.rag || j?.summary?.rag || "").toUpperCase().trim() as "G" | "A" | "R" | "" : "";
  if (rag === "G") return { score: 92, signals: [], drivers: [] };
  if (rag === "A") return { score: 78, signals: ["Resourcing flagged AMBER"], drivers: ["Resourcing flagged AMBER"] };
  if (rag === "R") return { score: 55, signals: ["Resourcing flagged RED"], drivers: ["Resourcing flagged RED"] };

  let score = 90;
  const util = j ? (j.utilisation_pct ?? j.utilisationPct ?? j?.summary?.utilisation_pct ?? j?.metrics?.utilisation_pct ?? null) : null;
  const gaps = j ? (j.open_roles ?? j.openRoles ?? j.staffing_gaps ?? j?.summary?.open_roles ?? null) : null;

  if (!j || typeof j !== "object") {
    score = 72;
    drivers.push("Resource plan missing or incomplete");
  }

  const u = util == null ? null : Number(util);
  if (Number.isFinite(u)) {
    if      (u > 120) { score = Math.min(score, 55); signals.push("RESOURCE_OVERALLOCATED"); drivers.push("Severe overallocation (" + Math.round(u) + "% utilisation)"); }
    else if (u > 110) { score = Math.min(score, 62); signals.push("RESOURCE_OVERALLOCATED"); drivers.push("Overallocation risk (" + Math.round(u) + "% utilisation)"); }
    else if (u > 95)  { score = Math.min(score, 68); drivers.push("High utilisation " + Math.round(u) + "% (overload risk)"); }
    else if (u < 35)  { score = Math.min(score, 76); drivers.push("Low utilisation " + Math.round(u) + "% (plan may be stale)"); }
  } else if (j) {
    score = Math.min(score, 78); drivers.push("Resourcing utilisation not provided");
  }

  const g = gaps == null ? null : Number(gaps);
  if (Number.isFinite(g) && g > 0) {
    score = Math.min(score, g >= 3 ? 60 : 70);
    signals.push("CAPACITY_SHORTFALL");
    drivers.push(g + " open role gap" + (g > 1 ? "s" : ""));
  }

  if (roleSlotsTotal > 0 && roleSlotsUnassigned > 0) {
    const pct = (roleSlotsUnassigned / Math.max(1, roleSlotsTotal)) * 100;
    signals.push("UNASSIGNED_ROLES");
    drivers.push(roleSlotsUnassigned + "/" + roleSlotsTotal + " roles unassigned (" + Math.round(pct) + "%)");
    score = Math.min(score, roleSlotsUnassigned >= 3 ? 55 : pct >= 25 ? 65 : 72);
  }

  if (wbsTasksTotal > 0 && wbsTasksUnassigned > 0) {
    const pct = (wbsTasksUnassigned / Math.max(1, wbsTasksTotal)) * 100;
    signals.push("UNASSIGNED_WORK");
    drivers.push(wbsTasksUnassigned + "/" + wbsTasksTotal + " work items unassigned (" + Math.round(pct) + "%)");
    score = Math.min(score, pct >= 35 ? 55 : pct >= 20 ? 66 : 72);
  }

  return { score: clamp(score), signals, drivers };
}

/* ─── GOVERNANCE scorer ─── */

function scoreGovernance(opts: {
  charterApproved:            boolean;
  budgetApproved:             boolean;
  stakeholderRegisterPresent: boolean;
  gate1Complete:              boolean;
  gate5Applicable:            boolean;
  gate5Ready:                 boolean;
  pendingApprovalCount:       number;
  openChangeRequests:         number;
}): { score: number; signals: string[]; detail: typeof opts } {
  const signals: string[] = [];
  let achieved = 0, possible = 0;

  const add = (pts: number, met: boolean, label: string) => {
    possible += pts;
    if (met) achieved += pts;
    else signals.push(label);
  };

  add(30, opts.charterApproved,            "Charter not yet approved");
  add(20, opts.budgetApproved,             "Financial plan not yet approved");
  add(20, opts.stakeholderRegisterPresent, "Stakeholder register missing");
  add(20, opts.gate1Complete,              "Gate 1 not complete");
  if (opts.gate5Applicable) add(10, opts.gate5Ready, "Gate 5 readiness check needed");

  let score = possible > 0 ? (achieved / possible) * 100 : 50;
  score -= Math.min(20, opts.pendingApprovalCount * 4);
  score -= Math.min(15, opts.openChangeRequests   * 3);

  if (opts.pendingApprovalCount > 0) signals.push(opts.pendingApprovalCount + " pending approval" + (opts.pendingApprovalCount > 1 ? "s" : ""));
  if (opts.openChangeRequests   > 0) signals.push(opts.openChangeRequests   + " open change request" + (opts.openChangeRequests > 1 ? "s" : ""));

  return { score: clamp(score), signals, detail: opts };
}

/* ─── weighted rollup ─── */

function weightedAverage(parts: { schedule: number; raid: number; financial: number; resource: number }) {
  const w = { schedule: 0.35, raid: 0.30, financial: 0.20, resource: 0.15 };
  return clamp(parts.schedule * w.schedule + parts.raid * w.raid + parts.financial * w.financial + parts.resource * w.resource);
}

/* ─── project member count ─── */

async function getAssignedCount(supabase: any, projectId: string): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from("project_members")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("removed_at", null)
      .neq("role", "viewer");
    if (error) return null;
    return Math.max(0, typeof count === "number" ? count : 0);
  } catch { return null; }
}

/* ─── governance data fetcher ─── */

async function fetchGovernanceForProject(supabase: any, projectId: string, orgId: string) {
  const CHARTER_TYPES    = new Set(["PROJECT_CHARTER", "CHARTER"]);
  const FINANCIAL_TYPES  = new Set(["FINANCIAL_PLAN"]);
  const STAKEHOLDER_TYPES = new Set(["STAKEHOLDER_REGISTER", "STAKEHOLDERS"]);
  const APPROVED_STATUSES = new Set(["approved", "active", "current", "published", "signed_off", "signed off"]);

  const today = ymd();
  const in60  = ymd(new Date(Date.now() + 60 * 86400000));

  const [projRes, artifactsRes, approvalsRes, changeReqsRes] = await Promise.allSettled([
    supabase.from("projects").select("end_date, gate_1_completed_at, gate_1_status").eq("id", projectId).maybeSingle(),
    supabase.from("artifacts").select("artifact_type, type, status, is_current").eq("project_id", projectId).eq("is_current", true).limit(100),
    supabase.from("approvals").select("id").eq("project_id", projectId).eq("status", "pending").limit(100),
    supabase.from("change_requests").select("id, status").eq("project_id", projectId).limit(100),
  ]);

  const proj      = projRes.status      === "fulfilled" ? projRes.value.data      : null;
  const artifacts = artifactsRes.status === "fulfilled" ? artifactsRes.value.data ?? [] : [];
  const approvals = approvalsRes.status === "fulfilled" ? approvalsRes.value.data ?? [] : [];
  const changeReqs= changeReqsRes.status=== "fulfilled" ? changeReqsRes.value.data ?? [] : [];

  const endDate = proj?.end_date ? String(proj.end_date).slice(0, 10) : null;
  const gate5Applicable = !!(endDate && endDate <= in60 && endDate >= today);
  const gate1Complete   = !!(proj?.gate_1_completed_at || proj?.gate_1_status === "complete" || proj?.gate_1_status === "passed");

  let charterApproved = false, budgetApproved = false, stakeholderRegisterPresent = false;

  for (const a of artifacts) {
    const ct   = safeStr(a?.artifact_type || a?.type).trim().toUpperCase();
    const stat = String(a?.status || "").toLowerCase().replace(/\s+/g, "_");
    const isApproved = APPROVED_STATUSES.has(stat) || stat.includes("approv") || stat.includes("publish");
    if (CHARTER_TYPES.has(ct)     && isApproved) charterApproved            = true;
    if (FINANCIAL_TYPES.has(ct)   && isApproved) budgetApproved             = true;
    if (STAKEHOLDER_TYPES.has(ct))               stakeholderRegisterPresent = true;
  }

  const openStatuses = new Set(["pending", "open", "submitted", "draft"]);
  const openCRs = (changeReqs as any[]).filter((c) => openStatuses.has(String(c.status ?? "").toLowerCase())).length;

  return {
    charterApproved,
    budgetApproved,
    stakeholderRegisterPresent,
    gate1Complete,
    gate5Applicable,
    gate5Ready: false, // future: check gate5 artifact status
    pendingApprovalCount: (approvals as any[]).length,
    openChangeRequests:   openCRs,
  };
}

/* ─── route ─── */

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });

  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : "";
  if (!organisationId) return NextResponse.json({ ok: false, error: "No active organisation" }, { status: 400 });

  const sp = req.nextUrl.searchParams;
  const projectRef = safeStr(sp.get("projectId") || sp.get("project_id") || sp.get("project") || "").trim();
  if (!projectRef) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });

  try {
    // Resolve project
    let project: any = null;
    const { data: p1 } = await supabase.from("projects").select("id,title,project_code,organisation_id,deleted_at,end_date").eq("id", projectRef).maybeSingle();
    project = p1 ?? null;
    if (!project) {
      const { data: p2 } = await supabase.from("projects").select("id,title,project_code,organisation_id,deleted_at,end_date").eq("organisation_id", organisationId).eq("project_code", projectRef).maybeSingle();
      project = p2 ?? null;
    }
    if (!project || project?.deleted_at) return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    if (String(project.organisation_id || "") !== organisationId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const projectId = String(project.id);
    const today     = ymd();

    // Fetch everything in parallel
    const [artifactsRes, milestonesRes, wbsRes, raidDbRes, govData, assignedCount] = await Promise.all([
      supabase.from("artifacts").select("id,project_id,type,artifact_type,status,updated_at,content_json,is_current").eq("project_id", projectId).eq("is_current", true).limit(300),
      supabase.from("schedule_milestones").select("id, status, end_date, baseline_end, critical_path_flag").eq("project_id", projectId).limit(500),
      supabase.from("wbs_items").select("id, status, delivery_status").eq("project_id", projectId).limit(5000),
      supabase.from("raid_items").select("id, status, due_date, probability, severity, type, item_type, category, severity_label, impact, priority, rag").eq("project_id", projectId).not("status", "in", '("Closed","Invalid")').limit(500),
      fetchGovernanceForProject(supabase, projectId, organisationId),
      getAssignedCount(supabase, projectId),
    ]);

    if (artifactsRes.error) throw artifactsRes.error;

    const list        = Array.isArray(artifactsRes.data) ? artifactsRes.data : [];
    const milestones  = Array.isArray(milestonesRes.data) ? milestonesRes.data : [];
    const wbsItems    = Array.isArray(wbsRes.data) ? wbsRes.data : [];
    const raidDbItems = Array.isArray(raidDbRes.data) ? raidDbRes.data : [];

    const byType = (wanted: readonly string[]) =>
      list.filter((a: any) => wanted.includes(canonType(a))).sort((a: any, b: any) => new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime());

    const fin  = byType(["FINANCIAL_PLAN"])[0] ?? null;
    const res  = byType(["RESOURCE_PLAN", "RESOURCING_PLAN", "CAPACITY_PLAN"])[0] ?? null;
    const wbsArt = byType(["WBS", "WORK_BREAKDOWN_STRUCTURE"])[0] ?? null;

    // Resource context
    const roleStats = extractResourceRoleStats(res?.content_json);
    const wbsStats  = extractWbsAssignmentStats(wbsArt?.content_json);
    const resourceCtx = {
      assignedCount,
      roleSlotsTotal:    roleStats.total,
      roleSlotsUnassigned: roleStats.unassigned,
      wbsTasksTotal:     wbsStats.total,
      wbsTasksUnassigned: wbsStats.unassigned,
    };

    // Score all parts
    const schSc  = scoreSchedule(milestones, wbsItems, today);
    const raidSc = scoreRaid(raidDbItems, today);
    const finSc  = scoreFinancial(fin?.content_json);
    const resSc  = scoreResource(res?.content_json, resourceCtx);
    const govSc  = scoreGovernance(govData);

    const neutral = 78;
    const resourceIsHardFail = resSc.signals.includes("NO_ASSIGNED_RESOURCES");

    const parts = {
      schedule:  schSc.score,
      raid:      raidSc.score ?? neutral,
      financial: fin ? finSc.score : neutral,
      resource:  resourceIsHardFail ? resSc.score : res ? resSc.score : neutral,
    };

    const overall = weightedAverage(parts);
    const rag     = scoreToRag(overall);

    // Governance folded into overall via a separate display dimension
    // (governance doesn't affect weighted average of the 4 parts but is shown separately)
    const govAdjusted = clamp(overall * 0.9 + govSc.score * 0.1);

    const signals = [
      ...schSc.signals.map((s) => ({ part: "schedule" as const, signal: s })),
      ...(raidSc.signals ?? []).map((s) => ({ part: "raid" as const, signal: s })),
      ...finSc.signals.map((s) => ({ part: "financial" as const, signal: s })),
      ...resSc.signals.map((s) => ({ part: "resource" as const, signal: s })),
      ...govSc.signals.map((s) => ({ part: "governance" as const, signal: s })),
    ].slice(0, 30);

    const overallDrivers: string[] = [];
    if (resourceIsHardFail)         overallDrivers.push("No active resources assigned");
    if (schSc.signals[0])           overallDrivers.push("Schedule: " + schSc.signals[0]);
    if (raidSc.signals?.[0])        overallDrivers.push("RAID: " + raidSc.signals[0]);
    if (finSc.signals[0])           overallDrivers.push("Financial: " + finSc.signals[0]);
    if (govSc.signals[0])           overallDrivers.push("Governance: " + govSc.signals[0]);
    if (resSc.drivers[0] && !resourceIsHardFail) overallDrivers.push("Resourcing: " + resSc.drivers[0]);

    return NextResponse.json(
      {
        ok: true,
        project: { id: project.id, title: project.title ?? null, project_code: project.project_code ?? null, organisation_id: project.organisation_id ?? null },
        score:  govAdjusted,
        rag:    scoreToRag(govAdjusted),
        parts: {
          schedule:   { score: parts.schedule,   artifact_id: null, updated_at: null, detail: schSc.detail },
          raid:       { score: parts.raid,        artifact_id: null, updated_at: null, detail: raidSc.detail },
          financial:  { score: parts.financial,   artifact_id: fin?.id ?? null, updated_at: fin?.updated_at ?? null },
          resource:   { score: parts.resource,    artifact_id: res?.id ?? null, updated_at: res?.updated_at ?? null,
            meta: { assignedCount, roleSlots: { total: roleStats.total, unassigned: roleStats.unassigned }, wbsAssignments: { total: wbsStats.total, unassigned: wbsStats.unassigned } } },
          governance: { score: govSc.score, detail: govSc.detail },
        },
        drivers: { overall: overallDrivers.slice(0, 10), parts: { schedule: schSc.signals.slice(0, 4), raid: (raidSc.signals ?? []).slice(0, 4), financial: finSc.signals.slice(0, 4), resource: resSc.drivers.slice(0, 8), governance: govSc.signals.slice(0, 4) } },
        signals,
        meta: { thresholds: { green_gte: 85, amber_gte: 70 }, milestoneCount: milestones.length, wbsItemCount: wbsItems.length, raidDbItemCount: raidDbItems.length },
      },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } }
    );
  } catch (err: any) {
    console.error("[ai/project-health]", err);
    return NextResponse.json({ ok: false, error: safeStr(err?.message || "Project health failed") }, { status: 500 });
  }
}