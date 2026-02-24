// src/lib/ai/aiGuard.ts
import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/utils/supabase/server";

/**
 * Defaults (Balanced)
 * - user: 20 / 5 min
 * - org:  200 / 5 min
 *
 * Override via env if needed:
 * - AI_RL_USER_WINDOW_SECONDS, AI_RL_USER_MAX
 * - AI_RL_ORG_WINDOW_SECONDS,  AI_RL_ORG_MAX
 */
const USER_WINDOW_SECONDS = Number(process.env.AI_RL_USER_WINDOW_SECONDS || "300");
const USER_MAX = Number(process.env.AI_RL_USER_MAX || "20");

const ORG_WINDOW_SECONDS = Number(process.env.AI_RL_ORG_WINDOW_SECONDS || "300");
const ORG_MAX = Number(process.env.AI_RL_ORG_MAX || "200");

type GuardOk = {
  ok: true;
  userId: string;
  projectId?: string | null;
  organisationId?: string | null;
};

type GuardErr = {
  ok: false;
  status: number;
  error: string;
  meta?: any;
};

type GuardResult = GuardOk | GuardErr;

function nowIso() {
  return new Date().toISOString();
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

async function getProjectOrgId(sb: any, projectId: string) {
  const { data, error } = await sb
    .from("projects")
    .select("id, organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) return { error };
  return { project: data as any };
}

async function checkProjectMember(sb: any, userId: string, projectId: string) {
  const { data, error } = await sb
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) return { error };
  return { ok: !!data };
}

/**
 * Simple DB-backed limiter.
 * Note: This is “good enough” for early prod traffic.
 * If you want perfect atomicity under high contention, we can replace this with a SQL RPC.
 */
async function bumpLimiter(key: string, windowSeconds: number, max: number) {
  const svc = createServiceClient();

  const now = new Date();
  const windowStartMs = now.getTime() - (now.getTime() % (windowSeconds * 1000));
  const windowStartIso = new Date(windowStartMs).toISOString();

  // 1) Read current
  const { data: cur, error: readErr } = await svc
    .from("ai_rate_limits")
    .select("key, window_start, window_seconds, count")
    .eq("key", key)
    .maybeSingle();

  if (readErr) return { error: readErr };

  // 2) Insert if missing
  if (!cur) {
    const { data: ins, error: insErr } = await svc
      .from("ai_rate_limits")
      .insert({
        key,
        window_start: windowStartIso,
        window_seconds: windowSeconds,
        count: 1,
        updated_at: nowIso(),
      })
      .select("count, window_start, window_seconds")
      .single();

    if (insErr) return { error: insErr };
    return { ok: true, count: Number((ins as any).count || 1), max, windowStart: windowStartIso, windowSeconds };
  }

  const sameWindow =
    safeStr((cur as any).window_start) === windowStartIso && Number((cur as any).window_seconds) === windowSeconds;

  if (!sameWindow) {
    const { data: upd, error: updErr } = await svc
      .from("ai_rate_limits")
      .update({
        window_start: windowStartIso,
        window_seconds: windowSeconds,
        count: 1,
        updated_at: nowIso(),
      })
      .eq("key", key)
      .select("count, window_start, window_seconds")
      .single();

    if (updErr) return { error: updErr };
    return { ok: true, count: Number((upd as any).count || 1), max, windowStart: windowStartIso, windowSeconds };
  }

  const nextCount = Number((cur as any).count || 0) + 1;

  const { data: upd, error: updErr } = await svc
    .from("ai_rate_limits")
    .update({ count: nextCount, updated_at: nowIso() })
    .eq("key", key)
    .select("count, window_start, window_seconds")
    .single();

  if (updErr) return { error: updErr };

  const count = Number((upd as any).count || nextCount);
  return { ok: count <= max, count, max, windowStart: windowStartIso, windowSeconds };
}

export async function requireAiAccess(opts: {
  projectId?: string | null;
  kind: string; // e.g. "wireai.generate" | "raid.ai-refresh"
}): Promise<GuardResult> {
  const sb = await createClient();

  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr || !auth?.user) return { ok: false, status: 401, error: "Unauthorized" };

  const userId = auth.user.id;
  const projectId = safeStr(opts.projectId).trim() || null;

  let organisationId: string | null = null;

  // If projectId provided, enforce membership and resolve org
  if (projectId) {
    const { project, error: projErr } = await getProjectOrgId(sb, projectId);
    if (projErr) return { ok: false, status: 500, error: "Project lookup failed", meta: { message: projErr.message } };
    if (!project?.id) return { ok: false, status: 404, error: "Not found" };

    organisationId = safeStr(project.organisation_id).trim() || null;

    const { ok, error: memErr } = await checkProjectMember(sb, userId, projectId);
    if (memErr) return { ok: false, status: 500, error: "Membership check failed", meta: { message: memErr.message } };
    if (!ok) return { ok: false, status: 404, error: "Not found" };
  }

  // Rate limit: user
  const userKey = `u:${userId}:${opts.kind}`;
  const userRL = await bumpLimiter(userKey, USER_WINDOW_SECONDS, USER_MAX);
  if ((userRL as any).error) {
    const e = (userRL as any).error;
    return { ok: false, status: 500, error: "Rate limiter failed", meta: { message: e?.message || String(e) } };
  }
  if (!(userRL as any).ok) {
    return { ok: false, status: 429, error: "Rate limit exceeded (user)", meta: userRL };
  }

  // Rate limit: org (only if we have an org)
  if (organisationId) {
    const orgKey = `o:${organisationId}:${opts.kind}`;
    const orgRL = await bumpLimiter(orgKey, ORG_WINDOW_SECONDS, ORG_MAX);
    if ((orgRL as any).error) {
      const e = (orgRL as any).error;
      return { ok: false, status: 500, error: "Rate limiter failed", meta: { message: e?.message || String(e) } };
    }
    if (!(orgRL as any).ok) {
      return { ok: false, status: 429, error: "Rate limit exceeded (org)", meta: orgRL };
    }
  }

  return { ok: true, userId, projectId, organisationId };
}