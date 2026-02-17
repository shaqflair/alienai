import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem || mem.is_active === false || mem.removed_at != null) throw new Error("Forbidden");
  return auth.user;
}

// simple rules-based assistant (safe fallback)
// later you can swap to LLM.
function buildDraftAssist(input: any) {
  const title = safeStr(input?.title).trim();
  const summary = safeStr(input?.summary).trim();
  const schedule = safeStr(input?.schedule).trim();
  const financial = safeStr(input?.financial).trim();
  const risks = safeStr(input?.risks).trim();

  const headline =
    title && summary
      ? `${title} — ${summary.slice(0, 160)}${summary.length > 160 ? "…" : ""}`
      : title || summary || "Draft your change request to get AI suggestions.";

  const next_action =
    !title
      ? "Start with a clear title (verb + object + context)."
      : !summary
      ? "Add a 2–3 line summary: what, why, and who is impacted."
      : "Add schedule/cost/risk details to strengthen the submission pack.";

  const alts = [
    { title: "Reduce scope", summary: "Pilot the change on a smaller subset first.", tradeoff: "Lower risk, slower benefit." },
    { title: "Defer to change window", summary: "Align implementation to a planned window.", tradeoff: "Lower operational risk, potential delay." },
    { title: "Approve with conditions", summary: "Proceed but require rollback + validation evidence.", tradeoff: "Faster delivery, more governance." },
  ];

  return {
    summary: {
      headline,
      schedule: schedule || "Schedule impact not captured yet.",
      cost: financial || "Cost impact not captured yet.",
      risk: risks || "Risks not captured yet.",
      scope: "Use the sections to explain what is changing and what is excluded.",
      next_action,
    },
    alternatives: alts,
    rationale: "Draft assist generated from current form inputs.",
    model: "draft-rules-v1",
  };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json().catch(() => ({} as any));

    const projectId = safeStr(body?.projectId).trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });

    await requireAuthAndMembership(supabase, projectId);

    const out = buildDraftAssist(body?.draft ?? body);

    return NextResponse.json({ ok: true, item: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
