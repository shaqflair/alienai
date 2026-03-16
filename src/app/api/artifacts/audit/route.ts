// src/app/api/artifacts/audit/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function minuteBucket(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "min:unknown";
  return `min:${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}-${d.getUTCMinutes()}`;
}

function approvalTitle(action: string, decision?: string | null, stepName?: string | null) {
  const a = safeStr(action).trim().toLowerCase();
  const d = safeStr(decision).trim().toLowerCase();
  const label = d || a || "event";
  const pretty =
    label === "approved" ? "Approved"
    : label === "rejected" ? "Rejected"
    : label === "request_changes" || label === "changes_requested" ? "Requested changes"
    : label === "submitted" ? "Submitted for approval"
    : label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const step = safeStr(stepName).trim();
  return step ? `Approval - ${pretty} - ${step}` : `Approval - ${pretty}`;
}

function approvalSummary(action: string, decision?: string | null, comment?: string | null) {
  const c = safeStr(comment).trim();
  const d = safeStr(decision).trim();
  const a = safeStr(action).trim();
  if (c) return c;
  if (d) return d;
  if (a) return a;
  return null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const artifact_id = safeStr(url.searchParams.get("artifact_id")).trim();
    if (!artifact_id) return jsonErr("artifact_id is required", 400);

    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    // Resolve project from artifact
    const { data: art, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id")
      .eq("id", artifact_id)
      .maybeSingle();

    if (artErr) return jsonErr(artErr.message, 400);
    if (!art?.project_id) return jsonErr("Artifact not found", 404);

    // Membership check via RPC
    const { data: memberOk, error: memberErr } = await supabase.rpc("is_project_member", {
      p_project_id: art.project_id,
    });
    if (memberErr) return jsonErr(memberErr.message, 400);
    if (!memberOk) return jsonErr("Forbidden", 403);

    // Fetch content audit log
    const [contentRes, approvalRes] = await Promise.all([
      supabase
        .from("artifact_audit_log")
        .select("id, artifact_id, project_id, actor_id, actor_email, action, section, action_label, summary, changed_columns, content_json_paths, request_id, route, created_at, before, after")
        .eq("artifact_id", artifact_id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("approval_audit_log_v")
        .select("id, created_at, project_id, artifact_id, artifact_title, artifact_kind, step_id, step_name, step_order, chain_id, actor_user_id, actor_email, action, decision, comment, request_id, payload")
        .eq("artifact_id", artifact_id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(200),
    ]);

    if (contentRes.error) return jsonErr(contentRes.error.message, 500);
    if (approvalRes.error) return jsonErr(approvalRes.error.message, 500);

    type UnifiedItem = {
      kind: "content" | "approval";
      id: any;
      created_at: string;
      actor_email?: string | null;
      actor_id?: string | null;
      title: string;
      section: string;
      summary?: string | null;
      content_json_paths?: any;
      changed_columns?: any;
      before?: any;
      after?: any;
      request_id?: string | null;
      action?: string;
      decision?: string | null;
      step_name?: string | null;
      step_order?: number | null;
      chain_id?: string | null;
      step_id?: string | null;
      payload?: any;
    };

    const unified: UnifiedItem[] = [];

    for (const r of (contentRes.data as any[]) ?? []) {
      unified.push({
        kind: "content",
        id: r.id,
        created_at: r.created_at,
        actor_email: r.actor_email ?? null,
        actor_id: r.actor_id ?? null,
        title: safeStr(r.action_label || "Document updated"),
        section: safeStr(r.section || "general") || "general",
        summary: r.summary ?? null,
        content_json_paths: r.content_json_paths ?? null,
        changed_columns: r.changed_columns ?? null,
        before: r.before ?? null,
        after: r.after ?? null,
        request_id: r.request_id ?? null,
      });
    }

    for (const r of (approvalRes.data as any[]) ?? []) {
      unified.push({
        kind: "approval",
        id: r.id,
        created_at: r.created_at,
        actor_email: r.actor_email ?? null,
        actor_id: r.actor_user_id ?? null,
        title: approvalTitle(r.action, r.decision, r.step_name),
        section: "approval",
        summary: approvalSummary(r.action, r.decision, r.comment),
        action: r.action,
        decision: r.decision ?? null,
        step_name: r.step_name ?? null,
        step_order: r.step_order ?? null,
        chain_id: r.chain_id ?? null,
        step_id: r.step_id ?? null,
        request_id: r.request_id ?? null,
        payload: r.payload ?? null,
      });
    }

    // Group by request_id or minute bucket
    const groups = new Map<string, any>();

    for (const u of unified) {
      const key = u.request_id
        ? `req:${u.request_id}`
        : `${minuteBucket(u.created_at)}:${u.kind}`;

      if (!groups.has(key)) {
        groups.set(key, {
          group_key: key,
          created_at: u.created_at,
          actor_email: u.actor_email || null,
          actor_id: u.actor_id || null,
          title: u.kind === "approval" ? "Approval activity" : "Document updated",
          section: u.kind === "approval" ? "approval" : "general",
          summaries: [] as string[],
          items: [] as any[],
        });
      }

      const g = groups.get(key);
      if (!g.actor_email && u.actor_email) g.actor_email = u.actor_email;
      if (!g.actor_id && u.actor_id) g.actor_id = u.actor_id;
      if (g.created_at < u.created_at) g.created_at = u.created_at;

      if (u.kind === "approval") {
        g.section = "approval";
        g.title = u.title || g.title;
      } else {
        if (u.section && u.section !== "general") g.section = u.section;
        if (u.title && u.title !== "Document updated") g.title = u.title;
      }

      if (u.summary) g.summaries.push(u.summary);

      if (u.kind === "content") {
        g.items.push({ id: u.id, created_at: u.created_at, section: u.section, action_label: u.title, summary: u.summary, changed_columns: u.changed_columns, content_json_paths: u.content_json_paths, before: u.before, after: u.after, kind: "content" });
      } else {
        g.items.push({ id: u.id, created_at: u.created_at, section: "approval", action_label: u.title, summary: u.summary, kind: "approval", action: u.action, decision: u.decision, step_name: u.step_name, step_order: u.step_order });
      }
    }

    const events = Array.from(groups.values())
      .map((g) => ({ ...g, summaries: Array.from(new Set(g.summaries)).slice(0, 8), item_count: g.items.length }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    return jsonOk({ events }, 200);
  } catch (e: any) {
    return jsonErr("Unexpected error", 500, { message: String(e?.message || e) });
  }
}