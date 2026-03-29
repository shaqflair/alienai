// src/app/projects/[id]/artifacts/[artifactId]/_lib/resolveProjectUuidFast.ts
import "server-only";

import {
  HUMAN_COL_CANDIDATES,
  PROJECT_META_SELECT,
  isInvalidInputSyntaxError as _isInvalidInputSyntaxError,
  isMissingColumnError as _isMissingColumnError,
  looksLikeUuid as _looksLikeUuid,
  safeStr as _safeStr,
} from "./artifact-detail-utils";

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

/**
 * IMPORTANT:
 * Do NOT delegate to imported normalizeProjectIdentifier here.
 * Some older normalizers strip prefixes like PRJ-100 -> 100,
 * which breaks project_code-based routing.
 */
function normalizeProjectIdentifier(input: string) {
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

function extractDigits(input: string): string | null {
  const m = String(input).match(/(\d{3,})$/);
  return m?.[1] ?? null;
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

export async function resolveProjectUuidFast(supabase: any, identifier: string) {
  const raw = safeStr(identifier).trim();

  if (!raw) {
    return {
      projectUuid: null as string | null,
      project: null as any,
      humanCol: null as string | null,
    };
  }

  if (looksLikeUuid(raw)) {
    return {
      projectUuid: raw,
      project: null as any,
      humanCol: null as string | null,
    };
  }

  const normalized = normalizeProjectIdentifier(raw);
  const digits = extractDigits(raw);
  const candidateValues = uniqueValues([raw, normalized, ...(digits ? [digits] : [])]);

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