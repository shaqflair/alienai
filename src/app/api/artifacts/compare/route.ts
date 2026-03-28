// src/app/api/artifacts/compare/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { ArtifactDiff, ArtifactDiffItem, DiffOp } from "@/lib/artifacts/diff/types";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

function pushItem(
  items: ArtifactDiffItem[],
  path: string,
  op: DiffOp,
  before?: unknown,
  after?: unknown,
  note?: string
) {
  items.push({
    path,
    op,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(note ? { note } : {}),
  });
}

function diffValues(items: ArtifactDiffItem[], path: string, a: unknown, b: unknown) {
  if (deepEqual(a, b)) return;

  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;

  if (aMissing && !bMissing) {
    pushItem(items, path, "add", undefined, b);
    return;
  }

  if (!aMissing && bMissing) {
    pushItem(items, path, "remove", a, undefined);
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i += 1) {
      const nextPath = `${path}[${i}]`;
      if (i >= a.length) {
        pushItem(items, nextPath, "add", undefined, b[i]);
      } else if (i >= b.length) {
        pushItem(items, nextPath, "remove", a[i], undefined);
      } else {
        diffValues(items, nextPath, a[i], b[i]);
      }
    }
    return;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      diffValues(items, nextPath, a[key], b[key]);
    }
    return;
  }

  pushItem(items, path, "replace", a, b);
}

function buildArtifactDiff(aRow: any, bRow: any): ArtifactDiff {
  const items: ArtifactDiffItem[] = [];

  const aTitle = safeStr(aRow?.title).trim();
  const bTitle = safeStr(bRow?.title).trim();
  const aStatus = safeStr(aRow?.approval_status).trim();
  const bStatus = safeStr(bRow?.approval_status).trim();
  const aCurrent = !!aRow?.is_current;
  const bCurrent = !!bRow?.is_current;
  const aBaseline = !!aRow?.is_baseline;
  const bBaseline = !!bRow?.is_baseline;
  const artifactType = safeStr(bRow?.type || aRow?.type).trim() || undefined;

  if (aTitle !== bTitle) {
    pushItem(items, "title", "replace", aTitle, bTitle);
  }

  if (aStatus !== bStatus) {
    pushItem(items, "approval_status", "replace", aStatus, bStatus);
  }

  if (aCurrent !== bCurrent) {
    pushItem(items, "is_current", "replace", aCurrent, bCurrent);
  }

  if (aBaseline !== bBaseline) {
    pushItem(items, "is_baseline", "replace", aBaseline, bBaseline);
  }

  const aJson = aRow?.content_json ?? null;
  const bJson = bRow?.content_json ?? null;

  if (aJson !== null || bJson !== null) {
    diffValues(items, "content_json", aJson, bJson);
  } else {
    const aText = safeStr(aRow?.content);
    const bText = safeStr(bRow?.content);
    if (aText !== bText) {
      pushItem(items, "content", "replace", aText, bText);
    }
  }

  return {
    version: 1,
    ...(artifactType ? { artifact_type: artifactType } : {}),
    items,
  };
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
          "root_artifact_id",
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

    const diff = buildArtifactDiff(aRow, bRow);

    const auditHints = [];
    if (changeId) {
      auditHints.push({
        level: "info",
        title: "Change context attached",
        detail: `Comparison opened with change request context ${changeId}.`,
      });
    }
    if (safeStr(aRow?.approval_status) !== safeStr(bRow?.approval_status)) {
      auditHints.push({
        level: "info",
        title: "Approval status changed",
        detail: `Status changed from "${safeStr(aRow?.approval_status) || "draft"}" to "${
          safeStr(bRow?.approval_status) || "draft"
        }".`,
      });
    }

    const approvalHints =
      diff.items.length > 0
        ? [
            {
              level: "warning",
              title: "Review approval impact",
              detail: "Detected changes between selected versions. Confirm whether governance re-approval is required.",
            },
          ]
        : [];

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