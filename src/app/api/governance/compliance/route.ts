import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(e: string, s = 400) { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any)  { return typeof x === "string" ? x.trim() : x == null ? "" : String(x); }
function safeNum(x: any)  { return isFinite(Number(x)) ? Number(x) : 0; }
function safeJson(x: any) { if (!x) return null; if (typeof x === "object") return x; try { return JSON.parse(String(x)); } catch { return null; } }
function daysSince(iso: string | null | undefined): number {
  if (!iso) return 9999;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function daysUntil(iso: string | null | undefined): number {
  if (!iso) return 9999;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}

export type CheckStatus = "pass" | "fail" | "warn" | "missing" | "na";

export type ComplianceCheck = {
  id:       string;
  label:    string;
  status:   CheckStatus;
  detail:   string;
  severity: "critical" | "high" | "medium" | "low";
};

export type ProjectCompliance = {
  projectId:     string;
  projectName:   string;
  projectCode:   string | null;
  projectStatus: string;
  overallRag:    "green" | "amber" | "red";
  failCount:     number;
  warnCount:     number;
  passCount:     number;
  checks:        ComplianceCheck[];
  lastActivity:  string | null;
  finishDate:    string | null;
};

export type ComplianceSummary = {
  total:       number;
  compliant:   number;
  warnings:    number;
  critical:    number;
  checksTotal: number;
  checksFail:  number;
  checksWarn:  number;
  checksPass:  number;
};

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail("Unauthorised", 401);

    const url   = new URL(req.url);
    const orgId = safeStr(url.searchParams.get("orgId"));
    if (!orgId) return fail("orgId required", 400);

    // ── Admin / owner gate ────────────────────────────────────────
    const { data: members } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", orgId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .in("role", ["admin", "owner"])
      .limit(1);

    if (!members?.length) return fail("Admin access required", 403);

    const admin = createServiceClient();

    // ── Load ALL non-deleted projects (no status filter — avoids case mismatch) ──
    const { data: projects, error: projErr } = await admin
      .from("projects")
      .select("id, title, project_code, status, resource_status, created_at, updated_at, finish_date, organisation_id")
      .eq("organisation_id", orgId)
      .is("deleted_at", null)
      // Exclude archived/deleted by status
      .not("status", "ilike", "%archiv%")
      .not("status", "ilike", "%delet%")
      .not("status", "ilike", "%closed%")
      .not("status", "ilike", "%cancelled%")
      .not("status", "ilike", "%canceled%")
      // Exclude pipeline projects — identified by resource_status (matches project page logic)
      .not("resource_status", "ilike", "%pipeline%")
      .order("title");

    if (projErr) {
      console.error("[compliance] projects query failed:", projErr.message);
      return fail(projErr.message, 500);
    }

    if (!projects?.length) {
      console.log("[compliance] No projects found for org:", orgId);
      return NextResponse.json({
        ok: true, projects: [],
        summary: { total: 0, compliant: 0, warnings: 0, critical: 0, checksTotal: 0, checksFail: 0, checksWarn: 0, checksPass: 0 },
      });
    }

    console.log(`[compliance] Found ${projects.length} projects for org ${orgId}`);

    const projectIds = projects.map(p => p.id);

    // ── Bulk-load all current artifacts ───────────────────────────
    const { data: artifacts } = await admin
      .from("artifacts")
      .select("id, project_id, type, artifact_type, title, approval_status, status, content_json, updated_at, created_at, is_current, deleted_at")
      .in("project_id", projectIds)
      .is("deleted_at", null)
      .eq("is_current", true);

    const artsByProject = new Map<string, typeof artifacts>();
    for (const art of (artifacts ?? [])) {
      if (!artsByProject.has(art.project_id)) artsByProject.set(art.project_id, []);
      artsByProject.get(art.project_id)!.push(art);
    }

    // ── Bulk-load raid_items (RAID is stored in its own table, not artifacts) ──
    const { data: raidRows } = await admin
      .from("raid_items")
      .select("id, project_id, type, title, status, priority, severity, impact, due_date, probability")
      .in("project_id", projectIds);

    const raidByProject = new Map<string, any[]>();
    for (const r of (raidRows ?? [])) {
      if (!raidByProject.has(r.project_id)) raidByProject.set(r.project_id, []);
      raidByProject.get(r.project_id)!.push(r);
    }

    // ── Run checks per project ────────────────────────────────────
    const projectCompliance: ProjectCompliance[] = [];

    for (const project of projects) {
      const arts   = artsByProject.get(project.id) ?? [];
      const checks: ComplianceCheck[] = [];

      const getArt = (type: string) =>
        arts.find(a =>
          safeStr(a.artifact_type).toLowerCase() === type.toLowerCase() ||
          safeStr(a.type).toLowerCase()          === type.toLowerCase() ||
          safeStr(a.type).toUpperCase()          === type.toUpperCase().replace(/ /g, "_")
        );

      const statusLower = safeStr(project.status).toLowerCase();
      const isClosing   = statusLower.includes("clos");
      const finishIn    = daysUntil(project.finish_date);

      /* ── G1: Project Charter ──────────────────────────────── */
      const charter = getArt("project_charter");
      if (!charter) {
        checks.push({ id: "g1_charter", label: "G1 — Charter", status: "missing", detail: "No project charter exists", severity: "critical" });
      } else if (charter.approval_status !== "approved") {
        checks.push({ id: "g1_charter", label: "G1 — Charter", status: "fail", detail: `Charter is ${charter.approval_status}`, severity: "critical" });
      } else {
        checks.push({ id: "g1_charter", label: "G1 — Charter", status: "pass", detail: "Approved", severity: "low" });
      }

      /* ── Gate 5: Closure Report ───────────────────────────── */
      const closure = getArt("project_closure_report");
      if (!isClosing) {
        checks.push({ id: "gate5", label: "Gate 5", status: "na", detail: "Not applicable", severity: "low" });
      } else if (!closure) {
        checks.push({ id: "gate5", label: "Gate 5", status: "missing", detail: "Closing project — no closure report", severity: "critical" });
      } else if (closure.approval_status !== "approved") {
        checks.push({ id: "gate5", label: "Gate 5", status: "fail", detail: `Closure report: ${closure.approval_status}`, severity: "high" });
      } else {
        checks.push({ id: "gate5", label: "Gate 5", status: "pass", detail: "Approved", severity: "low" });
      }

      /* ── Weekly Report ────────────────────────────────────── */
      const weekly = getArt("weekly_report") ?? arts.find(a =>
        safeStr(a.type).toUpperCase() === "WEEKLY_REPORT" ||
        safeStr(a.artifact_type).toLowerCase() === "weekly_report"
      );
      if (!weekly) {
        checks.push({ id: "weekly", label: "Weekly Report", status: "missing", detail: "No weekly report exists", severity: "high" });
      } else {
        const age = daysSince(weekly.updated_at ?? weekly.created_at);
        if (age > 14)     checks.push({ id: "weekly", label: "Weekly Report", status: "fail", detail: `Not updated in ${age} days`, severity: "high" });
        else if (age > 7) checks.push({ id: "weekly", label: "Weekly Report", status: "warn", detail: `Last updated ${age} days ago`, severity: "medium" });
        else              checks.push({ id: "weekly", label: "Weekly Report", status: "pass", detail: `Updated ${age === 0 ? "today" : `${age}d ago`}`, severity: "low" });
      }

      /* ── Budget ───────────────────────────────────────────── */
      const finPlan = getArt("financial_plan") ?? arts.find(a =>
        safeStr(a.type).toUpperCase() === "FINANCIAL_PLAN" ||
        safeStr(a.artifact_type).toLowerCase() === "financial_plan"
      );
      if (!finPlan) {
        checks.push({ id: "budget", label: "Budget", status: "missing", detail: "No financial plan exists", severity: "high" });
      } else if (finPlan.approval_status !== "approved") {
        // Financial plan must be approved by governance authority before budget is considered sanctioned
        checks.push({ id: "budget", label: "Budget", status: "fail", detail: `Financial plan not governance-approved (${finPlan.approval_status})`, severity: "high" });
      } else {
        const cj       = safeJson(finPlan.content_json);
        const approved = safeNum(cj?.total_approved_budget);
        const forecast = (Array.isArray(cj?.cost_lines) ? cj.cost_lines : [])
          .reduce((s: number, l: any) => s + safeNum(l.forecast), 0);
        if (approved === 0) {
          checks.push({ id: "budget", label: "Budget", status: "warn", detail: "Plan approved but no approved budget amount set", severity: "medium" });
        } else {
          const overpct = Math.round(((forecast - approved) / approved) * 100);
          if (overpct > 10)     checks.push({ id: "budget", label: "Budget", status: "fail",   detail: `${overpct}% over approved budget`, severity: "critical" });
          else if (overpct > 0) checks.push({ id: "budget", label: "Budget", status: "warn",   detail: `${overpct}% over approved budget`, severity: "high" });
          else                  checks.push({ id: "budget", label: "Budget", status: "pass",   detail: `${Math.round((forecast / approved) * 100)}% of approved budget`, severity: "low" });
        }
      }

      /* ── RAID ─────────────────────────────────────────────── */
      // RAID items live in raid_items table, not in artifacts
      const raidItems = raidByProject.get(project.id) ?? [];
      if (raidItems.length === 0) {
        checks.push({ id: "raid", label: "RAID", status: "missing", detail: "No RAID items logged", severity: "medium" });
      } else {
        const open     = raidItems.filter((it: any) => !["closed","resolved","complete","done","archived"].includes(safeStr(it?.status).toLowerCase()));
        const overdue  = open.filter((it: any) => { const d = it?.due_date; return d && new Date(d) < new Date(); });
        const highRisk = open.filter((it: any) => ["high","critical"].includes(safeStr(it?.severity || it?.impact || it?.priority).toLowerCase()));
        if (overdue.length > 3 || (overdue.length > 0 && highRisk.some((h: any) => overdue.includes(h)))) {
          checks.push({ id: "raid", label: "RAID", status: "fail",   detail: `${overdue.length} overdue · ${highRisk.length} high-risk`, severity: "critical" });
        } else if (overdue.length > 0 || highRisk.length > 0) {
          checks.push({ id: "raid", label: "RAID", status: "warn",   detail: `${overdue.length} overdue · ${highRisk.length} high-risk open`, severity: "high" });
        } else {
          checks.push({ id: "raid", label: "RAID", status: "pass",   detail: `${raidItems.length} items (${open.length} open), none overdue`, severity: "low" });
        }
      }

      /* ── Change Requests ──────────────────────────────────── */
      const finPlanCj = safeJson(finPlan?.content_json);
      const changes   = Array.isArray(finPlanCj?.change_exposure) ? finPlanCj.change_exposure : [];
      const pending   = changes.filter((c: any) => c.status === "pending");
      if (pending.length > 5)      checks.push({ id: "changes", label: "Change Requests", status: "fail", detail: `${pending.length} pending approval`, severity: "high" });
      else if (pending.length > 0) checks.push({ id: "changes", label: "Change Requests", status: "warn", detail: `${pending.length} pending approval`, severity: "medium" });
      else                         checks.push({ id: "changes", label: "Change Requests", status: "pass", detail: "All resolved", severity: "low" });

      /* ── Required Artifacts ───────────────────────────────── */
      // Note: RAID excluded here — checked separately via raid_items table above
      const requiredTypes = [
        { type: "schedule",             label: "Schedule" },
        { type: "wbs",                  label: "WBS" },
        { type: "stakeholder_register", label: "Stakeholder Register" },
      ];
      const missingArts = requiredTypes.filter(r =>
        !arts.some(a =>
          safeStr(a.artifact_type).toLowerCase() === r.type ||
          safeStr(a.type).toLowerCase()          === r.type ||
          safeStr(a.type).toUpperCase()          === r.type.toUpperCase()
        )
      );
      if (missingArts.length > 1)       checks.push({ id: "artifacts", label: "Artifacts", status: "fail", detail: `Missing: ${missingArts.map(m => m.label).join(", ")}`, severity: "high" });
      else if (missingArts.length === 1) checks.push({ id: "artifacts", label: "Artifacts", status: "warn", detail: `Missing: ${missingArts[0].label}`, severity: "medium" });
      else                               checks.push({ id: "artifacts", label: "Artifacts", status: "pass", detail: "All required artifacts present", severity: "low" });

      /* ── Schedule ─────────────────────────────────────────── */
      const scheduleArt = getArt("schedule");
      if (!scheduleArt) {
        checks.push({ id: "schedule", label: "Schedule", status: "missing", detail: "No schedule found", severity: "medium" });
      } else {
        const cj      = safeJson(scheduleArt.content_json);
        const tasks   = Array.isArray(cj?.milestones) ? cj.milestones : Array.isArray(cj?.tasks) ? cj.tasks : [];
        const open    = tasks.filter((t: any) => !["complete","done","closed"].includes(safeStr(t?.status).toLowerCase()));
        const overdue = open.filter((t: any) => { const d = t?.due_date||t?.end_date||t?.finish_date||t?.due; return d && new Date(d) < new Date(); });
        const crit    = overdue.filter((t: any) => t?.critical || t?.is_critical);
        if (crit.length > 0)       checks.push({ id: "schedule", label: "Schedule", status: "fail", detail: `${overdue.length} overdue (${crit.length} critical)`, severity: "critical" });
        else if (overdue.length > 2) checks.push({ id: "schedule", label: "Schedule", status: "fail", detail: `${overdue.length} milestones overdue`, severity: "high" });
        else if (overdue.length > 0) checks.push({ id: "schedule", label: "Schedule", status: "warn", detail: `${overdue.length} milestone${overdue.length > 1 ? "s" : ""} overdue`, severity: "high" });
        else                         checks.push({ id: "schedule", label: "Schedule", status: "pass", detail: `${open.length} tasks on track`, severity: "low" });
      }

      /* ── WBS ──────────────────────────────────────────────── */
      const wbsArt = getArt("wbs");
      if (!wbsArt) {
        checks.push({ id: "wbs", label: "WBS", status: "missing", detail: "No WBS found", severity: "medium" });
      } else {
        const cj = safeJson(wbsArt.content_json);
        const flatten = (items: any[]): any[] => items.flatMap((it: any) => [it, ...(Array.isArray(it?.children) ? flatten(it.children) : [])]);
        const raw     = Array.isArray(cj?.items) ? cj.items : Array.isArray(cj?.nodes) ? cj.nodes : Array.isArray(cj?.wbs) ? cj.wbs : [];
        const all     = flatten(raw);
        const open    = all.filter((it: any) => !["complete","done","closed","approved"].includes(safeStr(it?.status).toLowerCase()));
        const overdue = open.filter((it: any) => { const d = it?.due_date||it?.end_date||it?.target_date||it?.due; return d && new Date(d) < new Date(); });
        const blocked = open.filter((it: any) => safeStr(it?.status).toLowerCase() === "blocked");
        if (overdue.length > 3 || blocked.length > 0) checks.push({ id: "wbs", label: "WBS", status: "fail", detail: `${overdue.length} overdue${blocked.length > 0 ? ` · ${blocked.length} blocked` : ""}`, severity: "high" });
        else if (overdue.length > 0)                  checks.push({ id: "wbs", label: "WBS", status: "warn", detail: `${overdue.length} item${overdue.length > 1 ? "s" : ""} overdue`, severity: "medium" });
        else                                           checks.push({ id: "wbs", label: "WBS", status: "pass", detail: `${all.length} items, none overdue`, severity: "low" });
      }

      /* ── Delivery Deadline ────────────────────────────────── */
      if (!project.finish_date) {
        checks.push({ id: "deadline", label: "Deadline", status: "warn", detail: "No delivery date set", severity: "medium" });
      } else if (finishIn < 0) {
        checks.push({ id: "deadline", label: "Deadline", status: "fail", detail: `Overdue by ${Math.abs(finishIn)} days`, severity: "critical" });
      } else if (finishIn <= 7) {
        checks.push({ id: "deadline", label: "Deadline", status: "fail", detail: `Only ${finishIn} days remaining`, severity: "critical" });
      } else if (finishIn <= 30) {
        checks.push({ id: "deadline", label: "Deadline", status: "warn", detail: `${finishIn} days remaining`, severity: "high" });
      } else {
        checks.push({ id: "deadline", label: "Deadline", status: "pass", detail: `${finishIn} days remaining`, severity: "low" });
      }

      /* ── Pending Approvals ────────────────────────────────── */
      const submitted = arts.filter(a => a.approval_status === "submitted");
      if (submitted.length > 3)      checks.push({ id: "approvals", label: "Approvals", status: "fail", detail: `${submitted.length} awaiting approval`, severity: "high" });
      else if (submitted.length > 0) checks.push({ id: "approvals", label: "Approvals", status: "warn", detail: `${submitted.length} awaiting approval`, severity: "medium" });
      else                           checks.push({ id: "approvals", label: "Approvals", status: "pass", detail: "No pending approvals", severity: "low" });

      /* ── Lessons Learned ──────────────────────────────────── */
      const lessonsArt     = getArt("lessons_learned");
      const projectAgeDays = daysSince(project.created_at);
      if (projectAgeDays < 30) {
        checks.push({ id: "lessons", label: "Lessons Learned", status: "na", detail: "Not yet required (<30 days old)", severity: "low" });
      } else if (!lessonsArt) {
        checks.push({ id: "lessons", label: "Lessons Learned", status: isClosing ? "fail" : "warn", detail: "No lessons learned log exists", severity: isClosing ? "high" : "medium" });
      } else {
        const age = daysSince(lessonsArt.updated_at ?? lessonsArt.created_at);
        if (age > 60) checks.push({ id: "lessons", label: "Lessons Learned", status: "warn", detail: `Not updated in ${age} days`, severity: "low" });
        else          checks.push({ id: "lessons", label: "Lessons Learned", status: "pass", detail: `Updated ${age}d ago`, severity: "low" });
      }

      /* ── Stakeholder Register ─────────────────────────────── */
      const stakeholderArt = getArt("stakeholder_register");
      if (!stakeholderArt) {
        checks.push({ id: "stakeholders", label: "Stakeholders", status: "missing", detail: "No stakeholder register", severity: "medium" });
      } else {
        const age = daysSince(stakeholderArt.updated_at ?? stakeholderArt.created_at);
        if (age > 90) checks.push({ id: "stakeholders", label: "Stakeholders", status: "warn", detail: `Not reviewed in ${age} days`, severity: "medium" });
        else          checks.push({ id: "stakeholders", label: "Stakeholders", status: "pass", detail: `Reviewed ${age}d ago`, severity: "low" });
      }

      /* ── Overall RAG ──────────────────────────────────────── */
      const failCount   = checks.filter(c => c.status === "fail"  || c.status === "missing").length;
      const warnCount   = checks.filter(c => c.status === "warn").length;
      const passCount   = checks.filter(c => c.status === "pass").length;
      const hasCritical = checks.some(c => (c.status === "fail" || c.status === "missing") && (c.severity === "critical" || c.severity === "high"));
      const overallRag: "green" | "amber" | "red" =
        hasCritical || failCount >= 2 ? "red"
        : failCount >= 1 || warnCount >= 3 ? "amber"
        : "green";

      const lastActivity = arts.length > 0
        ? arts.reduce((latest, a) => { const d = a.updated_at ?? a.created_at; return d > latest ? d : latest; }, arts[0].updated_at ?? arts[0].created_at)
        : null;

      projectCompliance.push({
        projectId:     project.id,
        projectName:   safeStr(project.title),
        projectCode:   project.project_code ?? null,
        projectStatus: safeStr(project.status),
        overallRag,
        failCount,
        warnCount,
        passCount,
        checks,
        lastActivity,
        finishDate: project.finish_date ?? null,
      });
    }

    projectCompliance.sort((a, b) => {
      const o = { red: 0, amber: 1, green: 2 };
      const d = o[a.overallRag] - o[b.overallRag];
      return d !== 0 ? d : b.failCount - a.failCount;
    });

    const all = projectCompliance.flatMap(p => p.checks);
    const summary: ComplianceSummary = {
      total:       projectCompliance.length,
      compliant:   projectCompliance.filter(p => p.overallRag === "green").length,
      warnings:    projectCompliance.filter(p => p.overallRag === "amber").length,
      critical:    projectCompliance.filter(p => p.overallRag === "red").length,
      checksTotal: all.filter(c => c.status !== "na").length,
      checksFail:  all.filter(c => c.status === "fail" || c.status === "missing").length,
      checksWarn:  all.filter(c => c.status === "warn").length,
      checksPass:  all.filter(c => c.status === "pass").length,
    };

    return NextResponse.json({ ok: true, projects: projectCompliance, summary });

  } catch (e: any) {
    console.error("[governance/compliance] FATAL:", e?.message, e?.stack);
    return fail(e?.message ?? "Unexpected error", 500);
  }
}