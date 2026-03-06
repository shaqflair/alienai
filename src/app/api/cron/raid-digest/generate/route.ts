// src/app/api/cron/raid-digest/generate/route.ts
// Weekly org-wide RAID digest — covers raid_items + raid_log
// Delivers AI-generated summary as in-app notifications to all org members
// Schedule: Mondays 07:00 UTC (see vercel.json)
import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function jsonErr(error: string, status = 400) {
  const res = NextResponse.json({ ok: false, error }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function clamp(n: any): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null;
}
function score(prob: any, sev: any): number | null {
  const p = clamp(prob); const s = clamp(sev);
  return p != null && s != null ? Math.round((p * s) / 100) : null;
}
function requireCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return;
  const got = req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (got !== expected) throw new Error("Unauthorized");
}
function getApiKey() {
  return safeStr(process.env.WIRE_AI_API_KEY || process.env.OPENAI_API_KEY).trim();
}

/* ── Build digest data for one org ─────────────────────────────────── */
async function buildOrgDigest(supabase: any, orgId: string, orgName: string) {
  const today = new Date().toISOString().slice(0, 10);
  const in7   = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  // 1. raid_items — all open items across org projects
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("organisation_id", orgId)
    .not("resource_status", "in", "("Closed","Cancelled","Completed")");

  const projectIds = (projects ?? []).map((p: any) => safeStr(p.id)).filter(Boolean);

  let raidItems: any[] = [];
  if (projectIds.length) {
    const { data } = await supabase
      .from("raid_items")
      .select("id,type,title,description,probability,severity,status,priority,due_date,owner_label,ai_rollup,project_id")
      .in("project_id", projectIds)
      .not("status", "in", "("Closed","Invalid")")
      .order("updated_at", { ascending: false })
      .limit(200);
    raidItems = (data ?? []).map((r: any) => ({
      source: "raid_items",
      type:   safeStr(r.type   || "Risk"),
      title:  safeStr(r.title  || r.description || "Untitled"),
      status: safeStr(r.status || "Open"),
      priority: r.priority ? safeStr(r.priority) : null,
      score:  score(r.probability, r.severity),
      due_date: r.due_date ? safeStr(r.due_date).slice(0, 10) : null,
      owner:  safeStr(r.owner_label || ""),
      ai_rollup: safeStr(r.ai_rollup || ""),
      project_id: safeStr(r.project_id),
    }));
  }

  // 2. raid_log — org-scoped legacy risks
  const { data: logRows } = await supabase
    .from("raid_log")
    .select("id,type,name,likelihood,severity,status,priority,owner,last_updated,organisation_id")
    .eq("organisation_id", orgId)
    .not("status", "in", "("Closed","Invalid")")
    .order("last_updated", { ascending: false })
    .limit(200);

  const logItems = (logRows ?? []).map((r: any) => ({
    source:   "raid_log",
    type:     safeStr(r.type  || "Risk"),
    title:    safeStr(r.name  || "Untitled"),
    status:   safeStr(r.status || "Open"),
    priority: r.priority ? safeStr(r.priority) : null,
    score:    score(r.likelihood, r.severity),
    due_date: null,
    owner:    safeStr(r.owner || ""),
    ai_rollup: "",
    project_id: null,
  }));

  const allItems = [...raidItems, ...logItems];

  // 3. Compute summary stats
  const overdue = allItems.filter(i => i.due_date && i.due_date < today).length;
  const dueSoon = allItems.filter(i => i.due_date && i.due_date >= today && i.due_date <= in7).length;
  const critical = allItems.filter(i => (i.score ?? 0) >= 70).length;
  const noOwner  = allItems.filter(i => !i.owner).length;
  const byType   = allItems.reduce((a: any, i) => { a[i.type] = (a[i.type] || 0) + 1; return a; }, {});
  const top5     = [...allItems].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);

  return { allItems, overdue, dueSoon, critical, noOwner, byType, top5, projectCount: projectIds.length, orgName };
}

/* ── AI summary generation ──────────────────────────────────────────── */
async function generateAiSummary(digest: any): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) return buildFallbackSummary(digest);

  const { allItems, overdue, dueSoon, critical, noOwner, byType, top5, orgName } = digest;

  const prompt = [
    `You are a PMO risk advisor. Generate a concise weekly RAID digest for ${orgName}.`,
    `Total open items: ${allItems.length} across ${digest.projectCount} projects + legacy register.`,
    `By type: ${JSON.stringify(byType)}`,
    `Critical (score ≥70): ${critical} | Overdue: ${overdue} | Due in 7 days: ${dueSoon} | No owner: ${noOwner}`,
    ``,
    `Top 5 by score:`,
    top5.map((i: any, n: number) => `${n+1}. [${i.type}] ${i.title} — Score: ${i.score ?? "?"} | Status: ${i.status} | Owner: ${i.owner || "unassigned"}`).join("\n"),
    ``,
    `Write a 3-4 sentence executive digest covering: overall risk posture, top concerns, and one specific recommended action.`,
    `Be direct. No filler. Max 80 words.`,
  ].join("\n");

  try {
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model: safeStr(process.env.OPENAI_MODEL).trim() || "gpt-4.1-mini",
      temperature: 0.2,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    return safeStr(resp.choices?.[0]?.message?.content).trim() || buildFallbackSummary(digest);
  } catch {
    return buildFallbackSummary(digest);
  }
}

function buildFallbackSummary(digest: any): string {
  const { allItems, overdue, critical, noOwner, orgName } = digest;
  const parts = [
    `${allItems.length} open RAID items across ${digest.projectCount} active projects.`,
    critical > 0 ? `${critical} item${critical > 1 ? "s" : ""} scored ≥70 — immediate attention required.` : "No critical items this week.",
    overdue  > 0 ? `${overdue} item${overdue  > 1 ? "s" : ""} past due date.` : "",
    noOwner  > 0 ? `${noOwner} item${noOwner  > 1 ? "s" : ""} have no assigned owner — assign accountability.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

/* ── Main handler ───────────────────────────────────────────────────── */
async function handler(req: Request) {
  requireCronSecret(req);
  const supabase = await createAdminClient();
  const now = new Date().toISOString();
  const results: any[] = [];

  // Get all active orgs
  const { data: orgs, error: orgErr } = await supabase
    .from("organisations")
    .select("id, name")
    .limit(200);
  if (orgErr) throw orgErr;

  for (const org of orgs ?? []) {
    const orgId   = safeStr(org.id);
    const orgName = safeStr(org.name || "Your Organisation");

    try {
      // Build digest
      const digest = await buildOrgDigest(supabase, orgId, orgName);
      if (digest.allItems.length === 0) { results.push({ orgId, skipped: true }); continue; }

      // Generate AI summary
      const summary = await generateAiSummary(digest);

      // Get all active org members to notify
      const { data: members } = await supabase
        .from("organisation_members")
        .select("user_id")
        .eq("organisation_id", orgId)
        .is("removed_at", null)
        .limit(500);

      const notifications = (members ?? []).map((m: any) => ({
        user_id:       safeStr(m.user_id),
        project_id:    null,
        artifact_id:   null,
        type:          "raid_weekly_digest",
        title:         `Weekly RAID Digest — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
        body:          summary,
        link:          "/portfolio/raid",
        is_read:       false,
        actor_user_id: null,
        metadata: {
          total_items:   digest.allItems.length,
          critical:      digest.critical,
          overdue:       digest.overdue,
          due_soon:      digest.dueSoon,
          no_owner:      digest.noOwner,
          by_type:       digest.byType,
          project_count: digest.projectCount,
          generated_at:  now,
          digest_type:   "weekly_raid_org",
        },
      }));

      if (notifications.length) {
        const { error: notifErr } = await supabase.from("notifications").insert(notifications);
        if (notifErr) throw notifErr;
      }

      results.push({ orgId, orgName, items: digest.allItems.length, notified: notifications.length, critical: digest.critical, overdue: digest.overdue });
    } catch (e: any) {
      results.push({ orgId, error: safeStr(e?.message) });
    }
  }

  return jsonOk({ ran_at: now, orgs_processed: results.length, results });
}

export async function GET(req: Request) {
  try { return await handler(req); } catch (e: any) { return jsonErr(safeStr(e?.message), e?.message === "Unauthorized" ? 401 : 500); }
}
export async function POST(req: Request) {
  try { return await handler(req); } catch (e: any) { return jsonErr(safeStr(e?.message), e?.message === "Unauthorized" ? 401 : 500); }
}
