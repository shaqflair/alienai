// src/app/api/ai/wbs/validate/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

type Issue = { severity: "high" | "medium" | "low"; message: string; rowId?: string };

function isParent(rows: any[], i: number) {
  const cur = rows[i];
  const next = rows[i + 1];
  return !!(cur && next && Number(next.level) > Number(cur.level));
}

function hasValue(s: any) {
  return safeStr(s).trim().length > 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const due = safeStr(body?.due_date);
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    const issues: Issue[] = [];

    // Basic sanity
    if (rows.length === 0) issues.push({ severity: "high", message: "WBS has no rows. Add at least Level 1 deliverables." });

    // Artifact due date recommended
    if (!hasValue(due)) issues.push({ severity: "medium", message: "Artifact due date is empty. Set a target date for the WBS." });

    // Check leaves: deliverable, owner, due date
    const leafs = rows
      .map((r: any, idx: number) => ({ r, idx }))
      .filter(({ idx }) => !isParent(rows, idx))
      .map(({ r }) => r);

    for (const r of leafs) {
      const id = safeStr(r?.id);
      const del = safeStr(r?.deliverable);
      const owner = safeStr(r?.owner);
      const dueDate = safeStr(r?.due_date);
      const status = safeLower(r?.status);

      if (!del.trim()) issues.push({ severity: "high", message: "Leaf work package missing deliverable name.", rowId: id });

      if (!owner.trim()) issues.push({ severity: "high", message: `Work package "${del || "Unnamed"}" has no owner.`, rowId: id });

      if (!dueDate.trim()) issues.push({ severity: "medium", message: `Work package "${del || "Unnamed"}" has no due date.`, rowId: id });

      if (status === "blocked" && !safeStr(r?.description).trim()) {
        issues.push({
          severity: "medium",
          message: `Blocked item "${del || "Unnamed"}" should include reason/notes in Description.`,
          rowId: id,
        });
      }

      if (!safeStr(r?.acceptance_criteria).trim()) {
        issues.push({
          severity: "low",
          message: `Add acceptance criteria for "${del || "Unnamed"}" (helps audit + sign-off).`,
          rowId: id,
        });
      }
    }

    // PMI completeness hints (presence-based)
    const allDeliverablesText = rows.map((r: any) => safeLower(r?.deliverable)).join(" | ");

    const want = [
      { key: "testing", label: "Testing / QA", examples: ["test", "qa", "uat", "assurance"] },
      { key: "deployment", label: "Deployment / release", examples: ["deploy", "release", "cutover", "go-live"] },
      { key: "change", label: "Change control", examples: ["change", "cr", "cab"] },
      { key: "handover", label: "Handover / hypercare", examples: ["handover", "hypercare", "warranty", "transition"] },
      { key: "lessons", label: "Lessons learned / retro", examples: ["lessons", "retro", "retrospective"] },
    ];

    for (const w of want) {
      const found = w.examples.some((x) => allDeliverablesText.includes(x));
      if (!found) {
        issues.push({
          severity: "low",
          message: `Consider adding "${w.label}" activities (PMI completeness).`,
        });
      }
    }

    // Too shallow / too deep check
    const maxLevel = rows.reduce((m: number, r: any) => Math.max(m, Number(r?.level ?? 0)), 0);
    if (maxLevel < 2) issues.push({ severity: "medium", message: "WBS is very shallow (max level < 2). Decompose into work packages." });
    if (maxLevel > 6) issues.push({ severity: "low", message: "WBS is very deep (level > 6). Consider simplifying for readability." });

    // Return
    return NextResponse.json({ issues });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "AI validate failed" }, { status: 500 });
  }
}


