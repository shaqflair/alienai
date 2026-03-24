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
  id:        string;
  label:     string;
  status:    CheckStatus;
  detail:    string;
  severity: "critical" | "high" | "medium" | "low";
};

export type ProjectCompliance = {
  projectId:    string;
  projectName:  string;
  projectCode:  string | null;
  projectStatus:string;
  overallRag:   "green" | "amber" | "red";
  failCount:    number;
  warnCount:    number;
  passCount:    number;
  checks:       ComplianceCheck[];
  lastActivity: string | null;
  finishDate:   string | null;
};

export type ComplianceSummary = {
  total:     number;
  compliant: number;
  warnings:  number;
  critical:  number;
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
    if (!orgId)  return fail("orgId required", 400);

    // -- Admin-only gate -------------------------------------------
    const { data: member } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", orgId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!member)                 return fail("Forbidden", 403);
    if (member.role !== "admin") return fail("Admin access required", 403);

    const admin = createServiceClient();

    // -- Load all active projects ----------------------------------
    const { data: projects, error: projErr } = await admin
      .from("projects")
      .select("id, title, project_code, status, created_at, updated_at, finish_date, organisation_id")
      .eq("organisation_id", orgId)
      .is("deleted_at", null)
      .in("status", ["active", "on_hold", "at_risk", "closing"])
      .order("title");

    if (projErr) return fail(projErr.message, 500);
    if (!projects?.length) {
      return NextResponse.json({ ok: true, projects: [], summary: { total: 0, compliant: 0, warnings: 0, critical: 0, checksTotal: 0, checksFail: 0, checksWarn: 0, checksPass: 0 } });
    }

    const projectIds = projects.map(p => p.id);

    // -- Bulk-load all current artifacts for all projects ----------
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

    // -- Run checks per project ------------------------------------
    const projectCompliance: ProjectCompliance[] = [];

    for (const project of projects) {
      const arts    = artsByProject.get(project.id) ?? [];
      const checks: ComplianceCheck[] = [];

      // Helper: find artifact by type (case-insensitive, checks both columns)
      const getArt = (type: string) =>
        arts.find(a =>
          safeStr(a.artifact_type).toLowerCase() === type.toLowerCase() ||
          safeStr(a.type).toLowerCase()          === type.toLowerCase() ||
          safeStr(a.type).toUpperCase()          === type.toUpperCase()
        );

      const isClosing = ["closing", "closed"].includes(safeStr(project.status).toLowerCase());
      const finishIn  = daysUntil(project.finish_date);

      /* -- G1: Project Charter approved ----------------------- */
      const charter = getArt("project_charter");
      if (!charter) {
        checks.push({ id: "g1_charter", label: "G1 — Charter", status: "missing", detail: "No project charter exists", severity: "critical" });
      } else if (charter.approval_status !== "approved") {
        checks.push({ id: "g1_charter", label: "G1 — Charter", status: "fail", detail: `Charter status: ${charter.approval_status}`, severity: "critical" });
      } else {
        checks.push({ id: "g1_charter", label: "G1 — Charter", status: "pass", detail: "Approved", severity: "low" });
      }

      /* -- Gate 5: Closure report ----------------------------- */
      const closure = getArt("project_closure_report");
      if (!isClosing) {
        checks.push({ id: "gate5", label: "Gate 5", status: "na", detail: "Not applicable — project not closing", severity: "low" });
      } else if (!closure) {
        checks.push({ id: "gate5", label: "Gate 5", status: "missing", detail: "Project is closing — no closure report", severity: "critical" });
      } else if (closure.approval_status !== "approved") {
        checks.push({ id: "gate5", label: "Gate 5", status: "fail", detail: `Closure report: ${closure.approval_status}`, severity: "high" });
      } else {
        checks.push({ id: "gate5", label: "Gate 5", status: "pass", detail: "Closure report approved", severity: "low" });
      }

      /* -- Weekly Report: overdue ----------------------------- */
      const weekly = getArt("weekly_report") ?? arts.find(a => safeStr(a.type).toUpperCase() === "WEEKLY_REPORT");
      if (!weekly) {
        checks.push({ id: "weekly", label: "Weekly Report", status: "missing", detail: "No weekly report exists", severity: "high" });
      } else {
        const age = daysSince(weekly.updated_at ?? weekly.created_at);
        if (age > 14)      checks.push({ id: "weekly", label: "Weekly Report", status: "fail",   detail: `Not updated in ${age} days`,               severity: "high" });
        else if (age > 7)  checks.push({ id: "weekly", label: "Weekly Report", status: "warn",   detail: `Last updated ${age} days ago`,               severity: "medium" });
        else               checks.push({ id: "weekly", label: "Weekly Report", status: "pass",   detail: `Updated ${age === 0 ? "today" : `${age}d ago`}`, severity: "low" });
      }

      /* -- Budget: forecast vs approved ---------------------- */
      const finPlan = getArt("financial_plan") ?? arts.find(a => safeStr(a.type).toUpperCase() === "FINANCIAL_PLAN");
      if (!finPlan) {
        checks.push({ id: "budget", label: "Budget", status: "missing", detail: "No financial plan", severity: "medium" });
      } else {
        const cj      = safeJson(finPlan.content_json);
        const approved = safeNum(cj?.total_approved_budget);
        const forecast = (Array.isArray(cj?.cost_lines) ? cj.cost_lines : []).reduce((s: number, l: any) => s + safeNum(l.forecast), 0);
        if (approved === 0) {
          checks.push({ id: "budget", label: "Budget", status: "warn", detail: "No approved budget set", severity: "medium" });
        } else {
          const overpct = Math.round(((forecast - approved) / approved) * 100);
          if (overpct > 10)  checks.push({ id: "budget", label: "Budget", status: "fail", detail: `${overpct}% over approved budget`, severity: "critical" });
          else if (overpct > 0) checks.push({ id: "budget", label: "Budget", status: "warn", detail: `${overpct}% over approved budget`, severity: "high" });
          else               checks.push({ id: "budget", label: "Budget", status: "pass", detail: `${Math.round((forecast / approved) * 100)}% of budget`, severity: "low" });
        }
      }

      /* -- RAID: overdue / high-risk items ------------------- */
      const raidArt = getArt("raid");
      if (!raidArt) {
        checks.push({ id: "raid", label: "RAID", status: "missing", detail: "No RAID log", severity: "medium" });
      } else {
        const cj      = safeJson(raidArt.content_json);
        const items   = Array.isArray(cj?.items) ? cj.items : Array.isArray(cj?.raid) ? cj.raid : [];
        const openItems = items.filter((it: any) => !["closed","resolved","complete"].includes(safeStr(it?.status).toLowerCase()));
        const overdue  = openItems.filter((it: any) => {
          const due = it?.due_date || it?.due || it?.target_date;
          return due && new Date(due) < new Date();
        });
        const highRisk = openItems.filter((it: any) =>
          ["high","critical"].includes(safeStr(it?.severity || it?.impact || it?.priority || it?.likelihood).toLowerCase())
        );
        if (overdue.length > 3 || (overdue.length > 0 && highRisk.some((h: any) => overdue.includes(h)))) {
          checks.push({ id: "raid", label: "RAID", status: "fail", detail: `${overdue.length} overdue, ${highRisk.length} high-risk`, severity: "critical" });
        } else if (overdue.length > 0 || highRisk.length > 0) {
          checks.push({ id: "raid", label: "RAID", status: "warn", detail: `${overdue.length} overdue · ${highRisk.length} high-risk`, severity: "high" });
        } else {
          checks.push({ id: "raid", label: "RAID", status: "pass", detail: `${openItems.length} open, none overdue`, severity: "low" });
        }
      }

      /* -- Change Requests: pending / unapproved ------------- */
      const finPlanCj = safeJson(finPlan?.content_json);
      const changes   = Array.isArray(finPlanCj?.change_exposure) ? finPlanCj.change_exposure : [];
      const pending   = changes.filter((c: any) => c.status === "pending");
      if (pending.length > 5)      checks.push({ id: "changes", label: "Change Requests", status: "fail", detail: `${pending.length} pending approval`, severity: "high" });
      else if (pending.length > 0) checks.push({ id: "changes", label: "Change Requests", status: "warn", detail: `${pending.length} pending approval`, severity: "medium" });
      else                         checks.push({ id: "changes", label: "Change Requests", status: "pass", detail: "All resolved", severity: "low" });

      /* -- Required Artifacts: present / missing ------------- */
      const required = [
        { type: "raid",              label: "RAID Log" },
        { type: "schedule",          label: "Schedule" },
        { type: "wbs",               label: "WBS" },
        { type: "stakeholder_register", label: "Stakeholder Register" },
      ];
      const missingArts = required.filter(r =>
        !arts.some(a =>
          safeStr(a.artifact_type).toLowerCase() === r.type ||
          safeStr(a.type).toLowerCase()          === r.type ||
          safeStr(a.type).toUpperCase()          === r.type.toUpperCase()
        )
      );
      if (missingArts.length > 1)    checks.push({ id: "artifacts", label: "Artifacts", status: "fail", detail: `Missing: ${missingArts.map(m => m.label).join(", ")}`, severity: "high" });
      else if (missingArts.length === 1) checks.push({ id: "artifacts", label: "Artifacts", status: "warn", detail: `Missing: ${missingArts[0].label}`, severity: "medium" });
      else                               checks.push({ id: "artifacts", label: "Artifacts", status: "pass", detail: "All required artifacts present", severity: "low" });

      /* -- Schedule: milestones overdue ---------------------- */
      const scheduleArt = getArt("schedule");
      if (!scheduleArt) {
        checks.push({ id: "schedule", label: "Schedule", status: "missing", detail: "No schedule found", severity: "medium" });
      } else {
        const cj    = safeJson(scheduleArt.content_json);
        const tasks = Array.isArray(cj?.milestones) ? cj.milestones : Array.isArray(cj?.tasks) ? cj.tasks : [];
        const openTasks = tasks.filter((t: any) => !["complete","done","closed"].includes(safeStr(t?.status).toLowerCase()));
        const overdue   = openTasks.filter((t: any) => {
          const due = t?.due_date || t?.end_date || t?.finish_date || t?.due;
          return due && new Date(due) < new Date();
        });
        const critical  = overdue.filter((t: any) => t?.critical || t?.is_critical);
        if (critical.length > 0)  checks.push({ id: "schedule", label: "Schedule", status: "fail", detail: `${overdue.length} overdue (${critical.length} critical path)`, severity: "critical" });
        else if (overdue.length > 2) checks.push({ id: "schedule", label: "Schedule", status: "fail", detail: `${overdue.length} milestones overdue`, severity: "high" });
        else if (overdue.length > 0) checks.push({ id: "schedule", label: "Schedule", status: "warn", detail: `${overdue.length} milestone${overdue.length > 1 ? "s" : ""} overdue`, severity: "high" });
        else                      checks.push({ id: "schedule", label: "Schedule", status: "pass", detail: `${openTasks.length} tasks, all on track`, severity: "low" });
      }

      /* -- WBS: overdue work packages ------------------------- */
      const wbsArt = getArt("wbs");
      if (!wbsArt) {
        checks.push({ id: "wbs", label: "WBS", status: "missing", detail: "No WBS found", severity: "medium" });
      } else {
        const cj    = safeJson(wbsArt.content_json);
        // WBS items can be nested -- flatten them
        const flattenItems = (items: any[]): any[] =>
          items.flatMap((item: any) => [item, ...(Array.isArray(item?.children) ? flattenItems(item.children) : [])]);
        const rawItems  = Array.isArray(cj?.items) ? cj.items : Array.isArray(cj?.nodes) ? cj.nodes : Array.isArray(cj?.wbs) ? cj.wbs : [];
        const allItems  = flattenItems(rawItems);
        const openItems = allItems.filter((it: any) => !["complete","done","closed","approved"].includes(safeStr(it?.status).toLowerCase()));
        const overdue   = openItems.filter((it: any) => {
          const due = it?.due_date || it?.end_date || it?.target_date || it?.due;
          return due && new Date(due) < new Date();
        });
        const blocked   = openItems.filter((it: any) => safeStr(it?.status).toLowerCase() === "blocked");

        if (overdue.length > 3 || blocked.length > 0) {
          checks.push({ id: "wbs", label: "WBS", status: "fail", detail: `${overdue.length} overdue${blocked.length > 0 ? ` · ${blocked.length} blocked` : ""}`, severity: "high" });
        } else if (overdue.length > 0) {
          checks.push({ id: "wbs", label: "WBS", status: "warn", detail: `${overdue.length} item${overdue.length > 1 ? "s" : ""} overdue`, severity: "medium" });
        } else {
          checks.push({ id: "wbs", label: "WBS", status: "pass", detail: `${allItems.length} items, none overdue`, severity: "low" });
        }
      }

      /* -- Delivery Deadline ---------------------------------- */
      if (!project.finish_date) {
        checks.push({ id: "deadline", label: "Deadline", status: "warn", detail: "No delivery date set", severity: "medium" });
      } else if (finishIn < 0) {
        checks.push({ id: "deadline", label: "Deadline", status: "fail", detail: `Overdue by ${Math.abs(finishIn)} days`, severity: "critical" });
      } else if (finishIn <= 7) {
        checks.push({ id: "deadline", label: "Deadline", status: "fail", detail: `${finishIn} days remaining`, severity: "critical" });
      } else if (finishIn <= 30) {
        checks.push({ id: "deadline", label: "Deadline", status: "warn", detail: `${finishIn} days remaining`, severity: "high" });
      } else {
        checks.push({ id: "deadline", label: "Deadline", status: "pass", detail: `${finishIn} days remaining`, severity: "low" });
      }

      /* -- Pending Approvals: submitted artifacts -------------- */
      const submitted = arts.filter(a => a.approval_status === "submitted");
      if (submitted.length > 3)      checks.push({ id: "approvals", label: "Approvals", status: "fail", detail: `${submitted.length} artifacts awaiting approval`, severity: "high" });
      else if (submitted.length > 0) checks.push({ id: "approvals", label: "Approvals", status: "warn", detail: `${submitted.length} awaiting approval`, severity: "medium" });
      else                            checks.push({ id: "approvals", label: "Approvals", status: "pass", detail: "No pending approvals", severity: "low" });

      /* -- Lessons Learned: exists & updated for mature projects */
      const lessonsArt = getArt("lessons_learned");
      const projectAgeDays = daysSince(project.created_at);
      if (projectAgeDays < 30) {
        checks.push({ id: "lessons", label: "Lessons Learned", status: "na", detail: "Not yet required (<30 days)", severity: "low" });
      } else if (!lessonsArt) {
        checks.push({ id: "lessons", label: "Lessons Learned", status: isClosing ? "fail" : "warn", detail: "No lessons learned log exists", severity: isClosing ? "high" : "medium" });
      } else {
        const age = daysSince(lessonsArt.updated_at ?? lessonsArt.created_at);
        if (age > 60)     checks.push({ id: "lessons", label: "Lessons Learned", status: "warn", detail: `Not updated in ${age} days`, severity: "low" });
        else              checks.push({ id: "lessons", label: "Lessons Learned", status: "pass", detail: `Updated ${age}d ago`, severity: "low" });
      }

      /* -- Stakeholder Register: present & not stale ----------- */
      const stakeholderArt = getArt("stakeholder_register");
      if (!stakeholderArt) {
        checks.push({ id: "stakeholders", label: "Stakeholders", status: "missing", detail: "No stakeholder register", severity: "medium" });
      } else {
        const age = daysSince(stakeholderArt.updated_at ?? stakeholderArt.created_at);
        if (age > 90)      checks.push({ id: "stakeholders", label: "Stakeholders", status: "warn", detail: `Not reviewed in ${age} days`, severity: "medium" });
        else               checks.push({ id: "stakeholders", label: "Stakeholders", status: "pass", detail: `Last reviewed ${age}d ago`, severity: "low" });
      }

      /* -- Overall RAG ------------------------------------------ */
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
        finishDate:    project.finish_date ?? null,
      });
    }

    // Sort: red -> amber -> green, then by fail count desc
    projectCompliance.sort((a, b) => {
      const order = { red: 0, amber: 1, green: 2 };
      const diff  = order[a.overallRag] - order[b.overallRag];
      return diff !== 0 ? diff : b.failCount - a.failCount;
    });

    const allChecks = projectCompliance.flatMap(p => p.checks);
    const summary: ComplianceSummary = {
      total:       projectCompliance.length,
      compliant:   projectCompliance.filter(p => p.overallRag === "green").length,
      warnings:    projectCompliance.filter(p => p.overallRag === "amber").length,
      critical:    projectCompliance.filter(p => p.overallRag === "red").length,
      checksTotal: allChecks.filter(c => c.status !== "na").length,
      checksFail:  allChecks.filter(c => c.status === "fail" || c.status === "missing").length,
      checksWarn:  allChecks.filter(c => c.status === "warn").length,
      checksPass:  allChecks.filter(c => c.status === "pass").length,
    };

    return NextResponse.json({ ok: true, projects: projectCompliance, summary });

  } catch (e: any) {
    console.error("[governance/compliance] FATAL:", e?.message, e?.stack);
    return fail(e?.message ?? "Unexpected error", 500);
  }
}
