// src/app/api/ai/suggestions/apply/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- utils ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function canEditRole(role: string) {
  const r = safeLower(role);
  return r === "owner" || r === "admin" || r === "editor";
}

async function requireAuth(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
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
  supabase: any;
  projectId: string;
  artifactId: string;
  artifactType: string;
  suggestionTargetType: string;
  patch: any;
}): Promise<{ attempted: boolean; inserted: number; error?: string }> {
  const { supabase, projectId, artifactId, artifactType, suggestionTargetType, patch } = opts;

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

  const { data: existing, error: exErr } = await supabase
    .from("stakeholders")
    .select("id, name, role")
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .in("name", names);

  if (exErr) return { attempted: true, inserted: 0, error: exErr.message };

  const seen = new Set<string>((existing ?? []).map((x: any) => `${safeLower(x.name)}|${safeLower(x.role)}`));
  const finalInserts = inserts.filter((x: any) => !seen.has(`${safeLower(x.name)}|${safeLower(x.role)}`));

  if (!finalInserts.length) return { attempted: true, inserted: 0 };

  const { error: insErr } = await supabase.from("stakeholders").insert(finalInserts);
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

/* =========================================================
   POST
   ========================================================= */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Accept multiple caller shapes:
    // - { id }
    // - { suggestionId }
    // - { suggestion: { id } }
    // - { ids: [...] }   (batch)
    const single =
      safeStr(body?.id).trim() ||
      safeStr(body?.suggestionId).trim() ||
      safeStr(body?.suggestion?.id).trim();

    const ids = uniq([
      ...((Array.isArray(body?.ids) ? body.ids : []) as any[]).map((x) => safeStr(x).trim()),
      ...(single ? [single] : []),
    ]);

    if (!ids.length) {
      return NextResponse.json({ ok: false, error: "Missing suggestion id" }, { status: 400 });
    }

    // Auth (user context)
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const applied: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const suggestionId of ids) {
      // Load suggestion first (derive project/artifact)
      const { data: sug, error: sugErr } = await supabase
        .from("ai_suggestions")
        .select(
          "id, project_id, artifact_id, section_key, target_artifact_type, suggestion_type, patch, status"
        )
        .eq("id", suggestionId)
        .maybeSingle();

      if (sugErr) {
        skipped.push({ id: suggestionId, reason: sugErr.message });
        continue;
      }
      if (!sug) {
        skipped.push({ id: suggestionId, reason: "Suggestion not found" });
        continue;
      }

      const projectId = safeStr((sug as any).project_id).trim();
      const artifactId = safeStr((sug as any).artifact_id).trim();

      if (!projectId || !artifactId) {
        skipped.push({ id: suggestionId, reason: "Suggestion missing project_id or artifact_id" });
        continue;
      }

      // Membership gate (explicit for clear errors; RLS also enforces)
      const mem = await requireProjectMembership(supabase, projectId, user.id);
      if (!mem) {
        skipped.push({ id: suggestionId, reason: "Forbidden" });
        continue;
      }
      if (!mem.canEdit) {
        skipped.push({ id: suggestionId, reason: "Requires editor/owner" });
        continue;
      }

      const sugStatus = safeLower((sug as any).status);
      if (sugStatus !== "proposed" && sugStatus !== "suggested") {
        skipped.push({
          id: suggestionId,
          reason: `Not actionable (status=${safeStr((sug as any).status)})`,
        });
        continue;
      }

      const suggestionType = safeLower((sug as any).suggestion_type);
      const patch = (sug as any).patch ?? null;

      // Fast-path: add_stakeholder writes to canonical stakeholders table
      if (suggestionType === "add_stakeholder") {
        const payload = (patch && typeof patch === "object" ? (patch.payload ?? patch.data ?? patch) : {}) as any;
        const name = safeStr(payload?.name).trim();
        if (!name) {
          skipped.push({ id: suggestionId, reason: "Missing payload.name for add_stakeholder" });
          continue;
        }

        const role = safeStr(payload?.role).trim() || null;
        const point_of_contact = safeStr(payload?.point_of_contact ?? payload?.poc).trim() || null;

        const { error: cErr } = await supabase.from("stakeholders").insert({
          project_id: projectId,
          artifact_id: artifactId,
          name,
          role,
          point_of_contact,
          source: safeStr(payload?.source).trim() || "ai",
        });

        if (cErr) {
          skipped.push({ id: suggestionId, reason: cErr.message });
          continue;
        }

        const nowIso = new Date().toISOString();
        const { error: uErr } = await supabase
          .from("ai_suggestions")
          .update({
            status: "applied",
            actioned_by: user.id,
            decided_at: nowIso,
            rejected_at: null,
            updated_at: nowIso,
          })
          .eq("id", suggestionId)
          .eq("project_id", projectId);

        if (uErr) {
          skipped.push({ id: suggestionId, reason: `Inserted stakeholder but failed to mark applied: ${uErr.message}` });
          continue;
        }

        applied.push(suggestionId);
        continue;
      }

      // Load target artifact
      const { data: artifact, error: artErr } = await supabase
        .from("artifacts")
        .select("id, project_id, type, content_json")
        .eq("id", artifactId)
        .eq("project_id", projectId)
        .maybeSingle();

      if (artErr) {
        skipped.push({ id: suggestionId, reason: artErr.message });
        continue;
      }
      if (!artifact) {
        skipped.push({ id: suggestionId, reason: "Artifact not found" });
        continue;
      }

      const artifactType = safeLower((artifact as any).type);
      const currentJson = (artifact as any).content_json ?? {};
      const suggestionTargetType = safeLower((sug as any).target_artifact_type);

      const normalizedPatch = normalizeStakeholderPatchIfNeeded({
        artifactType,
        suggestionTargetType,
        patch,
      });

      const updatedJson = applySuggestionToArtifactJson(currentJson, {
        kind: normalizedPatch?.kind ?? normalizedPatch?.type ?? null,
        mode: normalizedPatch?.mode ?? "append",
        rows: Array.isArray(normalizedPatch?.rows) ? normalizedPatch.rows : [],
        bullets: typeof normalizedPatch?.bullets === "string" ? normalizedPatch.bullets : "",
        sectionKey: (sug as any).section_key ?? null,
      });

      // Save artifact
      const { error: updErr } = await supabase
        .from("artifacts")
        .update({
          content_json: updatedJson,
          updated_at: new Date().toISOString(),
        })
        .eq("id", artifactId)
        .eq("project_id", projectId);

      if (updErr) {
        skipped.push({ id: suggestionId, reason: updErr.message });
        continue;
      }

      // If stakeholder_register + add_rows => persist to canonical stakeholders table
      const persisted = await maybePersistStakeholdersFromAddRows({
        supabase,
        projectId,
        artifactId,
        artifactType,
        suggestionTargetType,
        patch: normalizedPatch,
      });

      // Mark suggestion applied
      const nowIso = new Date().toISOString();
      const { error: markErr } = await supabase
        .from("ai_suggestions")
        .update({
          status: "applied",
          actioned_by: user.id,
          decided_at: nowIso,
          rejected_at: null,
          updated_at: nowIso,
        })
        .eq("id", suggestionId)
        .eq("project_id", projectId);

      if (markErr) {
        skipped.push({
          id: suggestionId,
          reason: `Applied to artifact but failed to mark applied: ${markErr.message}`,
        });
        continue;
      }

      // Best-effort event log
      try {
        await supabase.from("project_events").insert({
          project_id: projectId,
          artifact_id: artifactId,
          section_key: null,
          event_type: "suggestion_applied",
          actor_user_id: user.id,
          severity: "info",
          source: "app",
          payload: {
            suggestion_id: suggestionId,
            target_artifact_type: (sug as any).target_artifact_type,
            suggestion_type: (sug as any).suggestion_type,
            persisted,
          },
        });
      } catch {
        // ignore
      }

      applied.push(suggestionId);
    }

    return NextResponse.json({
      ok: true,
      applied,
      skipped,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}