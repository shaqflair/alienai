// src/app/projects/[id]/artifacts/[artifactId]/_lib/resolveProjectUuidFast.ts
import "server-only";

import {
  HUMAN_COL_CANDIDATES,
  PROJECT_META_SELECT,
  isInvalidInputSyntaxError as _isInvalidInputSyntaxError,
  isMissingColumnError as _isMissingColumnError,
  looksLikeUuid as _looksLikeUuid,
  normalizeProjectIdentifier as _normalizeProjectIdentifier,
  safeStr as _safeStr,
} from "./artifact-detail-utils";

/**
 * Local fallbacks to prevent "is not a function" runtime issues if the imported module
 * gets out of sync / cached / duplicated by bundler.
 */
function safeStr(x: unknown) {
  if (typeof _safeStr === "function") return _safeStr(x);
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  if (typeof _looksLikeUuid === "function") return _looksLikeUuid(s);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function normalizeProjectIdentifier(input: string) {
  if (typeof _normalizeProjectIdentifier === "function") return _normalizeProjectIdentifier(input);

  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();

  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];

  return v;
}

function isMissingColumnError(errMsg: string, col: string) {
  if (typeof _isMissingColumnError === "function") return _isMissingColumnError(errMsg, col);

  const m = String(errMsg || "").toLowerCase();
  const c = String(col || "").toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}

function isInvalidInputSyntaxError(err: any) {
  if (typeof _isInvalidInputSyntaxError === "function") return _isInvalidInputSyntaxError(err);
  return String(err?.code || "").trim() === "22P02";
}

/**
 * resolveProjectUuidFast
 * Efficiently resolves a project's primary UUID from various possible identifiers.
 * Strategy:
 * 1) If identifier is a UUID, return it immediately.
 * 2) Otherwise check common human-readable columns.
 * 3) Gracefully handle schema variations where columns might not exist.
 */
export async function resolveProjectUuidFast(supabase: any, identifier: string) {
  const raw = safeStr(identifier).trim();

  if (!raw) {
    return { projectUuid: null as string | null, project: null as any, humanCol: null as string | null };
  }

  // ✅ If it's a UUID, no lookup needed.
  if (looksLikeUuid(raw)) {
    return { projectUuid: raw, project: null as any, humanCol: null as string | null };
  }

  const normalized = normalizeProjectIdentifier(raw);

  // Phase 1: normalized search across candidate columns
  for (const col of HUMAN_COL_CANDIDATES) {
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_META_SELECT)
      .eq(col as any, normalized)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col as any)) continue;
      if (isInvalidInputSyntaxError(error)) continue;
      throw error;
    }

    if (data?.id) return { projectUuid: String(data.id), project: data, humanCol: col as string };
  }

  // Phase 2: raw search for slug-ish columns
  for (const col of ["slug", "reference", "ref", "code"] as const) {
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_META_SELECT)
      .eq(col as any, raw)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      if (isInvalidInputSyntaxError(error)) continue;
      throw error;
    }

    if (data?.id) return { projectUuid: String(data.id), project: data, humanCol: col as string };
  }

  return { projectUuid: null as string | null, project: null as any, humanCol: null as string | null };
}
