// Portfolio-scoped AI advisor for the homepage "Ask Aliena" feature.
// Pulls live signals across the org portfolio and feeds them to OpenAI
// to answer executive-level questions about delivery health, risk, and priorities.

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ── utils ──────────────────────────────────────────────────────────────── */

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
function clamp(s: string, max: number) {
  return s.length > max ? s.slice(0, max) : s;
}
function uniqueStrings(arr: Array<string | null | undefined>) {
  return Array.from(new Set(arr.map((x) => safeStr(x).trim()).filter(Boolean)));
}

/* ── auth ───────────────────────────────────────────────────────────────── */

async function requireAuth(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

/* ── portfolio context builder ──────────────────────────────────────────── */

async function buildPortfolioContext(supabase: any, userId: string): Promise<string> {
  // 1. Resolve scoped project IDs
  const scope = await resolvePortfolioScope(supabase, userId);
  const rawIds = uniqueStrings([
    ...(Array.isArray(scope?.projectIds) ? scope.projectIds : []),
    ...(Array.isArray(scope?.project_ids) ? scope.project_ids : []),
    ...(Array.isArray(scope?.projects) ? scope.projects.map((x: any) => x?.id) : []),
  ]);

  if (!rawIds.length) return "No projects found in this portfolio.";

  let activeIds = rawIds;
  try {
    const filtered = await filterActiveProjectIds(supabase, rawIds);
    if (Array.isArray(filtered) && filtered.length) activeIds = uniqueStrings(filtered);
  } catch {}

  if (!activeIds.length) return "No active projects found.";

  // 2. Load projects + PM names
  const [projectsRes, membersRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, project_code, status, pm_name, pm_user_id, project_manager_id, budget_amount, start_date, finish_date")
      .in("id", activeIds)
      .is("deleted_at", null)
      .limit(200),
    supabase
      .from("project_members")
      .select("project_id, user_id, role, removed_at")
      .in("project_id", activeIds)
      .is("removed_at", null)
      .in("role", ["project_manager", "owner"])
      .limit(500),
  ]);

  const projects: any[] = Array.isArray(projectsRes.data) ? projectsRes.data : [];
  const members: any[] = Array.isArray(membersRes.data) ? membersRes.data : [];

  // Build PM user ID → name map
  const pmUserIds = uniqueStrings(members.map((m: any) => m?.user_id));
  let profileMap = new Map<string, string>();
  if (pmUserIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", pmUserIds)
      .limit(500);
    for (const p of Array.isArray(profiles) ? profiles : []) {
      const uid = safeStr(p?.user_id).trim();
      if (uid) profileMap.set(uid, safeStr(p?.full_name).trim() || safeStr(p?.email).trim() || "Unknown");
    }
  }

  const pmByProject = new Map<string, string>();
  for (const m of members) {
    const pid = safeStr(m?.project_id).trim();
    if (!pid || pmByProject.has(pid)) continue;
    const name = profileMap.get(safeStr(m?.user_id).trim()) ?? "Unknown PM";
    pmByProject.set(pid, name);
  }

  // 3. Load health scores
  const { data: healthRows } = await supabase
    .from("project_health")
    .select("project_id, score, rag, computed_at")
    .in("project_id", activeIds)
    .order("computed_at", { ascending: false })
    .limit(500);

  const latestHealth = new Map<string, { score: number; rag: string }>();
  for (const h of Array.isArray(healthRows) ? healthRows : []) {
    const pid = safeStr(h?.project_id).trim();
    if (!pid || latestHealth.has(pid)) continue;
    latestHealth.set(pid, { score: safeNum(h?.score), rag: safeStr(h?.rag).toUpperCase() });
  }

  // 4. Load pending approvals
  const { data: approvalsData } = await supabase
    .from("v_pending_artifact_approvals_all")
    .select("project_id, step_status, pending_user_id, sla_status")
    .in("project_id", activeIds)
    .eq("step_status", "pending")
    .limit(2000);

  const approvalsByProject = new Map<string, { total: number; overdue: number }>();
  for (const a of Array.isArray(approvalsData) ? approvalsData : []) {
    const pid = safeStr(a?.project_id).trim();
    if (!pid) continue;
    const cur = approvalsByProject.get(pid) ?? { total: 0, overdue: 0 };
    cur.total++;
    const sla = safeLower(a?.sla_status);
    if (sla === "overdue" || sla === "breached") cur.overdue++;
    approvalsByProject.set(pid, cur);
  }

  // 5. Load open RAID items
  const { data: raidData } = await supabase
    .from("raid_items")
    .select("project_id, type, priority, status, due_date")
    .in("project_id", activeIds)
    .not("status", "in", '("closed","resolved","done","completed","archived")')
    .limit(5000);

  const raidByProject = new Map<string, { total: number; high: number; overdue: number }>();
  const now = Date.now();
  for (const r of Array.isArray(raidData) ? raidData : []) {
    const pid = safeStr(r?.project_id).trim();
    if (!pid) continue;
    const cur = raidByProject.get(pid) ?? { total: 0, high: 0, overdue: 0 };
    cur.total++;
    const pri = safeLower(r?.priority);
    if (pri === "high" || pri === "critical") cur.high++;
    if (r?.due_date) {
      const d = new Date(r.due_date).getTime();
      if (Number.isFinite(d) && d < now) cur.overdue++;
    }
    raidByProject.set(pid, cur);
  }

  // 6. Load milestones due in 30 days
  const in30 = new Date(now + 30 * 86400000).toISOString();
  const { data: milestoneData } = await supabase
    .from("schedule_milestones")
    .select("project_id, status, end_date, critical_path_flag")
    .in("project_id", activeIds)
    .lte("end_date", in30)
    .limit(2000);

  const milestonesByProject = new Map<string, { due: number; overdue: number; critical: number }>();
  for (const m of Array.isArray(milestoneData) ? milestoneData : []) {
    const pid = safeStr(m?.project_id).trim();
    if (!pid) continue;
    const st = safeLower(m?.status);
    if (st === "done" || st === "completed" || st === "closed") continue;
    const cur = milestonesByProject.get(pid) ?? { due: 0, overdue: 0, critical: 0 };
    cur.due++;
    const d = new Date(safeStr(m?.end_date)).getTime();
    if (Number.isFinite(d) && d < now) cur.overdue++;
    if (m?.critical_path_flag) cur.critical++;
    milestonesByProject.set(pid, cur);
  }

  // 7. Load spend data
  const { data: spendData } = await supabase
    .from("project_spend")
    .select("project_id, amount")
    .in("project_id", activeIds)
    .is("deleted_at", null)
    .limit(100000);

  const spendByProject = new Map<string, number>();
  for (const s of Array.isArray(spendData) ? spendData : []) {
    const pid = safeStr(s?.project_id).trim();
    if (!pid) continue;
    spendByProject.set(pid, (spendByProject.get(pid) ?? 0) + safeNum(s?.amount));
  }

  // 8. Load open change requests
  const { data: changeData } = await supabase
    .from("change_requests")
    .select("project_id, status, delivery_status, decision_status")
    .in("project_id", activeIds)
    .limit(2000);

  const changesByProject = new Map<string, { open: number; review: number }>();
  for (const c of Array.isArray(changeData) ? changeData : []) {
    const pid = safeStr(c?.project_id).trim();
    if (!pid) continue;
    const st = safeLower(c?.delivery_status ?? c?.status ?? "");
    if (st === "closed" || st === "implemented") continue;
    const cur = changesByProject.get(pid) ?? { open: 0, review: 0 };
    cur.open++;
    if (st === "review" || safeLower(c?.decision_status) === "submitted") cur.review++;
    changesByProject.set(pid, cur);
  }

  // 9. Assemble context string
  const lines: string[] = [
    `PORTFOLIO OVERVIEW`,
    `Active projects: ${projects.length}`,
    ``,
  ];

  let greenCount = 0, amberCount = 0, redCount = 0, unscoredCount = 0;
  let totalBudget = 0, totalSpend = 0;
  let totalPendingApprovals = 0, totalOverdueApprovals = 0;
  let totalOpenRaid = 0, totalHighRaid = 0;
  let totalMilestonesDue = 0, totalOverdueMilestones = 0;

  const projectLines: string[] = [];

  for (const p of projects) {
    const pid = safeStr(p?.id).trim();
    const name = safeStr(p?.title).trim() || pid;
    const code = safeStr(p?.project_code).trim();
    const pm = pmByProject.get(pid) || safeStr(p?.pm_name).trim() || "Unassigned";
    const health = latestHealth.get(pid);
    const approvals = approvalsByProject.get(pid) ?? { total: 0, overdue: 0 };
    const raid = raidByProject.get(pid) ?? { total: 0, high: 0, overdue: 0 };
    const milestones = milestonesByProject.get(pid) ?? { due: 0, overdue: 0, critical: 0 };
    const changes = changesByProject.get(pid) ?? { open: 0, review: 0 };
    const budget = safeNum(p?.budget_amount);
    const spend = spendByProject.get(pid) ?? 0;

    if (budget > 0) { totalBudget += budget; totalSpend += spend; }
    totalPendingApprovals += approvals.total;
    totalOverdueApprovals += approvals.overdue;
    totalOpenRaid += raid.total;
    totalHighRaid += raid.high;
    totalMilestonesDue += milestones.due;
    totalOverdueMilestones += milestones.overdue;

    const rag = health?.rag ?? "UNSCORED";
    if (rag === "G") greenCount++;
    else if (rag === "A") amberCount++;
    else if (rag === "R") redCount++;
    else unscoredCount++;

    const budgetLine = budget > 0
      ? `Budget: £${Math.round(budget).toLocaleString()} | Spend: £${Math.round(spend).toLocaleString()} (${Math.round((spend / budget) * 100)}% utilised)`
      : "No budget set";

    const flags: string[] = [];
    if (approvals.overdue > 0) flags.push(`${approvals.overdue} overdue approval(s)`);
    if (raid.high > 0) flags.push(`${raid.high} high-severity RAID`);
    if (milestones.overdue > 0) flags.push(`${milestones.overdue} overdue milestone(s)`);
    if (changes.review > 0) flags.push(`${changes.review} change(s) awaiting decision`);
    if (pm === "Unassigned") flags.push("NO PM ASSIGNED");

    projectLines.push([
      `Project: ${name}${code ? ` (${code})` : ""} | RAG: ${rag}${health?.score != null ? ` (${health.score}%)` : ""}`,
      `  PM: ${pm}`,
      `  ${budgetLine}`,
      `  Approvals: ${approvals.total} pending, ${approvals.overdue} overdue`,
      `  RAID: ${raid.total} open items, ${raid.high} high severity, ${raid.overdue} overdue`,
      `  Milestones due 30d: ${milestones.due} (${milestones.overdue} overdue, ${milestones.critical} critical path)`,
      `  Changes: ${changes.open} open, ${changes.review} in review`,
      flags.length ? `  ⚠ FLAGS: ${flags.join(" | ")}` : "  No critical flags",
    ].join("\n"));
  }

  // Portfolio summary
  lines.push(`RAG SUMMARY: ${greenCount} Green | ${amberCount} Amber | ${redCount} Red | ${unscoredCount} Unscored`);

  if (totalBudget > 0) {
    const variance = totalBudget > 0 ? Math.round(((totalSpend - totalBudget) / totalBudget) * 100) : 0;
    lines.push(`FINANCIALS: Total budget £${Math.round(totalBudget).toLocaleString()} | Total spend £${Math.round(totalSpend).toLocaleString()} | Variance: ${variance > 0 ? "+" : ""}${variance}%`);
  }

  lines.push(`APPROVALS: ${totalPendingApprovals} pending across portfolio, ${totalOverdueApprovals} overdue`);
  lines.push(`RAID: ${totalOpenRaid} open items, ${totalHighRaid} high severity`);
  lines.push(`MILESTONES: ${totalMilestonesDue} due in next 30 days, ${totalOverdueMilestones} already overdue`);
  lines.push(``);
  lines.push(`PROJECT DETAILS:`);
  lines.push(``);
  lines.push(projectLines.join("\n\n"));

  return lines.join("\n");
}

/* ── OpenAI call ─────────────────────────────────────────────────────────── */

async function askPortfolioAdvisor(question: string, context: string): Promise<{
  answer: string;
  priority_actions: Array<{ priority: number; action: string; project?: string; why: string }>;
  risk_summary: string;
  recommended_routes: Array<{ label: string; href: string }>;
  confidence: number;
}> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = `You are Aliena, an executive-grade AI portfolio delivery advisor for enterprise project portfolios.

You have access to live portfolio signals — health scores, RAG statuses, RAID items, approvals, milestones, financials, and PM assignments.

Your role is to give DIRECT, ACTIONABLE, boardroom-ready answers. Be concise and specific.

RULES:
- Answer in plain English. No markdown headers. No generic advice.
- Always reference specific project names, PM names, or numbers from the data.
- If you spot red flags (overdue approvals, high-severity RAID, Red RAG projects), call them out clearly.
- Priority actions must be specific and immediately actionable.
- Never say "I don't have enough information" — work with what's provided.
- Be honest about uncertainty but lean towards actionable insight.

Return ONLY valid JSON — no markdown, no extra keys:
{
  "answer": "Direct 3-5 sentence answer to the question using specific data",
  "priority_actions": [
    { "priority": 1, "action": "Specific action to take", "project": "Project name if applicable", "why": "One sentence reason" }
  ],
  "risk_summary": "One sentence summary of the biggest risk in the portfolio right now",
  "recommended_routes": [
    { "label": "Button label", "href": "/path" }
  ],
  "confidence": 0.85
}`;

  const userPrompt = `LIVE PORTFOLIO DATA:
${context}

QUESTION: ${question}

Answer using the specific data above. Reference project names, numbers, and PM names where relevant.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1200,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: clamp(userPrompt, 8000) },
    ],
  });

  let result: any = {};
  try {
    result = JSON.parse(completion.choices[0].message.content ?? "{}");
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  return {
    answer: safeStr(result.answer),
    priority_actions: Array.isArray(result.priority_actions) ? result.priority_actions : [],
    risk_summary: safeStr(result.risk_summary),
    recommended_routes: Array.isArray(result.recommended_routes) ? result.recommended_routes : [],
    confidence: safeNum(result.confidence, 0.8),
  };
}

/* ── POST handler ────────────────────────────────────────────────────────── */

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({}));
    const question = clamp(safeStr(body?.question).trim(), 1200);

    if (!question || question.length < 3) {
      return jsonNoStore({ ok: false, error: "Question is required." }, { status: 400 });
    }

    // Build context from live portfolio data
    const context = await buildPortfolioContext(supabase, user.id);

    // Ask OpenAI
    const result = await askPortfolioAdvisor(question, context);

    return jsonNoStore({
      ok: true,
      question,
      answer: result.answer,
      priority_actions: result.priority_actions,
      risk_summary: result.risk_summary,
      recommended_routes: result.recommended_routes,
      confidence: result.confidence,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message).toLowerCase();
    if (msg === "unauthorized" || msg.includes("jwt") || msg.includes("not authenticated")) {
      return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return jsonNoStore({ ok: false, error: e?.message ?? "Failed" }, { status: 500 });
  }
}