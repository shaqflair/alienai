import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* -- utils ---------------------------------------------------------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function safeNum(x: unknown, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function jsonNoStore(payload: unknown, init?: ResponseInit) {
  const res = NextResponse.json(payload, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function uniqueStrings(arr: Array<string | null | undefined>) {
  return Array.from(new Set(arr.map((x) => safeStr(x).trim()).filter(Boolean)));
}
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/* -- auth ----------------------------------------------------------------- */

async function requireAuth(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

/* -- signal collector ------------------------------------------------------ */

type PortfolioSignals = {
  projectCount: number;
  ragCounts: { g: number; a: number; r: number; unscored: number };
  avgHealthScore: number | null;
  totalBudget: number;
  totalSpend: number;
  variancePct: number | null;
  pendingApprovals: number;
  overdueApprovals: number;
  openRaid: number;
  highRaid: number;
  overdueRaid: number;
  milestonesDue30d: number;
  overdueMilestones: number;
  criticalMilestones: number;
  openChanges: number;
  changesInReview: number;
  projects: Array<any>;
  gaps: Array<{
    severity: "high" | "medium" | "low";
    type: string;
    detail: string;
    project?: string;
    href?: string;
  }>;
};

async function collectSignals(supabase: any, userId: string): Promise<PortfolioSignals> {
  const scope = await resolvePortfolioScope(supabase, userId);
  const rawIds = uniqueStrings([
    ...(Array.isArray(scope?.projectIds) ? scope.projectIds : []),
    ...(Array.isArray(scope?.project_ids) ? scope.project_ids : []),
    ...(Array.isArray(scope?.projects) ? scope.projects.map((x: any) => x?.id) : []),
  ]);

  if (!rawIds.length) return emptySignals();

  let activeIds = rawIds;
  try {
    const filtered = await filterActiveProjectIds(supabase, rawIds);
    if (Array.isArray(filtered) && filtered.length) activeIds = uniqueStrings(filtered);
  } catch {}

  if (!activeIds.length) return emptySignals();

  const [
    pRes, memRes, hRes, appRes, raidRes, raidUpRes, msRes, spRes, chRes,
  ] = await Promise.all([
    supabase.from("projects").select("id, title, project_code, budget_amount, pm_name").in("id", activeIds).is("deleted_at", null).limit(200),
    supabase.from("project_members").select("project_id, user_id, role").in("project_id", activeIds).is("removed_at", null).in("role", ["project_manager", "owner"]).limit(500),
    supabase.from("project_health").select("project_id, score, rag, computed_at").in("project_id", activeIds).order("computed_at", { ascending: false }).limit(500),
    supabase.from("v_pending_artifact_approvals_all").select("project_id, step_status, sla_status").in("project_id", activeIds).eq("step_status", "pending").limit(2000),
    supabase.from("raid_items").select("project_id, type, priority, status, due_date").in("project_id", activeIds).not("status", "in", '("closed","resolved","done","completed","archived")').limit(5000),
    supabase.from("raid_items").select("project_id, updated_at").in("project_id", activeIds).order("updated_at", { ascending: false }).limit(500),
    supabase.from("schedule_milestones").select("project_id, status, end_date, critical_path_flag").in("project_id", activeIds).lte("end_date", new Date(Date.now() + 30 * 86400000).toISOString()).limit(2000),
    supabase.from("project_spend").select("project_id, amount").in("project_id", activeIds).is("deleted_at", null).limit(5000),
    supabase.from("change_requests").select("project_id, status, delivery_status, decision_status").in("project_id", activeIds).limit(2000),
  ]);

  const projects = pRes.data || [];
  const healthMap = new Map();
  (hRes.data || []).forEach(h => { if (!healthMap.has(h.project_id)) healthMap.set(h.project_id, h); });

  const raidMap = new Map();
  (raidRes.data || []).forEach(r => {
    const cur = raidMap.get(r.project_id) || { total: 0, high: 0, overdue: 0 };
    cur.total++;
    if (["high", "critical"].includes(safeLower(r.priority))) cur.high++;
    if (r.due_date && new Date(r.due_date).getTime() < Date.now()) cur.overdue++;
    raidMap.set(r.project_id, cur);
  });

  const gaps: any[] = [];
  const projectSignals: any[] = [];
  let totalBudget = 0, totalSpend = 0, gCount = 0, aCount = 0, rCount = 0, uCount = 0;
  const healthScores: number[] = [];

  for (const p of projects) {
    const pid = p.id;
    const health = healthMap.get(pid);
    const raid = raidMap.get(pid) || { total: 0, high: 0, overdue: 0 };
    const budget = safeNum(p.budget_amount);
    const rag = safeStr(health?.rag).toUpperCase() || "UNSCORED";

    if (rag === "G") { gCount++; if (health?.score) healthScores.push(health.score); }
    else if (rag === "A") { aCount++; if (health?.score) healthScores.push(health.score); }
    else if (rag === "R") { rCount++; if (health?.score) healthScores.push(health.score); }
    else uCount++;

    if (rag === "R" && raid.high === 0) {
      gaps.push({ severity: "high", type: "red_no_action", detail: "Red RAG with no high-severity risks recorded", project: p.title, href: `/projects/${pid}` });
    }

    projectSignals.push({ id: pid, name: p.title, rag, raid, budget });
    totalBudget += budget;
  }

  return {
    projectCount: projects.length,
    ragCounts: { g: gCount, a: aCount, r: rCount, unscored: uCount },
    avgHealthScore: healthScores.length ? Math.round(healthScores.reduce((a, b) => a + b, 0) / healthScores.length) : null,
    totalBudget,
    totalSpend,
    variancePct: totalBudget > 0 ? Math.round(((totalSpend - totalBudget) / totalBudget) * 100) : null,
    pendingApprovals: (appRes.data || []).length,
    overdueApprovals: (appRes.data || []).filter((a: any) => ["overdue", "breached"].includes(safeLower(a.sla_status))).length,
    openRaid: (raidRes.data || []).length,
    highRaid: (raidRes.data || []).filter((r: any) => ["high", "critical"].includes(safeLower(r.priority))).length,
    overdueRaid: (raidRes.data || []).filter((r: any) => r.due_date && new Date(r.due_date).getTime() < Date.now()).length,
    milestonesDue30d: (msRes.data || []).length,
    overdueMilestones: (msRes.data || []).filter((m: any) => m.end_date && new Date(m.end_date).getTime() < Date.now()).length,
    criticalMilestones: (msRes.data || []).filter((m: any) => m.critical_path_flag).length,
    openChanges: (chRes.data || []).length,
    changesInReview: (chRes.data || []).filter((c: any) => ["review", "submitted"].includes(safeLower(c.decision_status))).length,
    projects: projectSignals,
    gaps: gaps.slice(0, 10),
  };
}

function emptySignals(): PortfolioSignals {
  return {
    projectCount: 0, ragCounts: { g: 0, a: 0, r: 0, unscored: 0 },
    avgHealthScore: null, totalBudget: 0, totalSpend: 0, variancePct: null,
    pendingApprovals: 0, overdueApprovals: 0, openRaid: 0, highRaid: 0,
    overdueRaid: 0, milestonesDue30d: 0, overdueMilestones: 0, criticalMilestones: 0,
    openChanges: 0, changesInReview: 0, projects: [], gaps: [],
  };
}

/* -- OpenAI narrative generation ------------------------------------------- */

async function generateNarrative(signals: PortfolioSignals) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const signalSummary = `
    Active Projects: ${signals.projectCount}
    RAG: ${signals.ragCounts.g}G, ${signals.ragCounts.a}A, ${signals.ragCounts.r}R
    Overdue RAID: ${signals.overdueRaid}
    Overdue Milestones: ${signals.overdueMilestones}
    Financial Variance: ${signals.variancePct}%
  `;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are Aliena, an executive AI advisor. Return JSON with 'executive_summary', 'sections' (health, risk, delivery, finance), and 5 'talking_points'." },
      { role: "user", content: signalSummary },
    ],
  });

  return JSON.parse(completion.choices[0].message.content || "{}");
}

/* -- GET handler ----------------------------------------------------------- */

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);
    const signals = await collectSignals(supabase, user.id);

    if (signals.projectCount === 0) {
      return jsonNoStore({ ok: true, executive_summary: "No active projects.", sections: [], talking_points: [], gaps: [] });
    }

    const narrative = await generateNarrative(signals);
    return jsonNoStore({
      ok: true,
      executive_summary: narrative.executive_summary,
      sections: narrative.sections,
      talking_points: narrative.talking_points,
      gaps: signals.gaps,
      signals_summary: signals,
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return jsonNoStore({ ok: false, error: e.message }, { status: 500 });
  }
}
