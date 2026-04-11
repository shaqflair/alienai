import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient }      from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import OpenAI from "openai";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 30;

function ok(data: any)           { return NextResponse.json({ ok: true,  ...data }); }
function err(e: string, s = 400) { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any): string { return typeof x === "string" ? x : x == null ? "" : String(x); }
function safeNum(x: any): number { const n = Number(x); return Number.isFinite(n) ? n : 0; }

async function buildProjectContext(admin: any, projectId: string): Promise<string> {
  const [
    { data: proj },
    { data: artifacts },
    { data: raid },
    { data: milestones },
    { data: snapshot },
    { data: changes },
    { data: approvals },
  ] = await Promise.all([
    admin.from("projects").select("title, status, start_date, finish_date, pm_name, description").eq("id", projectId).maybeSingle(),
    admin.from("artifacts").select("type, approval_status, status, updated_at").eq("project_id", projectId).eq("is_current", true).limit(20),
    admin.from("raid_items").select("type, title, priority, status, owner_label, due_date, description").eq("project_id", projectId).in("status", ["Open","In Progress"]).order("priority").limit(20),
    admin.from("milestones").select("title, due_date, status, owner").eq("project_id", projectId).order("due_date").limit(10).catch(() => ({ data: null })),
    admin.from("ai_premortem_snapshots").select("failure_risk_score, failure_risk_band, schedule_score, governance_score, budget_score, stability_score, top_drivers, narrative").eq("project_id", projectId).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("change_requests").select("title, status, est_cost_impact").eq("project_id", projectId).in("status", ["pending","under_review","submitted"]).limit(10).catch(() => ({ data: null })),
    admin.from("approval_requests").select("step_label, status, created_at").eq("project_id", projectId).eq("status", "pending").limit(10).catch(() => ({ data: null })),
  ]);

  const artList = (artifacts ?? []).map((a: any) => {
    const approved = ["approved","baselined"].includes(safeStr(a.approval_status ?? a.status).toLowerCase());
    return `  - ${a.type}: ${approved ? "APPROVED" : safeStr(a.approval_status ?? a.status)}`;
  }).join("\n");

  const raidList = (raid ?? []).slice(0, 8).map((r: any) =>
    `  - [${r.priority}] ${r.type}: ${r.title} (owner: ${r.owner_label ?? "unassigned"}, due: ${r.due_date ?? "no date"})`
  ).join("\n");

  const milestoneList = (milestones ?? []).slice(0, 6).map((m: any) =>
    `  - ${m.title}: ${m.status} — due ${m.due_date ?? "TBC"}`
  ).join("\n");

  const changeList = (changes ?? []).slice(0, 5).map((c: any) =>
    `  - ${c.title} (${c.status})`
  ).join("\n");

  const approvalList = (approvals ?? []).slice(0, 5).map((a: any) =>
    `  - ${a.step_label} (pending since ${safeStr(a.created_at).slice(0,10)})`
  ).join("\n");

  const snap = snapshot;
  const premortem = snap
    ? `Pre-Mortem AI Score: ${snap.failure_risk_score}/100 (${snap.failure_risk_band})
  Schedule: ${snap.schedule_score}, Governance: ${snap.governance_score}, Budget: ${snap.budget_score}, Stability: ${snap.stability_score}
  Top drivers: ${Array.isArray(snap.top_drivers) ? snap.top_drivers.slice(0,3).map((d: any) => d.label ?? d).join(", ") : "none"}
  Narrative: ${(snap.narrative as any)?.executive ?? "none"}`
    : "No Pre-Mortem scan yet.";

  return `PROJECT: ${safeStr(proj?.title)}
Status: ${safeStr(proj?.status)} | PM: ${safeStr(proj?.pm_name)}
Timeline: ${proj?.start_date ?? "TBC"} → ${proj?.finish_date ?? "TBC"}

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

    const body      = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    const messages  = Array.isArray(body?.messages) ? body.messages : [];

    if (!projectId) return err("projectId required", 400);
    if (!messages.length) return err("messages required", 400);

    const admin   = createAdminClient();
    const context = await buildProjectContext(admin, projectId);

    const client = new Anthropic();

    const response = await client.messages.create({
      model:      "gpt-4o",
      max_tokens: 600,
      system: `You are a senior PMO advisor and project delivery expert with full access to this project's data. Answer the user's questions about this project concisely and specifically. Reference actual data — names, dates, scores, and statuses. Never say "I don't have access" — you have full context below.

Be direct and actionable. If something is a risk, say so plainly. If a decision is needed, name it. Keep responses under 200 words unless the user asks for detail.

CURRENT PROJECT DATA:
${context}`,
      messages: messages.map((m: any) => ({
        role:    m.role === "user" ? "user" : "assistant",
        content: safeStr(m.content),
      })),
    });

    const content = response.content[0]?.type === "text" ? response.content[0].text : "";
    return ok({ content });

  } catch (e: any) {
    console.error("[project-agent]", e);
    return err(safeStr(e?.message) || "Failed", 500);
  }
}
