// src/app/api/ai/project-agent/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import OpenAI from "openai";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 30;

function ok(data: any)           { return NextResponse.json({ ok: true,  ...data }); }
function err(e: string, s = 400) { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any): string { return typeof x === "string" ? x : x == null ? "" : String(x); }

async function buildProjectContext(supabase: any, projectId: string): Promise<string> {
  const results = await Promise.allSettled([
    supabase.from("projects").select("title, status, start_date, finish_date, pm_name, pm_user_id").eq("id", projectId).maybeSingle(),
    supabase.from("artifacts").select("type, approval_status, status, updated_at").eq("project_id", projectId).eq("is_current", true).limit(20),
    supabase.from("raid_items").select("type, title, priority, status, owner_label, due_date").eq("project_id", projectId).in("status", ["Open","In Progress"]).order("priority").limit(15),
    supabase.from("milestones").select("title, due_date, status").eq("project_id", projectId).order("due_date").limit(8),
    supabase.from("ai_premortem_snapshots").select("failure_risk_score, failure_risk_band, schedule_score, governance_score, budget_score, stability_score, top_drivers, narrative").eq("project_id", projectId).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("change_requests").select("title, status").eq("project_id", projectId).in("status", ["pending","under_review","submitted"]).limit(5),
    supabase.from("approval_requests").select("step_label, status, created_at").eq("project_id", projectId).eq("status", "pending").limit(5),
    supabase.from("artifacts").select("content_json").eq("project_id", projectId).eq("type", "FINANCIAL_PLAN").eq("is_current", true).maybeSingle(),
  ]);

  const get = (i: number) => results[i].status === "fulfilled" ? (results[i] as any).value?.data : null;

  let proj        = get(0) ? { ...get(0) } : null;
  const fp        = get(7);

  // Enrich dates from Financial Plan if not on project record
  if (proj && fp?.content_json?.fy_config) {
    const fy = fp.content_json.fy_config;
    if (!proj.start_date && fy.fy_start_year) {
      proj.start_date = `${fy.fy_start_year}-${String(fy.fy_start_month ?? 1).padStart(2,"0")}-01`;
    }
    if (!proj.finish_date && fy.fy_start_year && fy.num_months) {
      const end = new Date(fy.fy_start_year, (fy.fy_start_month ?? 1) - 1 + Number(fy.num_months), 1);
      proj.finish_date = end.toISOString().slice(0,10);
    }
  }
  console.log("[project-agent] proj dates:", proj?.start_date, proj?.finish_date);
  const _proj     = proj;
  const artifacts = get(1) ?? [];
  const raid      = get(2) ?? [];
  const mstones   = get(3) ?? [];
  const snap      = get(4);
  const changes   = get(5) ?? [];
  const approvals = get(6) ?? [];

  const artList = artifacts.map((a: any) => {
    const approved = ["approved","baselined"].includes(safeStr(a.approval_status ?? a.status).toLowerCase());
    return `  - ${a.type}: ${approved ? "APPROVED" : safeStr(a.approval_status ?? a.status)}`;
  }).join("\n");

  const raidList = raid.slice(0, 8).map((r: any) =>
    `  - [${r.priority}] ${r.type}: ${r.title} (owner: ${r.owner_label ?? "unassigned"}, due: ${r.due_date ?? "no date"})`
  ).join("\n");

  const milestoneList = mstones.slice(0, 6).map((m: any) =>
    `  - ${m.title}: ${m.status} - due ${m.due_date ?? "TBC"}`
  ).join("\n");

  const changeList   = changes.slice(0, 5).map((c: any) => `  - ${c.title} (${c.status})`).join("\n");
  const approvalList = approvals.slice(0, 5).map((a: any) => `  - ${a.step_label} (pending since ${safeStr(a.created_at).slice(0,10)})`).join("\n");

  const premortem = snap
    ? `Pre-Mortem AI Score: ${snap.failure_risk_score}/100 (${snap.failure_risk_band})
  Schedule: ${snap.schedule_score}, Governance: ${snap.governance_score}, Budget: ${snap.budget_score}, Stability: ${snap.stability_score}
  Top drivers: ${Array.isArray(snap.top_drivers) ? snap.top_drivers.slice(0,3).map((d: any) => d.label ?? d).join(", ") : "none"}
  Narrative: ${(snap.narrative as any)?.executive ?? "none"}`
    : "No Pre-Mortem scan yet.";

  return `PROJECT: ${safeStr(_proj?.title)}
Status: ${safeStr(_proj?.status)} | PM: ${safeStr(_proj?.pm_name)}
Timeline: ${_proj?.start_date ? new Date(_proj.start_date).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "TBC"} to ${_proj?.finish_date ? new Date(_proj.finish_date).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "TBC"}
Description: ${safeStr(_proj?.description)}

ARTIFACTS:
${artList || "  None"}

OPEN RAID ITEMS:
${raidList || "  None"}

MILESTONES:
${milestoneList || "  None"}

PENDING CHANGES:
${changeList || "  None"}

PENDING APPROVALS:
${approvalList || "  None"}

${premortem}`;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const body       = await req.json().catch(() => ({}));
    const projectId  = safeStr(body?.projectId).trim();
    const messages   = Array.isArray(body?.messages) ? body.messages : [];

    if (!projectId)       return err("projectId required", 400);
    if (!messages.length) return err("messages required", 400);

    const context = await buildProjectContext(supabase, projectId);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are a senior PMO advisor with full real-time access to this project data. Answer concisely and specifically - reference actual names, dates, scores, and statuses from the data below. Never say "I don't have access to that". Be direct and actionable. Keep responses under 200 words unless asked for detail.

IMPORTANT CONTEXT RULES:
- Draft artifacts (Schedule, WBS, Stakeholder Register, Weekly Report etc) are NORMAL WORKING DOCUMENTS. Do NOT flag them as risks or problems. They only need to be kept current and up to date.
- If start_date and finish_date are present in the project data, the timeline IS defined. Never say the timeline is undefined or TBC if dates are shown.
- Only flag artifacts as a concern if they are overdue for review or have not been updated in 30+ days.
- A Pre-Mortem score of 0-25 means LOW RISK, not a problem. Do not frame low scores negatively.

CURRENT PROJECT DATA:
${context}`;

    const response = await client.chat.completions.create({
      model:      "gpt-4o",
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m: any) => ({
          role:    (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
          content: safeStr(m.content),
        })),
      ],
    });

    const content = response.choices[0]?.message?.content ?? "";
    return ok({ content });

  } catch (e: any) {
    console.error("[project-agent]", e);
    return err(safeStr(e?.message) || "Failed", 500);
  }
}