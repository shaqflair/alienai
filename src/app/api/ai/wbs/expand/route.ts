// src/app/api/ai/wbs/expand/route.ts
import "server-only";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

type Child = {
  deliverable: string;
  description?: string;
  acceptance_criteria?: string;
  owner?: string;
  status?: "not_started" | "in_progress" | "done" | "blocked";
  effort?: "S" | "M" | "L";
  due_date?: string;
  predecessor?: string;
  tags?: string[];
};

function templatesFor(deliverable: string): Child[] {
  const d = safeLower(deliverable);

  // PMI-ish closure
  if (d.includes("closure") || d.includes("close") || d.includes("handover")) {
    return [
      { deliverable: "Operational handover", effort: "M", tags: ["closing"] },
      { deliverable: "Documentation pack finalised", effort: "S", tags: ["closing"] },
      { deliverable: "Hypercare / warranty support", effort: "M", tags: ["closing"] },
      { deliverable: "Lessons learned & retrospective", effort: "S", tags: ["closing"] },
    ];
  }

  // Governance & management
  if (d.includes("governance") || d.includes("management") || d.includes("pmo")) {
    return [
      { deliverable: "Kick-off & mobilisation", effort: "S", tags: ["initiating"] },
      { deliverable: "RAID log setup & cadence", effort: "S", tags: ["monitoring"] },
      { deliverable: "Comms & reporting rhythm", effort: "S", tags: ["monitoring"] },
      { deliverable: "Change control & approvals", effort: "M", tags: ["monitoring"] },
      { deliverable: "Financial tracking (forecast vs actual)", effort: "M", tags: ["monitoring"] },
    ];
  }

  // Charter / PID
  if (d.includes("charter") || d.includes("pid")) {
    return [
      { deliverable: "Business need & objectives", effort: "S", tags: ["initiating"] },
      { deliverable: "Scope & deliverables", effort: "S", tags: ["planning"] },
      { deliverable: "Assumptions, constraints & dependencies", effort: "S", tags: ["planning"] },
      { deliverable: "High-level risks & mitigations", effort: "S", tags: ["planning"] },
      { deliverable: "Governance, roles & approvals", effort: "S", tags: ["initiating"] },
    ];
  }

  // Stakeholders
  if (d.includes("stakeholder")) {
    return [
      { deliverable: "Identify stakeholders", effort: "S", tags: ["planning"] },
      { deliverable: "Assess influence/impact & mapping", effort: "S", tags: ["planning"] },
      { deliverable: "Define comms channels & cadence", effort: "M", tags: ["planning"] },
      { deliverable: "Stakeholder engagement plan", effort: "M", tags: ["executing"] },
      { deliverable: "Review & update register (cadence)", effort: "S", tags: ["monitoring"] },
    ];
  }

  // Testing
  if (d.includes("test") || d.includes("qa") || d.includes("assurance")) {
    return [
      { deliverable: "Test strategy & plan", effort: "S", tags: ["quality"] },
      { deliverable: "Unit testing", effort: "M", tags: ["quality"] },
      { deliverable: "Integration testing", effort: "M", tags: ["quality"] },
      { deliverable: "UAT support & sign-off", effort: "M", tags: ["quality"] },
      { deliverable: "Performance & security checks", effort: "M", tags: ["quality"] },
    ];
  }

  // Deployment / release
  if (d.includes("deploy") || d.includes("release") || d.includes("cutover")) {
    return [
      { deliverable: "Release plan", effort: "S", tags: ["release"] },
      { deliverable: "CAB / change approval", effort: "S", tags: ["release"] },
      { deliverable: "Rollback plan", effort: "S", tags: ["release"] },
      { deliverable: "Go-live execution", effort: "M", tags: ["release"] },
      { deliverable: "Hypercare", effort: "M", tags: ["release"] },
    ];
  }

  // Default – useful generic decomposition
  return [
    { deliverable: "Define requirements & acceptance criteria", effort: "S", tags: ["planning"] },
    { deliverable: "Design / approach", effort: "M", tags: ["planning"] },
    { deliverable: "Build / implement", effort: "L", tags: ["executing"] },
    { deliverable: "Review / QA", effort: "M", tags: ["quality"] },
    { deliverable: "Handover / close", effort: "S", tags: ["closing"] },
  ];
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const row = body?.row ?? {};
    const deliverable = safeStr(row?.deliverable);

    if (!deliverable.trim()) {
      return NextResponse.json({ children: [] });
    }

    const children = templatesFor(deliverable);

    return NextResponse.json({ children });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "AI expand failed" }, { status: 500 });
  }
}
