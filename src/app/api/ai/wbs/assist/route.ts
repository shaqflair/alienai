// src/app/api/ai/wbs/assist/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function normalizeRole(role: any) {
  return safeLower(role || "viewer");
}

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Not found");

  const role = normalizeRole((mem as any).role);
  return { user: auth.user, role };
}

function assistantForRow(input: {
  deliverable: string;
  description?: string;
  tags?: string[];
}) {
  const d = safeLower(input.deliverable);
  const tags = (input.tags ?? []).map((t) => safeLower(t));

  // Generic PMI-ish structure
  const checklistBase = [
    "Define scope & acceptance criteria",
    "Confirm dependencies & approvals",
    "Assign owner & due date",
    "Execute work",
    "Quality review / sign-off",
    "Handover / close",
  ];

  // Domain hints
  let acceptance = "Acceptance criteria:\n- Output produced and reviewed\n- Stakeholders sign-off recorded\n- Stored in AlienAI artifact repository\n";
  let risks = [
    "Unclear acceptance criteria causes rework",
    "Dependencies/approvals delay completion",
    "Resourcing constraints impact timeline",
  ];
  let deliverables = ["Draft output", "Reviewed output", "Approved/baselined output (if applicable)"];
  let raci = [
    { role: "Accountable", suggested: "Project Sponsor / Product Owner" },
    { role: "Responsible", suggested: "Project Manager / Workstream Lead" },
    { role: "Consulted", suggested: "Engineering Lead / SMEs" },
    { role: "Informed", suggested: "Stakeholders / PMO" },
  ];

  if (d.includes("charter") || d.includes("pid")) {
    acceptance =
      "Acceptance criteria:\n- Business need, objectives, scope clearly defined\n- Governance, roles, assumptions/constraints captured\n- Risks & dependencies identified\n- Sponsor and key stakeholders approve\n";
    deliverables = ["Charter draft", "Reviewed charter", "Approved charter (baseline)"];
    risks = [
      "Scope ambiguity leads to misaligned delivery",
      "Stakeholders not aligned on objectives/governance",
      "Key dependencies unknown at initiation",
    ];
  }

  if (d.includes("stakeholder")) {
    acceptance =
      "Acceptance criteria:\n- Stakeholders identified and categorised (influence/impact)\n- Comms channels and cadence defined\n- Ownership for engagement actions assigned\n- Register reviewed on agreed cadence\n";
    deliverables = ["Stakeholder list", "Mapping (power/interest)", "Engagement plan/cadence"];
    risks = [
      "Key stakeholders missed causing late objections",
      "Engagement cadence not maintained",
      "Owner unclear for stakeholder actions",
    ];
    raci = [
      { role: "Accountable", suggested: "Project Manager" },
      { role: "Responsible", suggested: "PMO / Workstream Leads" },
      { role: "Consulted", suggested: "Account Lead / Service Manager" },
      { role: "Informed", suggested: "All project stakeholders" },
    ];
  }

  if (d.includes("test") || tags.includes("quality") || d.includes("qa") || d.includes("uat")) {
    acceptance =
      "Acceptance criteria:\n- Test plan approved\n- Test evidence captured\n- Defects triaged and retested\n- UAT sign-off obtained (where applicable)\n";
    deliverables = ["Test plan", "Test cases/evidence", "Defect log summary", "Sign-off"];
    risks = [
      "Late test planning causes compressed testing window",
      "Environment instability impacts test execution",
      "UAT stakeholders unavailable for sign-off",
    ];
    raci = [
      { role: "Accountable", suggested: "Engineering Lead / QA Lead" },
      { role: "Responsible", suggested: "QA / Testers" },
      { role: "Consulted", suggested: "Product Owner / SMEs" },
      { role: "Informed", suggested: "PM / PMO" },
    ];
  }

  const checklist = checklistBase.slice();
  if (d.includes("deploy") || d.includes("release") || d.includes("cutover")) {
    checklist.unshift("Confirm CAB / change approval (if required)");
    acceptance =
      "Acceptance criteria:\n- Release/cutover plan approved\n- Rollback plan validated\n- Go-live executed and verified\n- Hypercare plan agreed\n";
    deliverables = ["Release plan", "CAB record", "Rollback plan", "Go-live checklist", "Hypercare plan"];
    risks = [
      "Change approval delays release window",
      "Rollback plan untested increases outage risk",
      "Hypercare resourcing not secured",
    ];
  }

  return {
    acceptance_criteria: acceptance.trim(),
    risks: risks.slice(0, 6),
    checklist: checklist.slice(0, 10),
    deliverables: deliverables.slice(0, 8),
    raci,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    const artifactId = safeStr(body?.artifactId).trim();
    const row = body?.row ?? {};

    if (!projectId || !artifactId) throw new Error("Missing projectId/artifactId");

    const supabase = await createClient();
    await requireAuthAndMembership(supabase, projectId);

    const deliverable = safeStr(row?.deliverable).trim();
    if (!deliverable) return NextResponse.json({ ok: true, assistant: null });

    const assistant = assistantForRow({
      deliverable,
      description: safeStr(row?.description),
      tags: Array.isArray(row?.tags) ? row.tags.map((t: any) => safeStr(t)).filter(Boolean) : [],
    });

    return NextResponse.json({ ok: true, assistant });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "assist failed" }, { status: 500 });
  }
}

