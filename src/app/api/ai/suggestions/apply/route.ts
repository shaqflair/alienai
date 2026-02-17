// src/app/api/ai/suggestions/apply/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createSbJsClient(url, key, { auth: { persistSession: false } });
}

function canEditRole(role: string) {
  const r = safeLower(role);
  return r === "owner" || r === "admin" || r === "editor";
}

async function requireProjectMembership(supabase: any, projectId: string, userId: string) {
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) return null;

  const role = safeLower((mem as any).role ?? "viewer");
  return { role, canEdit: canEditRole(role) };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const projectId = safeStr(body?.projectId).trim();
    const artifactId = safeStr(body?.artifactId).trim();
    const suggestionId = safeStr(body?.suggestionId).trim() || safeStr(body?.suggestion?.id).trim();

    if (!projectId || !artifactId || !suggestionId) {
      return NextResponse.json({ ok: false, error: "Missing projectId, artifactId, or suggestionId" }, { status: 400 });
    }

    // 1) Auth with session client (user context)
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return NextResponse.json({ ok: false, error: authErr.message }, { status: 401 });
    if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    // 1b) Membership gate (DON'T rely on admin client for access control)
    const mem = await requireProjectMembership(supabase, projectId, auth.user.id);
    if (!mem) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // If you want to restrict "apply suggestion" to editors/owners only:
    if (!mem.canEdit) {
      return NextResponse.json({ ok: false, error: "Requires editor/owner" }, { status: 403 });
    }

    // 2) Admin client for DB writes (bypass RLS)
    const supabaseAdmin = adminClient();

    // 3) Load suggestion from DB (DO NOT trust client patch)
    const { data: sug, error: sugErr } = await supabaseAdmin
      .from("ai_suggestions")
      .select(
        "id, project_id, artifact_id, section_key, target_artifact_type, suggestion_type, rationale, confidence, patch, status"
      )
      .eq("id", suggestionId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (sugErr) return NextResponse.json({ ok: false, error: sugErr.message }, { status: 500 });
    if (!sug) return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });

    // Ensure suggestion belongs to artifact (defensive)
    if (safeStr((sug as any).artifact_id).trim() && safeStr((sug as any).artifact_id).trim() !== artifactId) {
      return NextResponse.json({ ok: false, error: "Suggestion does not belong to this artifact" }, { status: 400 });
    }

    const sugStatus = safeLower((sug as any).status);
    if (sugStatus !== "proposed" && sugStatus !== "suggested") {
      return NextResponse.json(
        { ok: false, error: `Suggestion is not actionable (status=${safeStr((sug as any).status)})` },
        { status: 400 }
      );
    }

    const suggestionType = safeLower((sug as any).suggestion_type);
    const patch = (sug as any).patch ?? null;

    // 3b) Optional fast-path: add_stakeholder suggestions that target canonical stakeholders table
    // We support payload in either:
    // - patch.payload
    // - patch.data
    // - patch (direct object)
    if (suggestionType === "add_stakeholder") {
      const payload = (patch && typeof patch === "object" ? (patch.payload ?? patch.data ?? patch) : {}) as any;

      const name = safeStr(payload?.name).trim();
      if (!name) {
        return NextResponse.json({ ok: false, error: "Missing payload.name for add_stakeholder" }, { status: 400 });
      }

      const role = safeStr(payload?.role).trim() || null;
      const point_of_contact = safeStr(payload?.point_of_contact ?? payload?.poc).trim() || null;

      const { data: created, error: cErr } = await supabaseAdmin
        .from("stakeholders")
        .insert({
          project_id: projectId,
          artifact_id: artifactId,
          name,
          role,
          point_of_contact,
          source: safeStr(payload?.source).trim() || "ai",
        })
        .select("id")
        .maybeSingle();

      if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });

      const nowIso = new Date().toISOString();
      const { error: uErr } = await supabaseAdmin
        .from("ai_suggestions")
        .update({
          status: "applied",
          actioned_by: auth.user.id,
          decided_at: nowIso,
          rejected_at: null,
          updated_at: nowIso,
        })
        .eq("id", suggestionId)
        .eq("project_id", projectId);

      if (uErr) {
        return NextResponse.json(
          { ok: true, applied: true, stakeholderId: created?.id ?? null, warning: `Failed to mark applied: ${uErr.message}` },
          { status: 200 }
        );
      }

      return NextResponse.json({ ok: true, applied: true, stakeholderId: created?.id ?? null });
    }

    // 4) Load target artifact (admin)
    const { data: artifact, error: artErr } = await supabaseAdmin
      .from("artifacts")
      .select("id, project_id, type, content_json")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (artErr) return NextResponse.json({ ok: false, error: artErr.message }, { status: 500 });
    if (!artifact) return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 });

    const artifactType = safeLower((artifact as any).type);
    const currentJson = (artifact as any).content_json ?? {};

    const suggestionTargetType = safeLower((sug as any).target_artifact_type);

    // ✅ Normalize stakeholder governance patches to the 5-column stakeholder register table shape
    const normalizedPatch = normalizeStakeholderPatchIfNeeded({
      artifactType,
      suggestionTargetType,
      patch,
    });

    // Apply patch to artifact JSON
    const updatedJson = applySuggestionToArtifactJson(currentJson, {
      kind: normalizedPatch?.kind ?? normalizedPatch?.type ?? null,
      mode: normalizedPatch?.mode ?? "append",
      rows: Array.isArray(normalizedPatch?.rows) ? normalizedPatch.rows : [],
      bullets: typeof normalizedPatch?.bullets === "string" ? normalizedPatch.bullets : "",
      sectionKey: (sug as any).section_key ?? null,
    });

    // 5) Save artifact JSON (admin)
    const { error: updErr } = await supabaseAdmin
      .from("artifacts")
      .update({
        content_json: updatedJson,
        updated_at: new Date().toISOString(),
      })
      .eq("id", artifactId)
      .eq("project_id", projectId);

    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

    // 6) If stakeholder_register + add_rows => persist to canonical stakeholders table
    const persisted = await maybePersistStakeholdersFromAddRows({
      supabaseAdmin,
      projectId,
      artifactId,
      artifactType,
      suggestionTargetType,
      patch: normalizedPatch,
    });

    // 7) Mark suggestion applied
    const nowIso = new Date().toISOString();
    const { error: markErr } = await supabaseAdmin
      .from("ai_suggestions")
      .update({
        status: "applied",
        actioned_by: auth.user.id,
        decided_at: nowIso,
        rejected_at: null,
        updated_at: nowIso,
      })
      .eq("id", suggestionId)
      .eq("project_id", projectId);

    if (markErr) {
      return NextResponse.json(
        {
          ok: true,
          artifactJson: updatedJson,
          persisted,
          warning: `Applied changes but failed to mark suggestion applied: ${markErr.message}`,
        },
        { status: 200 }
      );
    }

    // 8) Log project_event (best effort)
    await supabaseAdmin.from("project_events").insert({
      project_id: projectId,
      artifact_id: artifactId,
      section_key: null,
      event_type: "suggestion_applied",
      actor_user_id: auth.user.id,
      severity: "info",
      source: "app",
      payload: {
        suggestion_id: suggestionId,
        target_artifact_type: (sug as any).target_artifact_type,
        suggestion_type: (sug as any).suggestion_type,
      },
    });

    return NextResponse.json({
      ok: true,
      artifactJson: updatedJson,
      persisted,
      applied: { suggestionId, status: "applied" },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

/* =========================================================
   Normalize stakeholder governance patch rows (4-col → 5-col)
   ========================================================= */

function normalizeStakeholderPatchIfNeeded(opts: {
  artifactType: string;
  suggestionTargetType: string;
  patch: any;
}) {
  const { artifactType, suggestionTargetType, patch } = opts;

  const isStakeholderRegisterArtifact =
    artifactType.includes("stakeholder_register") ||
    artifactType.includes("stakeholder register") ||
    artifactType === "stakeholders" ||
    artifactType === "stakeholder";

  const isStakeholderTarget =
    suggestionTargetType === "stakeholder_register" || suggestionTargetType.includes("stakeholder");

  if (!isStakeholderRegisterArtifact || !isStakeholderTarget) return patch;

  const kind = safeLower(patch?.kind ?? patch?.type);
  if (kind !== "add_rows") return patch;

  const rows: any[] = Array.isArray(patch?.rows) ? patch.rows : [];
  if (!rows.length) return patch;

  // If already 5 cols, keep it
  const looks5Col = rows.every((r) => Array.isArray(r) && r.length >= 5);
  if (looks5Col) return patch;

  // Convert 4-col governance rows: [name, role, impact, notes]
  // → 5-col stakeholder register rows: [Stakeholder, Point of Contact, Role, Internal/External, Title/Role]
  const mapped = rows
    .map((r) => {
      const name = safeStr(r?.[0]).trim() || "TBC";
      const role = safeStr(r?.[1]).trim() || "Stakeholder";
      const impact = safeStr(r?.[2]).trim();
      const notes = safeStr(r?.[3]).trim();

      return [
        name, // Stakeholder
        "", // Point of Contact (unknown)
        role, // Role
        "Internal", // Internal/External default
        [impact, notes].filter(Boolean).join(" — ").trim(), // Title/Role
      ];
    })
    .filter(Boolean);

  return { ...(patch ?? {}), kind: "add_rows", rows: mapped };
}

/* =========================================================
   Stakeholder persistence (canonical table)
   ========================================================= */

async function maybePersistStakeholdersFromAddRows(opts: {
  supabaseAdmin: any;
  projectId: string;
  artifactId: string;
  artifactType: string;
  suggestionTargetType: string;
  patch: any;
}): Promise<{ attempted: boolean; inserted: number; error?: string }> {
  const { supabaseAdmin, projectId, artifactId, artifactType, suggestionTargetType, patch } = opts;

  const isStakeholderRegisterArtifact =
    artifactType.includes("stakeholder_register") ||
    artifactType.includes("stakeholder register") ||
    artifactType === "stakeholders" ||
    artifactType === "stakeholder";

  const isStakeholderTarget =
    suggestionTargetType === "stakeholder_register" || suggestionTargetType.includes("stakeholder");

  if (!isStakeholderRegisterArtifact || !isStakeholderTarget) {
    return { attempted: false, inserted: 0 };
  }

  const kind = safeLower(patch?.kind ?? patch?.type);
  if (kind !== "add_rows") return { attempted: false, inserted: 0 };

  const rows: any[] = Array.isArray(patch?.rows) ? patch.rows : [];
  if (!rows.length) return { attempted: false, inserted: 0 };

  // After normalization, rows are 5-col:
  // [Stakeholder, Point of Contact, Role, Internal/External, Title/Role]
  const inserts = rows
    .map((r: any) => {
      const name = safeStr(r?.[0]).trim() || "TBC";
      const point_of_contact = safeStr(r?.[1]).trim() || null;
      const role = safeStr(r?.[2]).trim() || null;

      return {
        project_id: projectId,
        artifact_id: artifactId,
        name,
        role,
        point_of_contact,
      };
    })
    .filter(Boolean);

  if (!inserts.length) return { attempted: false, inserted: 0 };

  // Avoid duplicates for same artifact: name+role
  const names = Array.from(new Set(inserts.map((x: any) => String(x.name))));
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("stakeholders")
    .select("id, name, role")
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .in("name", names);

  if (exErr) return { attempted: true, inserted: 0, error: exErr.message };

  const seen = new Set<string>((existing ?? []).map((x: any) => `${safeLower(x.name)}|${safeLower(x.role)}`));
  const finalInserts = inserts.filter((x: any) => !seen.has(`${safeLower(x.name)}|${safeLower(x.role)}`));

  if (!finalInserts.length) return { attempted: true, inserted: 0 };

  const { error: insErr } = await supabaseAdmin.from("stakeholders").insert(finalInserts);
  if (insErr) return { attempted: true, inserted: 0, error: insErr.message };

  return { attempted: true, inserted: finalInserts.length };
}

/* =========================================================
   Apply suggestion to artifact JSON (generic)
   ========================================================= */

function applySuggestionToArtifactJson(artifactJson: any, suggestion: any) {
  const out = deepClone(artifactJson ?? {});
  const mode: "append" | "replace" = suggestion?.mode === "replace" ? "replace" : "append";
  const kind = safeLower(suggestion?.kind ?? suggestion?.type);

  const rows = Array.isArray(suggestion?.rows) ? suggestion.rows : [];
  const bullets = typeof suggestion?.bullets === "string" ? suggestion.bullets : "";

  // 1) V2 sections schema
  if (Array.isArray(out.sections)) {
    return applyToSections(out, suggestion, rows, bullets, mode, kind);
  }

  // 2) Root table schema
  if (out?.table?.rows) {
    if (rows.length) out.table = applyRowsToTable(out.table, rows, mode);
    if (bullets.trim()) out.bullets = applyBulletsValue(out.bullets, bullets, mode, kind);
    return out;
  }

  // 3) Simple {columns, rows}
  if (Array.isArray(out.rows) || Array.isArray(out.columns)) {
    const table = {
      columns: Array.isArray(out.columns)
        ? out.columns.length
        : Math.max(1, Array.isArray(out.rows?.[0]) ? out.rows[0].length : 1),
      rows: normalizeRows(out.rows),
    };
    const nextTable = rows.length ? applyRowsToTable(table, rows, mode) : table;

    out.columns = Array.isArray(out.columns) ? out.columns : new Array(nextTable.columns).fill("");
    out.rows = nextTable.rows;

    if (bullets.trim()) out.bullets = applyBulletsValue(out.bullets, bullets, mode, kind);
    return out;
  }

  // 4) Unknown -> create minimal sections+table
  if (rows.length) {
    out.sections = [
      {
        key: "main_table",
        title: "Main Table",
        table: applyRowsToTable({ columns: Math.max(1, rows[0]?.length ?? 1), rows: [] }, rows, mode),
      },
    ];
  }

  return out;
}

function applyToSections(
  out: any,
  suggestion: any,
  rows: string[][],
  bullets: string,
  mode: "append" | "replace",
  kind: string
) {
  const sections = Array.isArray(out.sections) ? out.sections : [];
  const sectionKey = suggestion?.sectionKey ?? suggestion?.target?.sectionKey ?? suggestion?.section?.key ?? null;

  let idx = -1;
  if (sectionKey) idx = sections.findIndex((s: any) => String(s?.key) === String(sectionKey));
  else idx = sections.findIndex((s: any) => !!s?.table);

  if (idx < 0) return out;

  if (rows.length) {
    const sec = deepClone(sections[idx] ?? {});
    sec.table = applyRowsToTable(sec.table ?? { columns: 1, rows: [] }, rows, mode);
    out.sections[idx] = sec;
  }

  if (bullets.trim()) {
    const sec = deepClone(out.sections[idx] ?? {});
    sec.bullets = applyBulletsValue(sec.bullets, bullets, mode, kind);
    out.sections[idx] = sec;
  }

  return out;
}

function applyRowsToTable(table: any, rows: string[][], mode: "append" | "replace") {
  const t = deepClone(table ?? { columns: 1, rows: [] });

  const existing = Array.isArray(t.rows) ? t.rows : [];
  const normalizedExisting = normalizeRows(existing);

  const header = normalizedExisting.find((r: any) => r?.type === "header") ?? null;
  const headerCols = header?.cells?.length ? Number(header.cells.length) : 0;

  const inferredCols = Math.max(
    Number(t.columns ?? 1),
    headerCols,
    ...normalizedExisting.map((r: any) => (Array.isArray(r?.cells) ? r.cells.length : 0)),
    ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
    1
  );

  const newRowObjs = rows.map((cells) => ({
    type: "data",
    cells: padCells(cells, inferredCols),
  }));

  const existingData = normalizedExisting.filter((r: any) => r?.type !== "header");

  let nextRows: any[] = [];
  if (mode === "replace") nextRows = header ? [header, ...newRowObjs] : [...newRowObjs];
  else nextRows = header ? [header, ...existingData, ...newRowObjs] : [...existingData, ...newRowObjs];

  return { columns: inferredCols, rows: nextRows };
}

function normalizeRows(rows: any[]) {
  if (!Array.isArray(rows)) return [];
  if (rows.length && typeof rows[0] === "object" && rows[0] && "cells" in rows[0]) return rows;
  if (rows.length && Array.isArray(rows[0])) {
    return rows.map((cells: any[]) => ({ type: "data", cells: cells.map((x) => String(x ?? "")) }));
  }
  return rows;
}

function applyBulletsValue(curValue: any, bullets: string, mode: "append" | "replace", kind: string) {
  const cur = String(curValue ?? "").trim();
  const forceReplace = kind.includes("replace");
  if (mode === "replace" || forceReplace || !cur) return bullets.trim();
  const joiner = cur.endsWith("\n") ? "" : "\n";
  return (cur + joiner + bullets.trim()).trim();
}

function padCells(cells: any, n: number) {
  const arr = Array.isArray(cells) ? cells.map((x) => String(x ?? "")) : [];
  while (arr.length < n) arr.push("");
  return arr.slice(0, n);
}

function deepClone<T>(x: T): T {
  try {
    return JSON.parse(JSON.stringify(x));
  } catch {
    return x;
  }
}
