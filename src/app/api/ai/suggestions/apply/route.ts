// src/app/api/ai/suggestions/apply/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}
function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("unknown column") && m.includes(c)) ||
    (m.includes("could not find") && m.includes(c))
  );
}
function jsonNoStore(payload: any, init?: ResponseInit) {
  const res = NextResponse.json(payload, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function canEditRole(role: string) {
  const r = safeLower(role);
  return r === "owner" || r === "admin" || r === "editor";
}

/* ---------------- CRON-only service role (kept for future; not used here) ---------------- */

function isCronRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const h = req.headers;
  const direct = safeStr(h.get("x-cron-secret")).trim();
  if (direct && direct === secret) return true;

  const auth = safeStr(h.get("authorization")).trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token === secret) return true;
  }

  return false;
}

function adminClientForCron(req: Request) {
  if (!isCronRequest(req)) throw new Error("Forbidden");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createSbJsClient(url, key, { auth: { persistSession: false } });
}

/* ---------------- project resolver (UUID or human code) ---------------- */

const HUMAN_COL_CANDIDATES = [
  "project_code",
  "project_human_id",
  "human_id",
  "code",
  "slug",
  "reference",
  "ref",
] as const;

function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();

  // allow paths like /projects/P-00012 or "P-00012" or "00012"
  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];
  return v;
}

function isNumericLike(s: string) {
  return /^\d+$/.test(String(s || "").trim());
}

async function resolveProjectUuid(supabase: any, identifier: string): Promise<string | null> {
  const raw = safeStr(identifier).trim();
  if (!raw) return null;
  if (looksLikeUuid(raw)) return raw;

  const id = normalizeProjectIdentifier(raw);

  for (const col of HUMAN_COL_CANDIDATES) {
    const likelyNumeric = col === "project_code" || col === "human_id" || col === "project_human_id";
    if (likelyNumeric && !isNumericLike(id)) continue;

    const { data, error } = await supabase.from("projects").select("id").eq(col as any, id).maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      throw new Error(error.message);
    }
    if (data?.id) return String(data.id);
  }

  // Try raw value for text-y columns
  for (const col of ["slug", "reference", "ref", "code"] as const) {
    const { data, error } = await supabase.from("projects").select("id").eq(col as any, raw).maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      throw new Error(error.message);
    }
    if (data?.id) return String(data.id);
  }

  return null;
}

/* ---------------- membership gate (user context) ---------------- */

async function requireProjectMembership(supabase: any, projectUuid: string, userId: string) {
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectUuid)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) return null;

  const role = safeLower((mem as any).role ?? "viewer");
  return { role, canEdit: canEditRole(role) };
}

/* =========================================================
   POST
   ========================================================= */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const rawProject =
      safeStr(body?.projectId).trim() ||
      safeStr(body?.project_id).trim() ||
      safeStr(body?.project_human_id).trim();

    // artifactId is OPTIONAL now (we can derive it from ai_suggestions.artifact_id)
    const requestedArtifactId =
      safeStr(body?.artifactId).trim() || safeStr(body?.artifact_id).trim();

    const suggestionId =
      safeStr(body?.suggestionId).trim() || safeStr(body?.suggestion?.id).trim();

    if (!rawProject || !suggestionId) {
      return jsonNoStore(
        { ok: false, error: "Missing projectId/project_human_id or suggestionId" },
        { status: 400 }
      );
    }
    if (!looksLikeUuid(suggestionId)) {
      return jsonNoStore({ ok: false, error: "suggestionId must be a UUID" }, { status: 400 });
    }
    if (requestedArtifactId && !looksLikeUuid(requestedArtifactId)) {
      return jsonNoStore({ ok: false, error: "artifactId must be a UUID when provided" }, { status: 400 });
    }

    // 1) Auth with session client (user context)
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonNoStore({ ok: false, error: authErr.message }, { status: 401 });
    if (!auth?.user) return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });

    // 2) Resolve project UUID (supports human ID)
    const projectUuid = await resolveProjectUuid(supabase, rawProject);
    if (!projectUuid) {
      return jsonNoStore({ ok: false, error: "Project not found", meta: { rawProject } }, { status: 404 });
    }

    // 3) Membership gate (DON'T rely on service role for access control)
    const mem = await requireProjectMembership(supabase, projectUuid, auth.user.id);
    if (!mem) return jsonNoStore({ ok: false, error: "Forbidden" }, { status: 403 });
    if (!mem.canEdit) return jsonNoStore({ ok: false, error: "Requires editor/owner" }, { status: 403 });

    // 4) Load suggestion using RLS client (do NOT trust client patch)
    const { data: sug, error: sugErr } = await supabase
      .from("ai_suggestions")
      .select(
        "id, project_id, artifact_id, section_key, target_artifact_type, suggestion_type, rationale, confidence, patch, status"
      )
      .eq("id", suggestionId)
      .eq("project_id", projectUuid)
      .maybeSingle();

    if (sugErr) return jsonNoStore({ ok: false, error: sugErr.message }, { status: 500 });
    if (!sug) return jsonNoStore({ ok: false, error: "Suggestion not found" }, { status: 404 });

    // ✅ derive artifactId from suggestion if caller didn't send it
    const sugArtifactId = safeStr((sug as any).artifact_id).trim();
    const artifactId = requestedArtifactId || sugArtifactId;

    if (!artifactId) {
      return jsonNoStore(
        {
          ok: false,
          error: "Missing artifactId (not provided and suggestion has no artifact_id)",
          meta: { suggestionId },
        },
        { status: 400 }
      );
    }
    if (!looksLikeUuid(artifactId)) {
      return jsonNoStore({ ok: false, error: "Resolved artifactId is not a UUID" }, { status: 400 });
    }

    // Defensive: if suggestion specifies an artifact_id, and caller also sent one, must match
    if (sugArtifactId && requestedArtifactId && sugArtifactId !== requestedArtifactId) {
      return jsonNoStore({ ok: false, error: "Suggestion does not belong to this artifact" }, { status: 400 });
    }

    const sugStatus = safeLower((sug as any).status);

    // ✅ Idempotent: terminal statuses return OK (no error)
    if (sugStatus === "applied" || sugStatus === "rejected") {
      return jsonNoStore({
        ok: true,
        applied: false,
        suggestion: { id: (sug as any).id, status: (sug as any).status },
        note: `No change (already ${safeStr((sug as any).status)})`,
      });
    }

    // Actionable: proposed OR suggested
    if (sugStatus !== "proposed" && sugStatus !== "suggested") {
      return jsonNoStore(
        { ok: false, error: `Suggestion is not actionable (status=${safeStr((sug as any).status)})` },
        { status: 400 }
      );
    }

    const suggestionType = safeLower((sug as any).suggestion_type);
    const patch = (sug as any).patch ?? null;

    // 5) Load target artifact (RLS) - ensure belongs to same project
    const { data: artifact, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, type, artifact_type, content_json")
      .eq("id", artifactId)
      .eq("project_id", projectUuid)
      .maybeSingle();

    if (artErr) return jsonNoStore({ ok: false, error: artErr.message }, { status: 500 });
    if (!artifact) return jsonNoStore({ ok: false, error: "Artifact not found" }, { status: 404 });

    const artifactType = safeLower((artifact as any).artifact_type ?? (artifact as any).type);
    const currentJson = (artifact as any).content_json ?? {};
    const suggestionTargetType = safeLower((sug as any).target_artifact_type);

    // Optional fast-path: add_stakeholder suggestion -> canonical table
    // (still via RLS; if policies don't allow, you get a clear error)
    if (suggestionType === "add_stakeholder") {
      const payload = patch && typeof patch === "object" ? (patch.payload ?? patch.data ?? patch) : {};

      const name = safeStr((payload as any)?.name).trim();
      if (!name) {
        return jsonNoStore({ ok: false, error: "Missing payload.name for add_stakeholder" }, { status: 400 });
      }

      const role = safeStr((payload as any)?.role).trim() || null;
      const point_of_contact =
        safeStr((payload as any)?.point_of_contact ?? (payload as any)?.poc).trim() || null;

      const { data: created, error: cErr } = await supabase
        .from("stakeholders")
        .insert({
          project_id: projectUuid,
          artifact_id: artifactId,
          name,
          role,
          point_of_contact,
          source: safeStr((payload as any)?.source).trim() || "ai",
        })
        .select("id")
        .maybeSingle();

      if (cErr) return jsonNoStore({ ok: false, error: cErr.message }, { status: 500 });

      const nowIso = new Date().toISOString();
      const { error: uErr } = await supabase
        .from("ai_suggestions")
        .update({
          status: "applied",
          actioned_by: auth.user.id,
          decided_at: nowIso,
          rejected_at: null,
          updated_at: nowIso,
        })
        .eq("id", suggestionId)
        .eq("project_id", projectUuid);

      if (uErr) {
        return jsonNoStore(
          {
            ok: true,
            applied: true,
            stakeholderId: created?.id ?? null,
            warning: `Failed to mark applied: ${uErr.message}`,
          },
          { status: 200 }
        );
      }

      // best-effort event log
      try {
        await supabase.from("project_events").insert({
          project_id: projectUuid,
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
      } catch {}

      return jsonNoStore({ ok: true, applied: true, stakeholderId: created?.id ?? null });
    }

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

    // 6) Save artifact JSON (RLS)
    const { error: updErr } = await supabase
      .from("artifacts")
      .update({
        content_json: updatedJson,
        updated_at: new Date().toISOString(),
      })
      .eq("id", artifactId)
      .eq("project_id", projectUuid);

    if (updErr) return jsonNoStore({ ok: false, error: updErr.message }, { status: 500 });

    // 7) If stakeholder_register + add_rows => persist to canonical stakeholders table (RLS)
    const persisted = await maybePersistStakeholdersFromAddRows({
      supabase,
      projectId: projectUuid,
      artifactId,
      artifactType,
      suggestionTargetType,
      patch: normalizedPatch,
    });

    // 8) Mark suggestion applied (RLS)
    const nowIso = new Date().toISOString();
    const { error: markErr } = await supabase
      .from("ai_suggestions")
      .update({
        status: "applied",
        actioned_by: auth.user.id,
        decided_at: nowIso,
        rejected_at: null,
        updated_at: nowIso,
      })
      .eq("id", suggestionId)
      .eq("project_id", projectUuid);

    if (markErr) {
      return jsonNoStore(
        {
          ok: true,
          artifactJson: updatedJson,
          persisted,
          warning: `Applied changes but failed to mark suggestion applied: ${markErr.message}`,
        },
        { status: 200 }
      );
    }

    // 9) Log project_event (best effort, via RLS)
    try {
      await supabase.from("project_events").insert({
        project_id: projectUuid,
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
    } catch {}

    return jsonNoStore({
      ok: true,
      artifactJson: updatedJson,
      persisted,
      applied: { suggestionId, status: "applied" },
    });
  } catch (e: any) {
    return jsonNoStore({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
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
  // → 5-col stakeholder register rows:
  // [Stakeholder, Point of Contact, Role, Internal/External, Title/Role]
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
        "Internal", // default
        [impact, notes].filter(Boolean).join(" — ").trim(), // Title/Role
      ];
    })
    .filter(Boolean);

  return { ...(patch ?? {}), kind: "add_rows", rows: mapped };
}

/* =========================================================
   Stakeholder persistence (canonical table) - via RLS
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
    return rows.map((cells: any[]) => ({
      type: "data",
      cells: cells.map((x) => String(x ?? "")),
    }));
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