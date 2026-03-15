// src/app/api/artifacts/[id]/audit/route.ts
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: artifactId } = await params;
    if (!artifactId) return jsonErr("artifact_id is required", 400);

    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    // Resolve project from artifact
    const { data: art, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id")
      .eq("id", artifactId)
      .maybeSingle();

    if (artErr) return jsonErr(artErr.message, 400);
    if (!art?.project_id) return jsonErr("Artifact not found", 404);

    // Membership check
    const { data: memberOk, error: memberErr } = await supabase.rpc("is_project_member", {
      p_project_id: art.project_id,
    });
    if (memberErr) return jsonErr(memberErr.message, 400);
    if (!memberOk) return jsonErr("Forbidden", 403);

    // Fetch audit log
    const { data: rows, error: auditErr } = await supabase
      .from("artifact_audit_log")
      .select("id, action, actor_id, actor_email, section, action_label, summary, before, after, request_id, created_at")
      .eq("artifact_id", artifactId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (auditErr) return jsonErr(auditErr.message, 500);

    // Fetch approval events
    const { data: approvalRows } = await supabase
      .from("approval_audit_log_v")
      .select("id, created_at, actor_email, actor_user_id, action, decision, comment, step_name, step_order, chain_id, step_id, request_id, payload")
      .eq("artifact_id", artifactId)
      .order("created_at", { ascending: false })
      .limit(200);

    // Unify and group by request_id or minute
    type Item = { kind: string; id: any; created_at: string; actor_email?: string | null; actor_id?: string | null; title: string; section: string; summary?: string | null; action?: string; decision?: string | null; step_name?: string | null; before?: any; after?: any; request_id?: string | null };
    const unified: Item[] = [];

    for (const r of rows ?? []) {
      unified.push({
        kind: "content", id: r.id, created_at: r.created_at,
        actor_email: (r as any).actor_email ?? null,
        actor_id: (r as any).actor_id ?? null,
        title: safeStr((r as any).action_label || "Document updated"),
        section: safeStr((r as any).section || "general"),
        summary: (r as any).summary ?? null,
        before: (r as any).before ?? null,
        after: (r as any).after ?? null,
        request_id: (r as any).request_id ?? null,
      });
    }

    for (const r of approvalRows ?? []) {
      const a = safeStr((r as any).action);
      const d = safeStr((r as any).decision);
      const label = d || a || "event";
      const pretty = label === "approved" ? "Approved"
        : label === "rejected" ? "Rejected"
        : label === "request_changes" || label === "changes_requested" ? "Requested changes"
        : label === "submitted" ? "Submitted for approval"
        : label.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      const stepName = safeStr((r as any).step_name).trim();
      unified.push({
        kind: "approval", id: r.id, created_at: r.created_at,
        actor_email: (r as any).actor_email ?? null,
        actor_id: (r as any).actor_user_id ?? null,
        title: stepName ? `Approval - ${pretty} - ${stepName}` : `Approval - ${pretty}`,
        section: "approval",
        summary: safeStr((r as any).comment).trim() || d || a || null,
        action: a,
        decision: d || null,
        step_name: stepName || null,
        request_id: (r as any).request_id ?? null,
      });
    }

    // Group by request_id or minute bucket
    const groups = new Map<string, any>();
    for (const u of unified) {
      const d = new Date(u.created_at);
      const bucket = isNaN(d.getTime()) ? "unknown"
        : `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}-${d.getUTCMinutes()}`;
      const key = u.request_id ? `req:${u.request_id}` : `${bucket}:${u.kind}`;

      if (!groups.has(key)) {
        groups.set(key, {
          group_key: key, created_at: u.created_at,
          actor_email: u.actor_email, actor_id: u.actor_id,
          title: u.kind === "approval" ? "Approval activity" : "Document updated",
          section: u.kind === "approval" ? "approval" : "general",
          summaries: [], items: [],
        });
      }
      const g = groups.get(key);
      if (!g.actor_email && u.actor_email) g.actor_email = u.actor_email;
      if (!g.actor_id && u.actor_id) g.actor_id = u.actor_id;
      if (g.created_at < u.created_at) g.created_at = u.created_at;
      if (u.kind === "approval") { g.section = "approval"; g.title = u.title || g.title; }
      else if (u.title && u.title !== "Document updated") g.title = u.title;
      if (u.summary) g.summaries.push(u.summary);
      g.items.push({ id: u.id, created_at: u.created_at, section: u.section, action_label: u.title, summary: u.summary, before: u.before, after: u.after, kind: u.kind, action: u.action, decision: u.decision, step_name: u.step_name });
    }

    const events = Array.from(groups.values())
      .map(g => ({ ...g, summaries: Array.from(new Set(g.summaries)).slice(0, 8), item_count: g.items.length }))
      .sort((a, b) => a.created_at < b.created_at ? 1 : -1);

    return jsonOk({ events });
  } catch (e: any) {
    return jsonErr("Unexpected error", 500, { message: String(e?.message || e) });
  }
}