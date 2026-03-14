// src/app/api/ai/portfolio-narrative/route.ts
// Executive portfolio briefing -- auto-generated on homepage load.
// Uses only columns confirmed safe from the working portfolio-advisor route.
// Uses Promise.allSettled so one failing query never breaks the whole response.

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* -- utils ----------------------------------------------------------------- */

function safeStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  return String(x);
}
function safeLower(x: unknown) { return safeStr(x).trim().toLowerCase(); }
function safeNum(x: unknown, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function uniq(arr: Array<string | null | undefined>) {
  return Array.from(new Set(arr.map((x) => safeStr(x).trim()).filter(Boolean)));
}
function clamp(s: string, max: number) { return s.length > max ? s.slice(0, max) : s; }
function jsonNoStore(payload: unknown, init?: ResponseInit) {
  const res = NextResponse.json(payload, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function settled<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}
function rows<T>(r: PromiseSettledResult<{ data: T[] | null; error: any } | null>): T[] {
  const v = settled(r);
  if (!v) return [];
  if (v.error) { console.warn("[portfolio-narrative] query error:", v.error.message); }
  return Array.isArray(v.data) ? v.data : [];
}

/* -- auth ------------------------------------------------------------------ */

async function requireAuth(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

/* -- scope resolution ------------------------------------------------------ */

async function resolveActiveIds(supabase: any, userId: string): Promise<string[]> {
  const scope = await resolvePortfolioScope(supabase, userId);
  const rawIds = uniq([
    ...(Array.isArray(scope?.projectIds)   ? scope.projectIds   : []),
    ...(Array.isArray(scope?.project_ids)  ? scope.project_ids  : []),
    ...(Array.isArray(scope?.projects)     ? scope.projects.map((x: any) => x?.id ?? x?.project_id) : []),
    ...(Array.isArray(scope?.items)        ? scope.items.map((x: any) => x?.id ?? x?.project_id) : []),
  ]);
  if (!rawIds.length) return [];
  try {
    const filtered = await filterActiveProjectIds(supabase, rawIds);
    const f = Array.isArray(filtered) ? uniq(filtered) : [];
    return f.length ? f : rawIds;
  } catch { return rawIds; }
}

/* -- main data collector --------------------------------------------------- */

type Signals = {
  projectCount: number;
  ragCounts: { g: number; a: number; r: number; unscored: number };
  avgHealth: number | null;
  pendingApprovals: number;
  overdueApprovals: number;
  openRaid: number;
  highRaid: number;
  overdueRaid: number;
  milestonesDue: number;
  overdueMilestones: number;
  criticalMilestones: number;
  openChanges: number;
  changesInReview: number;
  totalBudget: number;
  totalSpend: number;
  variancePct: number | null;
  projectNames: string[];
  redProjects: string[];
  amberProjects: string[];
  noPmProjects: string[];
  highRaidProjects: string[];
  staleRaidProjects: string[];
  overspendProjects: string[];
  gaps: Array<{ severity: "high" | "medium" | "low"; type: string; detail: string; project?: string; href?: string }>;
};

async function collectSignals(supabase: any, userId: string): Promise<Signals> {
  const activeIds = await resolveActiveIds(supabase, userId);

  if (!activeIds.length) {
    return emptySignals();
  }

  const now = Date.now();
  const in30 = new Date(now + 30 * 86400000).toISOString();

  // Fire all queries in parallel -- using only safe columns
  const [
    projectsR, membersR, healthR, approvalsR,
    raidR, raidUpdatesR, milestonesR, changesR,
  ] = await Promise.allSettled([

    // Projects -- try with budget_amount, fallback handled below if column missing
    supabase.from("projects")
      .select("id, title, project_code, pm_name, pm_user_id, project_manager_id, budget_amount")
      .in("id", activeIds)
      .is("deleted_at", null)
      .limit(200),

    // PM assignments
    supabase.from("project_members")
      .select("project_id, user_id, role, removed_at")
      .in("project_id", activeIds)
      .is("removed_at", null)
      .in("role", ["project_manager", "owner"])
      .limit(500),

    // Health scores
    supabase.from("project_health")
      .select("project_id, score, rag, computed_at")
      .in("project_id", activeIds)
      .order("computed_at", { ascending: false })
      .limit(500),

    // Pending approvals
    supabase.from("v_pending_artifact_approvals_all")
      .select("project_id, step_status, sla_status")
      .in("project_id", activeIds)
      .eq("step_status", "pending")
      .limit(2000),

    // Open RAID
    supabase.from("raid_items")
      .select("project_id, type, priority, status, due_date")
      .in("project_id", activeIds)
      .not("status", "in", '("closed","resolved","done","completed","archived")')
      .limit(5000),

    // Latest RAID update per project (for stale detection)
    supabase.from("raid_items")
      .select("project_id, updated_at")
      .in("project_id", activeIds)
      .order("updated_at", { ascending: false })
      .limit(500),

    // Milestones due in 30 days
    supabase.from("schedule_milestones")
      .select("project_id, status, end_date, critical_path_flag")
      .in("project_id", activeIds)
      .lte("end_date", in30)
      .limit(2000),

    // Change requests
    supabase.from("change_requests")
      .select("project_id, status, delivery_status, decision_status")
      .in("project_id", activeIds)
      .limit(2000),
  ]);

  // Load spend separately (simpler than expanding the destructure)
  let spendRows: any[] = [];
  try {
    const spendResult = await supabase.from("project_spend")
      .select("project_id, amount")
      .in("project_id", activeIds)
      .limit(100000);
    if (Array.isArray(spendResult.data)) spendRows = spendResult.data;
  } catch { /* spend optional */ }

  const projects   = rows<any>(projectsR);
  const members    = rows<any>(membersR);
  const healthRows = rows<any>(healthR);
  const approvals  = rows<any>(approvalsR);
  const raidItems  = rows<any>(raidR);
  const raidUpds   = rows<any>(raidUpdatesR);
  const milestones = rows<any>(milestonesR);
  const changes    = rows<any>(changesR);

  // If projects came back empty (query error), fall back to activeIds for counting
  const projectCount = projects.length || activeIds.length;

  // PM names
  const pmUserIds = uniq(members.map((m: any) => m?.user_id));
  const profileMap = new Map<string, string>();
  if (pmUserIds.length) {
    const { data: profs } = await supabase.from("profiles")
      .select("user_id, full_name, email").in("user_id", pmUserIds).limit(500);
    for (const p of Array.isArray(profs) ? profs : []) {
      const uid = safeStr(p?.user_id).trim();
      if (uid) profileMap.set(uid, safeStr(p?.full_name).trim() || safeStr(p?.email).trim() || "Unknown");
    }
  }
  const pmByProject = new Map<string, string>();
  for (const m of members) {
    const pid = safeStr(m?.project_id).trim();
    if (!pid || pmByProject.has(pid)) continue;
    pmByProject.set(pid, profileMap.get(safeStr(m?.user_id).trim()) ?? "Unknown PM");
  }

  // Health per project (latest only)
  // FIX: normalise rag to single letter -- DB may store "green"/"GREEN"/"G" or "amber"/"A" or "red"/"R"
  // Also derive from score if rag column is null (score >= 85 = G, >= 70 = A, else R)
  function normaliseRag(raw: unknown, score?: number): string {
    const s = safeStr(raw).trim().toLowerCase();
    if (s === "g" || s === "green") return "G";
    if (s === "a" || s === "amber") return "A";
    if (s === "r" || s === "red")   return "R";
    // Fall back to deriving from score
    if (score != null && Number.isFinite(score)) {
      if (score >= 85) return "G";
      if (score >= 70) return "A";
      return "R";
    }
    return "UNSCORED";
  }

  const healthMap = new Map<string, { score: number; rag: string; computed_at: string }>();
  for (const h of healthRows) {
    const pid   = safeStr(h?.project_id).trim();
    if (!pid || healthMap.has(pid)) continue;
    const score = safeNum(h?.score);
    const rag   = normaliseRag(h?.rag, score);
    healthMap.set(pid, { score, rag, computed_at: safeStr(h?.computed_at) });
  }

  // Approvals per project
  const approvalMap = new Map<string, { total: number; overdue: number }>();
  for (const a of approvals) {
    const pid = safeStr(a?.project_id).trim(); if (!pid) continue;
    const cur = approvalMap.get(pid) ?? { total: 0, overdue: 0 };
    cur.total++;
    const sla = safeLower(a?.sla_status);
    if (sla === "overdue" || sla === "breached") cur.overdue++;
    approvalMap.set(pid, cur);
  }

  // RAID per project
  const raidMap = new Map<string, { total: number; high: number; overdue: number }>();
  for (const r of raidItems) {
    const pid = safeStr(r?.project_id).trim(); if (!pid) continue;
    const cur = raidMap.get(pid) ?? { total: 0, high: 0, overdue: 0 };
    cur.total++;
    const pri = safeLower(r?.priority);
    if (pri === "high" || pri === "critical") cur.high++;
    if (r?.due_date && new Date(r.due_date).getTime() < now) cur.overdue++;
    raidMap.set(pid, cur);
  }

  // Latest RAID update per project
  const raidLatest = new Map<string, string>();
  for (const r of raidUpds) {
    const pid = safeStr(r?.project_id).trim();
    if (!pid || raidLatest.has(pid)) continue;
    raidLatest.set(pid, safeStr(r?.updated_at));
  }

  // Milestones per project
  const msMap = new Map<string, { due: number; overdue: number; critical: number }>();
  for (const m of milestones) {
    const pid = safeStr(m?.project_id).trim(); if (!pid) continue;
    const st = safeLower(m?.status);
    if (st === "done" || st === "completed" || st === "closed") continue;
    const cur = msMap.get(pid) ?? { due: 0, overdue: 0, critical: 0 };
    cur.due++;
    const d = new Date(safeStr(m?.end_date)).getTime();
    if (Number.isFinite(d) && d < now) cur.overdue++;
    if (m?.critical_path_flag) cur.critical++;
    msMap.set(pid, cur);
  }

  // Changes per project
  const changeMap = new Map<string, { open: number; review: number }>();
  for (const c of changes) {
    const pid = safeStr(c?.project_id).trim(); if (!pid) continue;
    const st = safeLower(c?.delivery_status ?? c?.status ?? "");
    if (st === "closed" || st === "implemented") continue;
    const cur = changeMap.get(pid) ?? { open: 0, review: 0 };
    cur.open++;
    if (st === "review" || safeLower(c?.decision_status) === "submitted") cur.review++;
    changeMap.set(pid, cur);
  }

  // Use projects array if available, otherwise use activeIds for project loop
  const projectList = projects.length
    ? projects
    : activeIds.map((id) => ({ id, title: null, project_code: null, pm_name: null, pm_user_id: null, project_manager_id: null }));

  // Spend per project
  const spendMap = new Map<string, number>();
  for (const s of spendRows) {
    const pid = safeStr(s?.project_id).trim(); if (!pid) continue;
    spendMap.set(pid, (spendMap.get(pid) ?? 0) + safeNum(s?.amount));
  }

  // Aggregate
  let g = 0, a = 0, r = 0, unscored = 0;
  let pendingApprovals = 0, overdueApprovals = 0;
  let openRaid = 0, highRaid = 0, overdueRaid = 0;
  let milestonesDue = 0, overdueMilestones = 0, criticalMilestones = 0;
  let openChanges = 0, changesInReview = 0;
  let totalBudget = 0, totalSpend = 0;
  const healthScores: number[] = [];
  const redProjects: string[] = [];
  const amberProjects: string[] = [];
  const noPmProjects: string[] = [];
  const highRaidProjects: string[] = [];
  const staleRaidProjects: string[] = [];
  const overspendProjects: string[] = [];
  const projectNames: string[] = [];
  const gaps: Signals["gaps"] = [];

  for (const p of projectList) {
    const pid  = safeStr(p?.id).trim();
    const name = safeStr(p?.title).trim() || pid;
    const pm   = pmByProject.get(pid) || safeStr(p?.pm_name).trim() || null;
    const h    = healthMap.get(pid);
    const ap   = approvalMap.get(pid) ?? { total: 0, overdue: 0 };
    const rd   = raidMap.get(pid)     ?? { total: 0, high: 0, overdue: 0 };
    const ms   = msMap.get(pid)       ?? { due: 0, overdue: 0, critical: 0 };
    const ch   = changeMap.get(pid)   ?? { open: 0, review: 0 };
    const rag  = h?.rag ?? "UNSCORED";
    const budget = safeNum(p?.budget_amount);
    const spend  = spendMap.get(pid) ?? 0;
    if (budget > 0) { totalBudget += budget; totalSpend += spend; }
    if (budget > 0 && spend > budget && ch.open === 0) {
      const overpct = Math.round(((spend - budget) / budget) * 100);
      overspendProjects.push(name);
      gaps.push({ severity: "high", type: "overspend_no_change", detail: overpct + "% over budget with no open change requests", project: name, href: "/projects/" + pid + "/change" });
    }

    projectNames.push(name);
    pendingApprovals  += ap.total;
    overdueApprovals  += ap.overdue;
    openRaid          += rd.total;
    highRaid          += rd.high;
    overdueRaid       += rd.overdue;
    milestonesDue     += ms.due;
    overdueMilestones += ms.overdue;
    criticalMilestones+= ms.critical;
    openChanges       += ch.open;
    changesInReview   += ch.review;

    if (rag === "G") { g++; if (h?.score != null) healthScores.push(h.score); }
    else if (rag === "A") { a++; if (h?.score != null) healthScores.push(h.score); }
    else if (rag === "R") { r++; if (h?.score != null) healthScores.push(h.score); redProjects.push(name); }
    else unscored++;
    if (rag === "A") amberProjects.push(name);

    // Gaps
    if (!pm) {
      noPmProjects.push(name);
      gaps.push({ severity: "high", type: "no_pm", detail: "No project manager assigned", project: name, href: "/projects/" + pid });
    }
    if (!h) {
      gaps.push({ severity: "medium", type: "no_health", detail: "No health score computed yet", project: name, href: "/projects/" + pid + "/artifacts" });
    }
    if (rd.high > 0) highRaidProjects.push(name + " (" + rd.high + " high)");

    const raidAge = raidLatest.has(pid)
      ? Math.floor((now - new Date(raidLatest.get(pid)!).getTime()) / 86400000)
      : null;
    if (raidAge !== null && raidAge >= 14) {
      staleRaidProjects.push(name);
      gaps.push({ severity: "medium", type: "stale_raid", detail: "RAID not updated in " + raidAge + " days", project: name, href: "/projects/" + pid + "/raid" });
    }

    if (rag === "R" && rd.high === 0 && ch.review === 0) {
      gaps.push({ severity: "high", type: "red_no_action", detail: "Red RAG with no high-severity risks or changes in review", project: name, href: "/projects/" + pid + "/artifacts" });
    }

    if (ap.overdue >= 3) {
      gaps.push({ severity: "medium", type: "approvals_breach", detail: ap.overdue + " approval steps breached SLA", project: name, href: "/projects/" + pid + "/approvals/timeline" });
    }
  }

  const avgHealth = healthScores.length
    ? Math.round(healthScores.reduce((s, v) => s + v, 0) / healthScores.length)
    : null;

  const variancePct = totalBudget > 0
    ? Math.round(((totalSpend - totalBudget) / totalBudget) * 100 * 10) / 10
    : null;

  // Sort gaps: high first
  gaps.sort((x, y) => ({ high: 0, medium: 1, low: 2 }[x.severity] - { high: 0, medium: 1, low: 2 }[y.severity]));

  return {
    projectCount,
    ragCounts: { g, a, r, unscored },
    avgHealth,
    pendingApprovals, overdueApprovals,
    openRaid, highRaid, overdueRaid,
    milestonesDue, overdueMilestones, criticalMilestones,
    openChanges, changesInReview,
    totalBudget, totalSpend, variancePct,
    projectNames,
    redProjects, amberProjects, noPmProjects,
    highRaidProjects, staleRaidProjects, overspendProjects,
    gaps: gaps.slice(0, 12),
  };
}

function emptySignals(): Signals {
  return {
    projectCount: 0, ragCounts: { g: 0, a: 0, r: 0, unscored: 0 }, avgHealth: null,
    pendingApprovals: 0, overdueApprovals: 0, openRaid: 0, highRaid: 0, overdueRaid: 0,
    milestonesDue: 0, overdueMilestones: 0, criticalMilestones: 0, openChanges: 0, changesInReview: 0,
    totalBudget: 0, totalSpend: 0, variancePct: null,
    projectNames: [], redProjects: [], amberProjects: [], noPmProjects: [],
    highRaidProjects: [], staleRaidProjects: [], overspendProjects: [], gaps: [],
  };
}

/* -- OpenAI narrative ------------------------------------------------------ */

type NarrativeSection = { id: string; title: string; body: string; sentiment: string };

async function generateNarrative(sig: Signals): Promise<{
  executive_summary: string;
  sections: NarrativeSection[];
  talking_points: string[];
}> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const prompt = [
    "DATE: " + today,
    "PORTFOLIO: " + sig.projectCount + " active projects",
    "PROJECTS: " + (sig.projectNames.slice(0, 10).join(", ") || "none"),
    "RAG: " + sig.ragCounts.g + " Green | " + sig.ragCounts.a + " Amber | " + sig.ragCounts.r + " Red | " + sig.ragCounts.unscored + " Unscored",
    "AVG HEALTH: " + (sig.avgHealth != null ? sig.avgHealth + "%" : "not computed"),
    sig.redProjects.length   ? "RED PROJECTS: "   + sig.redProjects.join(", ")   : "",
    sig.amberProjects.length ? "AMBER PROJECTS: " + sig.amberProjects.join(", ") : "",
    "APPROVALS: " + sig.pendingApprovals + " pending, " + sig.overdueApprovals + " overdue SLA",
    "RAID: " + sig.openRaid + " open, " + sig.highRaid + " high severity, " + sig.overdueRaid + " overdue",
    sig.highRaidProjects.length ? "HIGH RISK PROJECTS: " + sig.highRaidProjects.join(", ") : "",
    "MILESTONES: " + sig.milestonesDue + " due in 30 days, " + sig.overdueMilestones + " overdue, " + sig.criticalMilestones + " critical path",
    "CHANGES: " + sig.openChanges + " open, " + sig.changesInReview + " awaiting decision",
    sig.totalBudget > 0
      ? "BUDGET: GBP " + Math.round(sig.totalBudget).toLocaleString() + " total | GBP " + Math.round(sig.totalSpend).toLocaleString() + " spent" + (sig.variancePct != null ? " | " + (sig.variancePct > 0 ? "+" : "") + sig.variancePct + "% variance" : "")
      : "BUDGET: No budget data configured",
    sig.noPmProjects.length ? "NO PM ASSIGNED: " + sig.noPmProjects.join(", ") : "",
    sig.staleRaidProjects.length ? "STALE RAID (14d+): " + sig.staleRaidProjects.join(", ") : "",
  ].filter(Boolean).join("\n");

  const system = `You are Aliena, an AI delivery advisor writing an executive portfolio briefing.
Write confidently in plain English. Reference specific project names and numbers from the data.
Do not invent numbers. If a value is 0 or not provided, reflect that accurately.

Return ONLY valid JSON -- no markdown, no extra keys:
{
  "executive_summary": "2-3 board-ready sentences summarising the portfolio position. Use actual numbers from the data.",
  "sections": [
    { "id": "health",   "title": "Portfolio Health",     "body": "2-3 sentences using actual RAG counts and health scores.", "sentiment": "green|amber|red|neutral" },
    { "id": "risk",     "title": "Risk and RAID",         "body": "2-3 sentences on open RAID, high-severity items, overdue items.", "sentiment": "green|amber|red|neutral" },
    { "id": "delivery", "title": "Delivery and Approvals","body": "2-3 sentences on milestones, approvals, SLA breaches.", "sentiment": "green|amber|red|neutral" },
    { "id": "finance",  "title": "Financial Position",    "body": "2-3 sentences. If no budget data is available say so clearly.", "sentiment": "green|amber|red|neutral" }
  ],
  "talking_points": [
    "Concise board-ready bullet starting with a verb or number",
    "Concise board-ready bullet starting with a verb or number",
    "Concise board-ready bullet starting with a verb or number",
    "Concise board-ready bullet starting with a verb or number",
    "Concise board-ready bullet starting with a verb or number"
  ]
}

Sentiment rules: green = no material concern, amber = needs attention, red = needs immediate executive action.
Talking points: exactly 5, each one sentence, each grounded in the data above.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1200,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user",   content: clamp(prompt, 4000) },
    ],
  });

  let result: any = {};
  try { result = JSON.parse(completion.choices[0].message.content ?? "{}"); }
  catch { throw new Error("AI returned invalid JSON"); }

  return {
    executive_summary: safeStr(result.executive_summary),
    sections: Array.isArray(result.sections)
      ? result.sections.map((s: any) => ({
          id:        safeStr(s?.id),
          title:     safeStr(s?.title),
          body:      safeStr(s?.body),
          sentiment: ["green","amber","red","neutral"].includes(s?.sentiment) ? s.sentiment : "neutral",
        })).filter((s: any) => s.id && s.body)
      : [],
    talking_points: Array.isArray(result.talking_points)
      ? result.talking_points.map((t: any) => safeStr(t)).filter(Boolean).slice(0, 5)
      : [],
  };
}

/* -- GET handler ----------------------------------------------------------- */

export async function GET() {
  try {
    const supabase = await createClient();
    const user     = await requireAuth(supabase);
    const signals  = await collectSignals(supabase, user.id);

    if (signals.projectCount === 0) {
      return jsonNoStore({
        ok: true,
        executive_summary: "No active projects found in this portfolio.",
        sections: [],
        talking_points: [],
        gaps: [],
        signals_summary: { project_count: 0, rag: { g: 0, a: 0, r: 0, unscored: 0 }, avg_health: null },
        generated_at: new Date().toISOString(),
      });
    }

    const narrative = await generateNarrative(signals);

    return jsonNoStore({
      ok: true,
      executive_summary: narrative.executive_summary,
      sections:          narrative.sections,
      talking_points:    narrative.talking_points,
      gaps:              signals.gaps,
      signals_summary: {
        project_count:       signals.projectCount,
        rag:                 signals.ragCounts,
        avg_health:          signals.avgHealth,
        pending_approvals:   signals.pendingApprovals,
        overdue_approvals:   signals.overdueApprovals,
        open_raid:           signals.openRaid,
        high_raid:           signals.highRaid,
        milestones_due:      signals.milestonesDue,
        overdue_milestones:  signals.overdueMilestones,
        total_budget:        signals.totalBudget > 0 ? signals.totalBudget : null,
        total_spend:         signals.totalSpend > 0  ? signals.totalSpend  : null,
        variance_pct:        signals.variancePct,
      },
      generated_at: new Date().toISOString(),
    });

  } catch (e: any) {
    const msg = safeStr(e?.message).toLowerCase();
    if (msg === "unauthorized" || msg.includes("jwt") || msg.includes("not authenticated")) {
      return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    console.error("[portfolio-narrative] error:", e);
    return jsonNoStore({ ok: false, error: e?.message ?? "Failed" }, { status: 500 });
  }
}