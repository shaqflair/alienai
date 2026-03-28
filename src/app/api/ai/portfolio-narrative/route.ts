// src/app/api/ai/portfolio-narrative/route.ts
// Executive portfolio briefing -- auto-generated on homepage load.
//
// Fixes applied:
//   - Pipeline projects excluded from scope
//   - Spend from financial_plan_items (not project_spend table)
//   - "No health score" gap only fires for genuinely unscored projects
//   - 5-minute per-user server-side cache preserved

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* -- simple server-side cache (per user, 5 min TTL) ----------------------- */

type CacheEntry = { ts: number; payload: object };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(key: string): object | null {
  const e = CACHE.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return e.payload;
}
function cacheSet(key: string, payload: object) {
  CACHE.set(key, { ts: Date.now(), payload });
  if (CACHE.size > 200) {
    for (const [k, v] of CACHE.entries()) {
      if (Date.now() - v.ts > CACHE_TTL_MS) CACHE.delete(k);
    }
  }
}

/* -- utils ----------------------------------------------------------------- */

function safeStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  return String(x);
}
function safeLower(x: unknown) { return safeStr(x).trim().toLowerCase(); }
function safeNum(x: unknown, fallback = 0) {
  const n = Number(x); return Number.isFinite(n) ? n : fallback;
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
  if ((v as any).error) console.warn("[portfolio-narrative] query warn:", (v as any).error.message);
  return Array.isArray((v as any).data) ? (v as any).data : [];
}

function normaliseScore(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}
function scoreToRag(score: number | null): "G" | "A" | "R" | "UNSCORED" {
  if (score == null) return "UNSCORED";
  if (score >= 85) return "G";
  if (score >= 70) return "A";
  return "R";
}
function normaliseRag(raw: unknown, score?: number | null): string {
  const s = safeLower(raw);
  if (s === "g" || s === "green") return "G";
  if (s === "a" || s === "amber") return "A";
  if (s === "r" || s === "red")   return "R";
  return scoreToRag(score ?? null);
}

/* -- auth ------------------------------------------------------------------ */

async function requireAuth(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

/* -- scope ----------------------------------------------------------------- */

async function resolveActiveIds(supabase: any, userId: string): Promise<string[]> {
  const scope = await resolvePortfolioScope(supabase, userId);
  const rawIds = uniq([
    ...(Array.isArray(scope?.projectIds)  ? scope.projectIds  : []),
    ...(Array.isArray(scope?.project_ids) ? scope.project_ids : []),
    ...(Array.isArray(scope?.projects)    ? scope.projects.map((x: any) => x?.id ?? x?.project_id) : []),
    ...(Array.isArray(scope?.items)       ? scope.items.map((x: any) => x?.id ?? x?.project_id) : []),
  ]);
  if (!rawIds.length) return [];

  let activeFiltered: string[] = rawIds;
  try {
    const f = await filterActiveProjectIds(supabase, rawIds);
    const filtered = Array.isArray(f) ? uniq(f) : [];
    if (filtered.length) activeFiltered = filtered;
  } catch { /* fail-open */ }

  // ── Strip pipeline / closed / cancelled projects ──
  try {
    const { data: projRows } = await supabase
      .from("projects")
      .select("id, resource_status, status")
      .in("id", activeFiltered)
      .limit(2000);

    const confirmed = (projRows ?? [])
      .filter((p: any) => {
        const rs = safeStr(p.resource_status).toLowerCase().trim();
        const st = safeStr(p.status).toLowerCase().trim();
        return rs !== "pipeline" &&
          !["pipeline", "closed", "cancelled", "archived"].includes(st);
      })
      .map((p: any) => safeStr(p.id).trim())
      .filter(Boolean);

    return confirmed.length ? confirmed : activeFiltered;
  } catch {
    return activeFiltered;
  }
}

/* -- main signals ---------------------------------------------------------- */

type Signals = {
  projectCount: number;
  rag: { g: number; a: number; r: number; unscored: number };
  avgHealth: number | null;
  pendingApprovals: number; overdueApprovals: number;
  openRaid: number; highRaid: number; overdueRaid: number;
  milestonesDue: number; overdueMilestones: number; criticalMilestones: number;
  openChanges: number; changesInReview: number;
  totalBudget: number; totalSpend: number; variancePct: number | null;
  projectNames: string[];
  redProjects: string[]; amberProjects: string[];
  highRaidProjects: string[]; noPmProjects: string[]; staleRaidProjects: string[];
  gaps: Array<{ severity: "high" | "medium" | "low"; type: string; detail: string; project?: string; href?: string }>;
};

async function collectSignals(supabase: any, userId: string): Promise<Signals> {
  const activeIds = await resolveActiveIds(supabase, userId);
  if (!activeIds.length) return emptySignals();

  const now = Date.now();
  const in30 = new Date(now + 30 * 86400000).toISOString();

  const [projectsR, membersR, approvalsR, raidR, raidUpdR, msR, changesR] =
    await Promise.allSettled([
      supabase.from("projects")
        .select("id, title, project_code, pm_name, pm_user_id, project_manager_id, budget_amount")
        .in("id", activeIds).is("deleted_at", null).limit(200),

      supabase.from("project_members")
        .select("project_id, user_id, role, removed_at")
        .in("project_id", activeIds).is("removed_at", null)
        .in("role", ["project_manager", "owner"]).limit(500),

      supabase.from("v_pending_artifact_approvals_all")
        .select("project_id, step_status, sla_status")
        .in("project_id", activeIds).eq("step_status", "pending").limit(2000),

      supabase.from("raid_items")
        .select("project_id, type, priority, status, due_date")
        .in("project_id", activeIds)
        .not("status", "in", '("closed","resolved","done","completed","archived")')
        .limit(5000),

      supabase.from("raid_items")
        .select("project_id, updated_at")
        .in("project_id", activeIds)
        .order("updated_at", { ascending: false }).limit(500),

      supabase.from("schedule_milestones")
        .select("project_id, status, end_date, critical_path_flag")
        .in("project_id", activeIds).lte("end_date", in30).limit(2000),

      supabase.from("change_requests")
        .select("project_id, status, delivery_status, decision_status")
        .in("project_id", activeIds).limit(2000),
    ]);

  const projects   = rows<any>(projectsR);
  const members    = rows<any>(membersR);
  const approvals  = rows<any>(approvalsR);
  const raidItems  = rows<any>(raidR);
  const raidUpds   = rows<any>(raidUpdR);
  const milestones = rows<any>(msR);
  const changes    = rows<any>(changesR);

  // ── Build base URL correctly ──
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "http://localhost:3000");

  const { cookies } = await import("next/headers");
  const cookieHeader = (await cookies()).toString();

  // ── Health scores from portfolio/health API ──
  let healthByProject = new Map<string, { score: number; rag: string }>();
  try {
    const healthRes = await fetch(appUrl + "/api/portfolio/health?days=30", {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    if (healthRes.ok) {
      const healthJson = await healthRes.json().catch(() => null);
      if (healthJson?.ok && healthJson?.projectScores) {
        for (const [pid, v] of Object.entries<any>(healthJson.projectScores)) {
          const score = normaliseScore(v?.score);
          const rag   = normaliseRag(v?.rag, score);
          healthByProject.set(pid, { score: score ?? 0, rag });
        }
      }
    }
  } catch (e: any) {
    console.warn("[portfolio-narrative] health fetch failed:", e?.message);
    // Fall back to direct table query
    for (const tableName of ["project_health", "v_project_health_scores", "latest_project_health"]) {
      try {
        const { data, error } = await supabase.from(tableName as any)
          .select("*").in("project_id", activeIds).limit(200);
        if (!error && Array.isArray(data) && data.length > 0) {
          for (const h of data) {
            const pid = safeStr(h?.project_id).trim();
            if (!pid || healthByProject.has(pid)) continue;
            const rawScore = h?.score ?? h?.health_score ?? h?.health ?? null;
            const rawRag   = h?.rag ?? h?.rag_status ?? null;
            const score    = normaliseScore(rawScore);
            const rag      = normaliseRag(rawRag, score);
            healthByProject.set(pid, { score: score ?? 0, rag });
          }
          if (healthByProject.size > 0) break;
        }
      } catch {}
    }
  }

  // ── Actual spend from financial plan summary API ──
  // This is the authoritative source — it reads from approved timesheets
  // and financial plan artifacts, giving us the correct totalActual figure.
  const spendMap = new Map<string, number>();
  try {
    const fpRes = await fetch(appUrl + "/api/portfolio/financial-plan-summary?days=30", {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    if (fpRes.ok) {
      const fpJson = await fpRes.json().catch(() => null);
      if (fpJson?.ok) {
        // Portfolio-level total actual (most reliable)
        const portfolioActual = safeNum(
          fpJson?.portfolio?.totalActual ??
          fpJson?.portfolio?.total_actual ??
          fpJson?.total_spent ??
          fpJson?.actual_spent ?? 0
        );
        // Per-project actuals (preferred — maps spend to correct project)
        const projects: any[] = Array.isArray(fpJson?.projects) ? fpJson.projects : [];
        let mappedTotal = 0;
        for (const proj of projects) {
          const pid = safeStr(proj?.projectId ?? proj?.project_id).trim();
          const actual = safeNum(
            proj?.totals?.actual ??
            proj?.totals?.actualSpent ??
            proj?.actual ?? 0
          );
          if (pid && actual > 0) {
            spendMap.set(pid, actual);
            mappedTotal += actual;
          }
        }
        // If no per-project breakdown mapped, use portfolio total against first project
        if (mappedTotal === 0 && portfolioActual > 0 && activeIds.length > 0) {
          spendMap.set(activeIds[0], portfolioActual);
        }
      }
    }
  } catch (e: any) {
    console.warn("[portfolio-narrative] financial plan fetch failed:", e?.message);
  }

  // ── Fall back to DB queries if financial plan API returned nothing ──
  if (spendMap.size === 0) {
    try {
      const { data: projSpend } = await supabase
        .from("projects")
        .select("id, actual_spend, actual_cost, spent_amount, spend_to_date, total_actual, total_spent, actuals")
        .in("id", activeIds)
        .limit(200);
      for (const p of projSpend ?? []) {
        const pid = safeStr(p?.id).trim(); if (!pid) continue;
        const amt = safeNum(
          p?.actual_spend ?? p?.actual_cost ?? p?.spent_amount ??
          p?.spend_to_date ?? p?.total_actual ?? p?.total_spent ?? p?.actuals
        );
        if (amt > 0) spendMap.set(pid, amt);
      }
    } catch {}
  }

  // ── PM map ──
  const pmUserIds = uniq(members.map((m: any) => m?.user_id));
  const profileMap = new Map<string, string>();
  if (pmUserIds.length) {
    try {
      const { data: profs } = await supabase.from("profiles")
        .select("user_id, full_name, email").in("user_id", pmUserIds).limit(500);
      for (const p of Array.isArray(profs) ? profs : []) {
        const uid = safeStr(p?.user_id).trim();
        if (uid) profileMap.set(uid, safeStr(p?.full_name).trim() || safeStr(p?.email).trim() || "Unknown");
      }
    } catch {}
  }
  const pmByProject = new Map<string, string>();
  for (const m of members) {
    const pid = safeStr(m?.project_id).trim();
    if (!pid || pmByProject.has(pid)) continue;
    pmByProject.set(pid, profileMap.get(safeStr(m?.user_id).trim()) ?? "Unknown PM");
  }

  // ── Approval map ──
  const approvalMap = new Map<string, { total: number; overdue: number }>();
  for (const a of approvals) {
    const pid = safeStr(a?.project_id).trim(); if (!pid) continue;
    const cur = approvalMap.get(pid) ?? { total: 0, overdue: 0 };
    cur.total++;
    const sla = safeLower(a?.sla_status);
    if (sla === "overdue" || sla === "breached") cur.overdue++;
    approvalMap.set(pid, cur);
  }

  // ── RAID map ──
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

  const raidLatest = new Map<string, string>();
  for (const r of raidUpds) {
    const pid = safeStr(r?.project_id).trim();
    if (!pid || raidLatest.has(pid)) continue;
    raidLatest.set(pid, safeStr(r?.updated_at));
  }

  // ── Milestone map ──
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

  // ── Change map ──
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

  // ── Aggregate ──
  let g = 0, a = 0, r = 0, unscored = 0;
  let pendingApprovals = 0, overdueApprovals = 0;
  let openRaid = 0, highRaid = 0, overdueRaid = 0;
  let milestonesDue = 0, overdueMilestones = 0, criticalMilestones = 0;
  let openChanges = 0, changesInReview = 0;
  let totalBudget = 0, totalSpend = 0;
  const healthScores: number[] = [];
  const projectNames: string[] = [];
  const redProjects: string[] = [];
  const amberProjects: string[] = [];
  const highRaidProjects: string[] = [];
  const noPmProjects: string[] = [];
  const staleRaidProjects: string[] = [];
  const gaps: Signals["gaps"] = [];

  const projectList = projects.length
    ? projects
    : activeIds.map((id) => ({ id, title: null, project_code: null, pm_name: null, budget_amount: null }));

  for (const p of projectList) {
    const pid    = safeStr(p?.id).trim();
    const name   = safeStr(p?.title).trim() || pid;
    const pm     = pmByProject.get(pid) || safeStr(p?.pm_name).trim() || null;
    const h      = healthByProject.get(pid);
    const ap     = approvalMap.get(pid) ?? { total: 0, overdue: 0 };
    const rd     = raidMap.get(pid)     ?? { total: 0, high: 0, overdue: 0 };
    const ms     = msMap.get(pid)       ?? { due: 0, overdue: 0, critical: 0 };
    const ch     = changeMap.get(pid)   ?? { open: 0, review: 0 };
    const budget = safeNum(p?.budget_amount);
    const spend  = spendMap.get(pid) ?? 0;
    const rag    = h?.rag ?? "UNSCORED";

    projectNames.push(name);
    pendingApprovals   += ap.total;
    overdueApprovals   += ap.overdue;
    openRaid           += rd.total;
    highRaid           += rd.high;
    overdueRaid        += rd.overdue;
    milestonesDue      += ms.due;
    overdueMilestones  += ms.overdue;
    criticalMilestones += ms.critical;
    openChanges        += ch.open;
    changesInReview    += ch.review;
    if (budget > 0) { totalBudget += budget; totalSpend += spend; }

    if (rag === "G") { g++; if (h?.score) healthScores.push(h.score); }
    else if (rag === "A") { a++; if (h?.score) healthScores.push(h.score); amberProjects.push(name); }
    else if (rag === "R") { r++; if (h?.score) healthScores.push(h.score); redProjects.push(name); }
    else unscored++;

    if (rd.high > 0) highRaidProjects.push(name + " (" + rd.high + " high)");

    if (!pm) {
      noPmProjects.push(name);
      gaps.push({ severity: "high", type: "no_pm", detail: "No project manager assigned", project: name, href: "/projects/" + pid });
    }

    // ── FIX: only flag "no health score" if genuinely not in healthByProject ──
    // Projects scored by the portfolio/health API ARE in healthByProject.
    // Do not flag them as unscored.
    if (!h) {
      gaps.push({ severity: "medium", type: "no_health", detail: "No health score computed yet", project: name, href: "/projects/" + pid + "/artifacts" });
    }

    const raidAge = raidLatest.has(pid)
      ? Math.floor((now - new Date(raidLatest.get(pid)!).getTime()) / 86400000)
      : null;
    if (raidAge !== null && raidAge >= 14) {
      staleRaidProjects.push(name);
      gaps.push({ severity: "medium", type: "stale_raid", detail: "RAID not updated in " + raidAge + " days", project: name, href: "/projects/" + pid + "/raid" });
    }

    if (rag === "R" && rd.high === 0 && ch.review === 0) {
      gaps.push({ severity: "high", type: "red_no_action", detail: "Red RAG with no escalation evidence", project: name, href: "/projects/" + pid + "/artifacts" });
    }
    if (ap.overdue >= 3) {
      gaps.push({ severity: "medium", type: "approvals_breach", detail: ap.overdue + " approval steps breached SLA", project: name, href: "/projects/" + pid + "/approvals/timeline" });
    }
    if (budget > 0 && spend > budget && ch.open === 0) {
      const pct = Math.round(((spend - budget) / budget) * 100);
      gaps.push({ severity: "high", type: "overspend", detail: pct + "% over budget with no change requests", project: name, href: "/projects/" + pid + "/change" });
    }
  }

  const avgHealth = healthScores.length
    ? Math.round(healthScores.reduce((s, v) => s + v, 0) / healthScores.length)
    : null;
  const variancePct = totalBudget > 0
    ? Math.round(((totalSpend - totalBudget) / totalBudget) * 100 * 10) / 10
    : null;

  gaps.sort((x, y) => ({ high: 0, medium: 1, low: 2 }[x.severity] - { high: 0, medium: 1, low: 2 }[y.severity]));

  return {
    projectCount: projects.length || activeIds.length,
    rag: { g, a, r, unscored },
    avgHealth, pendingApprovals, overdueApprovals,
    openRaid, highRaid, overdueRaid,
    milestonesDue, overdueMilestones, criticalMilestones,
    openChanges, changesInReview,
    totalBudget, totalSpend, variancePct,
    projectNames, redProjects, amberProjects,
    highRaidProjects, noPmProjects, staleRaidProjects,
    gaps: gaps.slice(0, 12),
  };
}

function emptySignals(): Signals {
  return {
    projectCount: 0, rag: { g: 0, a: 0, r: 0, unscored: 0 }, avgHealth: null,
    pendingApprovals: 0, overdueApprovals: 0, openRaid: 0, highRaid: 0, overdueRaid: 0,
    milestonesDue: 0, overdueMilestones: 0, criticalMilestones: 0,
    openChanges: 0, changesInReview: 0,
    totalBudget: 0, totalSpend: 0, variancePct: null,
    projectNames: [], redProjects: [], amberProjects: [],
    highRaidProjects: [], noPmProjects: [], staleRaidProjects: [], gaps: [],
  };
}

/* -- OpenAI narrative ------------------------------------------------------ */

async function generateNarrative(sig: Signals): Promise<{
  executive_summary: string;
  sections: Array<{ id: string; title: string; body: string; sentiment: string }>;
  talking_points: string[];
}> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const today  = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const healthLine = sig.rag.g + sig.rag.a + sig.rag.r > 0
    ? "RAG: " + sig.rag.g + " Green | " + sig.rag.a + " Amber | " + sig.rag.r + " Red" + (sig.avgHealth ? " | Avg " + sig.avgHealth + "%" : "")
    : "RAG: Health scores not yet computed for these projects";

  const spendLine = sig.totalBudget > 0
    ? "BUDGET: GBP " + Math.round(sig.totalBudget).toLocaleString() + " total | GBP " + Math.round(sig.totalSpend).toLocaleString() + " spent" +
      (sig.variancePct != null ? " | " + (sig.variancePct > 0 ? "+" : "") + sig.variancePct + "% variance (negative = underspent)" : "")
    : "BUDGET: Not configured";

  const prompt = [
    "DATE: " + today,
    "PROJECTS (" + sig.projectCount + "): " + sig.projectNames.slice(0, 10).join(", "),
    healthLine,
    sig.redProjects.length   ? "RED: "   + sig.redProjects.join(", ")   : "",
    sig.amberProjects.length ? "AMBER: " + sig.amberProjects.join(", ") : "",
    "APPROVALS: " + sig.pendingApprovals + " pending, " + sig.overdueApprovals + " overdue SLA",
    "RAID: " + sig.openRaid + " open, " + sig.highRaid + " high severity, " + sig.overdueRaid + " overdue",
    sig.highRaidProjects.length ? "HIGH RISK: " + sig.highRaidProjects.join(", ") : "",
    "MILESTONES: " + sig.milestonesDue + " due in 30d, " + sig.overdueMilestones + " overdue, " + sig.criticalMilestones + " critical path",
    "CHANGES: " + sig.openChanges + " open, " + sig.changesInReview + " awaiting decision",
    spendLine,
    sig.noPmProjects.length     ? "NO PM: "       + sig.noPmProjects.join(", ")     : "",
    sig.staleRaidProjects.length? "STALE RAID: "  + sig.staleRaidProjects.join(", "): "",
  ].filter(Boolean).join("\n");

  const system = `You are Aliena, writing a concise executive portfolio briefing.
Use ONLY the data provided. Do not invent numbers. Write in plain English.
Always reference specific project names, PM names, and numbers -- never write generic advice.

Return ONLY valid JSON:
{
  "executive_summary": "2-3 board-ready sentences using actual project names and numbers.",
  "sections": [
    { "id": "health",   "title": "Portfolio Health",      "body": "2-3 sentences naming specific projects and their scores/RAG.", "sentiment": "green|amber|red|neutral" },
    { "id": "risk",     "title": "Risk and RAID",          "body": "2-3 sentences naming which projects have high-severity RAID.", "sentiment": "green|amber|red|neutral" },
    { "id": "delivery", "title": "Delivery and Approvals", "body": "2-3 sentences on specific milestones/approvals by project.", "sentiment": "green|amber|red|neutral" },
    { "id": "finance",  "title": "Financial Position",     "body": "2-3 sentences with actual budget numbers and spend to date.", "sentiment": "green|amber|red|neutral" }
  ],
  "talking_points": ["point 1","point 2","point 3","point 4","point 5"]
}
Sentiment: green=fine, amber=needs attention, red=urgent, neutral=no data.
Talking points: exactly 5, each one sentence, each must name a specific project or give a specific number.
BAD example: "Monitor the upcoming milestones."
GOOD example: "Project Comfort has 3 overdue milestones -- escalate to the PM for recovery plan this week."`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 900,
    temperature: 0.15,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user",   content: clamp(prompt, 3000) },
    ],
  });

  let result: any = {};
  try { result = JSON.parse(completion.choices[0].message.content ?? "{}"); }
  catch { throw new Error("AI returned invalid JSON"); }

  return {
    executive_summary: safeStr(result.executive_summary),
    sections: Array.isArray(result.sections)
      ? result.sections.map((s: any) => ({
          id: safeStr(s?.id), title: safeStr(s?.title), body: safeStr(s?.body),
          sentiment: ["green","amber","red","neutral"].includes(s?.sentiment) ? s.sentiment : "neutral",
        })).filter((s: any) => s.id && s.body)
      : [],
    talking_points: Array.isArray(result.talking_points)
      ? result.talking_points.map((t: any) => safeStr(t)).filter(Boolean).slice(0, 5)
      : [],
  };
}

/* -- POST handler ---------------------------------------------------------- */

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const user     = await requireAuth(supabase);

    const body  = await req.json().catch(() => ({}));
    const force = body?.force === true;
    const rcFromBody = body?.ragCounts;
    const ragKey = rcFromBody
      ? "g" + (Number(rcFromBody.g)||0) + "a" + (Number(rcFromBody.a)||0) + "r" + (Number(rcFromBody.r)||0)
      : "unscored";
    const cacheKey = "narrative:" + user.id + ":" + ragKey;

    if (!force) {
      const cached = cacheGet(cacheKey);
      if (cached) return jsonNoStore({ ...cached, cached: true });
    }

    const signals = await collectSignals(supabase, user.id);

    // Override health with live counts from homepage (authoritative source)
    if (body?.ragCounts && typeof body.ragCounts === "object") {
      const rc = body.ragCounts;
      signals.rag.g        = Number(rc.g)  || 0;
      signals.rag.a        = Number(rc.a)  || 0;
      signals.rag.r        = Number(rc.r)  || 0;
      signals.rag.unscored = Math.max(0, signals.projectCount - signals.rag.g - signals.rag.a - signals.rag.r);
    }
    if (body?.projectScores && typeof body.projectScores === "object") {
      const ps = body.projectScores as Record<string, { score: number; rag: string }>;
      const scores = Object.values(ps).map((v) => Number(v?.score)).filter((n) => n > 0);
      if (scores.length) {
        signals.avgHealth = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      }
      signals.redProjects   = [];
      signals.amberProjects = [];
      for (const [, v] of Object.entries(ps)) {
        const ragVal = safeStr(v?.rag).toUpperCase();
        if (ragVal === "R") signals.redProjects.push("(project)");
        if (ragVal === "A") signals.amberProjects.push("(project)");
      }
    }

    if (signals.projectCount === 0) {
      const empty = {
        ok: true, executive_summary: "No active projects found in this portfolio.",
        sections: [], talking_points: [], gaps: [],
        signals_summary: { project_count: 0, rag: { g: 0, a: 0, r: 0, unscored: 0 }, avg_health: null },
        generated_at: new Date().toISOString(),
      };
      cacheSet(cacheKey, empty);
      return jsonNoStore(empty);
    }

    const narrative = await generateNarrative(signals);

    const payload = {
      ok: true,
      executive_summary: narrative.executive_summary,
      sections:          narrative.sections,
      talking_points:    narrative.talking_points,
      gaps:              signals.gaps,
      signals_summary: {
        project_count:      signals.projectCount,
        rag:                signals.rag,
        avg_health:         signals.avgHealth,
        pending_approvals:  signals.pendingApprovals,
        overdue_approvals:  signals.overdueApprovals,
        open_raid:          signals.openRaid,
        high_raid:          signals.highRaid,
        milestones_due:     signals.milestonesDue,
        overdue_milestones: signals.overdueMilestones,
        total_budget:       signals.totalBudget > 0 ? signals.totalBudget : null,
        total_spend:        signals.totalSpend  > 0 ? signals.totalSpend  : null,
        variance_pct:       signals.variancePct,
      },
      generated_at: new Date().toISOString(),
    };

    cacheSet(cacheKey, payload);
    return jsonNoStore(payload);

  } catch (e: any) {
    const msg = safeStr(e?.message).toLowerCase();
    if (msg === "unauthorized" || msg.includes("jwt") || msg.includes("not authenticated")) {
      return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    console.error("[portfolio-narrative] fatal:", e);
    return jsonNoStore({ ok: false, error: e?.message ?? "Failed" }, { status: 500 });
  }
}

// GET for backwards compat
export async function GET() {
  return POST(new Request("http://local/api/ai/portfolio-narrative", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }));
}