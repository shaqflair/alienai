// src/lib/projects/server-helpers.ts
import "server-only";

/**
 * Minimal shared helpers for resolving a project identifier into a UUID.
 * Supports:
 *  - UUID (projects.id)
 *  - project_code (projects.project_code)
 *
 * Optional in-memory memoization (best-effort; safe in serverless).
 */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

type CacheEntry = { value: string | null; exp: number };
const _cache = new Map<string, CacheEntry>();

function cacheGet(key: string) {
  const hit = _cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.exp) {
    _cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key: string, value: string | null, ttlMs: number) {
  _cache.set(key, { value, exp: Date.now() + ttlMs });
}

export async function resolveProjectUuid(
  supabase: any,
  identifier: string,
  opts?: { cacheTtlMs?: number }
): Promise<string | null> {
  const raw = safeStr(identifier).trim();
  if (!raw) return null;

  // UUID passthrough
  if (looksLikeUuid(raw)) return raw;

  const ttl = Math.max(0, Number(opts?.cacheTtlMs ?? 30_000)); // 30s default
  const cacheKey = `project_code:${raw}`;

  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("project_code", raw)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const uuid = data?.id ? String(data.id).trim() : null;

  if (ttl > 0) cacheSet(cacheKey, uuid, ttl);

  return uuid;
}

export async function loadProjectMeta(
  supabase: any,
  projectUuid: string
): Promise<{
  project_human_id: string | null; // MUST be project_code
  project_code: string | null;
  project_name: string | null;
}> {
  const { data, error } = await supabase
    .from("projects")
    .select("title, project_code")
    .eq("id", projectUuid)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const project_code = safeStr(data?.project_code).trim() || null;
  const project_name = safeStr(data?.title).trim() || null;

  return {
    project_human_id: project_code,
    project_code,
    project_name,
  };
}

export function normalizeProjectHumanId(projectHumanId: string | null | undefined, fallback: string) {
  const v = safeStr(projectHumanId).trim();
  return v || safeStr(fallback).trim();
}
