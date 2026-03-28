import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { ArtifactDiff } from "@/lib/artifacts/diff/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(data: unknown, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function stable(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, Object.keys((value as any) ?? {}).sort());
  } catch {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return String(value ?? "");
    }
  }
}

function normalizeTextContent(row: any) {
  return safeStr(row?.content).trim();
}

function normalizeJsonContent(row: any) {
  return row?.content_json ?? null;
}

function buildVerySimpleDiff(aRow: any, bRow: any): ArtifactDiff {
  const aJson = normalizeJsonContent(aRow);
  const bJson = normalizeJsonContent(bRow);
  const aText = normalizeTextContent(aRow);
  const bText = normalizeTextContent(bRow);

  const jsonChanged = stable(aJson) !== stable(bJson);
  const textChanged = aText !== bText;
  const titleChanged = safeStr(aRow?.title) !== safeStr(bRow?.title);
  const statusChanged = safeStr(aRow?.approval_status) !== safeStr(bRow?.approval_status);

  return {
    changed: jsonChanged || textChanged || titleChanged || statusChanged,
    summary: {
      totalChanges:
        Number(titleChanged) +
        Number(statusChanged) +
        Number(jsonChanged) +
        Number(textChanged),
    },
    sections: [
      ...(titleChanged
        ? [
            {
              key: "title",
              label: "Title",
              changed: true,
              before: safeStr(aRow?.title),
              after: safeStr(bRow?.title),
            },
          ]
        : []),
      ...(statusChanged
        ? [
            {
              key: "approval_status",
              label: "Approval status",
              changed: true,
              before: safeStr(aRow?.approval_status),
              after: safeStr(bRow?.approval_status),
            },
          ]
        : []),
      ...(jsonChanged
        ? [
            {
              key: "content_json",
              label: "Structured content",
              changed: true,
              before: aJson,
              after: bJson,
            },
          ]
        : []),
      ...(!jsonChanged && textChanged
        ? [
            {
              key: "content",
              label: "Content",
              changed: true,
              before: aText,
              after: bText,
            },
          ]
        : []),
    ],
  } as ArtifactDiff;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const projectId = safeStr(body?.projectId).trim();
    const artifactId = safeStr(body?.artifactId).trim();
    const aId = safeStr(body?.aId).trim();
    const bId = safeStr(body?.bId).trim();
    const changeId = safeStr(body?.changeId).trim();

    if (!projectId || !artifactId || !aId || !bId) {
      return noStoreJson(
        {
          ok: false,
          error: "Missing required fields: projectId, artifactId, aId, bId",
        },
        400
      );
    }

    if (aId === bId) {
      return noStoreJson({
        ok: true,
        diff: {
          changed: false,
          summary: { totalChanges: 0 },
          sections: [],
        },
        auditHints: [],
        approvalHints: [],
      });
    }

    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      return noStoreJson({ ok: false, error: authErr.message || "Authentication failed" }, 401);
    }
    if (!auth?.user) {
      return noStoreJson({ ok: false, error: "Not authenticated" }, 401);
    }

    const { data: membership, error: memErr } = await supabase
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (memErr) {
      return noStoreJson({ ok: false, error: memErr.message || "Membership check failed" }, 500);
    }
    if (!membership) {
      return noStoreJson({ ok: false, error: "Access denied" }, 403);
    }

    const { data: rows, error: rowsErr } = await supabase
      .from("artifacts")
      .select(
        [
          "id",
          "project_id",
          "title",
          "type",
          "content",
          "content_json",
          "approval_status",
          "updated_at",
          "created_at",
          "version",
          "is_current",
          "is_baseline",
          "root_artifact_id",
        ].join(", ")
      )
      .eq("project_id", projectId)
      .in("id", [aId, bId]);

    if (rowsErr) {
      return noStoreJson({ ok: false, error: rowsErr.message || "Failed to load artifacts" }, 500);
    }

    const aRow = (rows ?? []).find((r: any) => safeStr(r?.id) === aId);
    const bRow = (rows ?? []).find((r: any) => safeStr(r?.id) === bId);

    if (!aRow || !bRow) {
      return noStoreJson(
        {
          ok: false,
          error: "One or both artifact versions could not be found",
        },
        404
      );
    }

    const diff = buildVerySimpleDiff(aRow, bRow);

    const auditHints = [
      ...(safeStr(aRow?.approval_status) !== safeStr(bRow?.approval_status)
        ? [
            {
              level: "info",
              title: "Approval status changed",
              detail: `From "${safeStr(aRow?.approval_status) || "draft"}" to "${safeStr(
                bRow?.approval_status
              ) || "draft"}".`,
            },
          ]
        : []),
      ...(changeId
        ? [
            {
              level: "info",
              title: "Change request context attached",
              detail: `Comparison was opened with change context ${changeId}.`,
            },
          ]
        : []),
    ];

    const approvalHints = [
      ...(diff?.changed
        ? [
            {
              level: "warning",
              title: "Review approval impact",
              detail: "This version comparison shows changes that may require governance review.",
            },
          ]
        : []),
    ];

    return noStoreJson({
      ok: true,
      diff,
      auditHints,
      approvalHints,
    });
  } catch (e: any) {
    return noStoreJson(
      {
        ok: false,
        error: safeStr(e?.message) || "Unexpected compare error",
      },
      500
    );
  }
}
