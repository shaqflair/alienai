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
  if (typeof _normalizeProjectIdentifier === "function") {
    const resolved = _normalizeProjectIdentifier(input);
    return safeStr(resolved).trim();
  }

  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  return v.trim();
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

function uniqueValues(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((v) => safeStr(v).trim())
        .filter(Boolean)
    )
  );
}

/**
 * resolveProjectUuidFast
 * Efficiently resolves a project's primary UUID from various possible identifiers.
 * Strategy:
 * 1) If identifier is a UUID, return it immediately.
 * 2) Search common human-readable columns using BOTH raw and normalized values.
 * 3) Gracefully handle schema variations where columns might not exist.
 */
export async function resolveProjectUuidFast(supabase: any, identifier: string) {
  const raw = safeStr(identifier).trim();

  if (!raw) {
    return {
      projectUuid: null as string | null,
      project: null as any,
      humanCol: null as string | null,
    };
  }

  // If it's already a UUID, return it directly.
  if (looksLikeUuid(raw)) {
    return {
      projectUuid: raw,
      project: null as any,
      humanCol: null as string | null,
    };
  }

  const normalized = normalizeProjectIdentifier(raw);
  const candidateValues = uniqueValues([raw, normalized]);

  // Phase 1: search across configured human-readable columns using both raw and normalized values.
  for (const col of HUMAN_COL_CANDIDATES) {
    for (const value of candidateValues) {
      const { data, error } = await supabase
        .from("projects")
        .select(PROJECT_META_SELECT)
        .eq(col as any, value)
        .maybeSingle();

      if (error) {
        if (isMissingColumnError(error.message, col as any)) break;
        if (isInvalidInputSyntaxError(error)) continue;
        throw error;
      }

      if (data?.id) {
        return {
          projectUuid: String(data.id),
          project: data,
          humanCol: col as string,
        };
      }
    }
  }

  // Phase 2: explicit fallback columns, including raw project_code lookup.
  for (const col of ["slug", "reference", "ref", "code", "project_code"] as const) {
    for (const value of candidateValues) {
      const { data, error } = await supabase
        .from("projects")
        .select(PROJECT_META_SELECT)
        .eq(col as any, value)
        .maybeSingle();

      if (error) {
        if (isMissingColumnError(error.message, col)) break;
        if (isInvalidInputSyntaxError(error)) continue;
        throw error;
      }

      if (data?.id) {
        return {
          projectUuid: String(data.id),
          project: data,
          humanCol: col as string,
        };
      }
    }
  }

  return {
    projectUuid: null as string | null,
    project: null as any,
    humanCol: null as string | null,
  };
}