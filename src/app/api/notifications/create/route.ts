import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function err(message: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error: message, ...(meta ? { meta } : {}) }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function isUuid(x: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function uniqStrings(xs: any[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs || []) {
    const s = safeStr(x).trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Accepts:
 * - YYYY-MM-DD
 * - ISO string
 * - Date
 * Returns: YYYY-MM-DD or null (UTC)
 */
function normalizeDueDate(x: any): string | null {
  const s = safeStr(x).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isPastUtcDate(yyyyMmDd: string) {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);
  const d = Date.parse(`${yyyyMmDd}T00:00:00Z`);
  if (Number.isNaN(d)) return false;
  return d < todayUtc;
}

/**
 * Ensure we have a stable dedupe key for upsert.
 * Your DB has: UNIQUE (user_id, source_type, source_id) WHERE source_type/source_id not null
 *
 * We will:
 * 1) Prefer body.source_type/source_id
 * 2) Else prefer metadata.source_type/source_id (or sourceType/sourceId)
 * 3) Else if artifact_id exists => ("artifact", artifact_id)
 * 4) Else if due_date+project_id+type => ("due", `${project_id}:${type}:${due_date}`)
 * 5) Else null (no upsert possible)
 */
function deriveSourceKeys(args: {
  project_id: string | null;
  artifact_id: string | null;
  type: string;
  due_date: string | null;
  source_type_in: string | null;
  source_id_in: string | null;
  metadata: any;
}) {
  const meta = args.metadata && typeof args.metadata === "object" ? args.metadata : {};

  const st =
    safeStr(args.source_type_in).trim() ||
    safeStr(meta.source_type).trim() ||
    safeStr(meta.sourceType).trim() ||
    "";

  const sid =
    safeStr(args.source_id_in).trim() ||
    safeStr(meta.source_id).trim() ||
    safeStr(meta.sourceId).trim() ||
    safeStr(meta.sourceKey).trim() ||
    "";

  if (st && sid) return { source_type: st, source_id: sid };

  if (args.artifact_id) return { source_type: "artifact", source_id: args.artifact_id };

  if (args.due_date && args.project_id && args.type) {
    return { source_type: "due", source_id: `${args.project_id}:${args.type}:${args.due_date}` };
  }

  return { source_type: null as string | null, source_id: null as string | null };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return err("Invalid JSON body", 400);

  const project_id_raw = safeStr((body as any).project_id).trim();
  const project_id = project_id_raw || null;

  const artifact_id_raw = safeStr((body as any).artifact_id).trim();
  const artifact_id = artifact_id_raw || null;

  const type = safeStr((body as any).type).trim();
  const title = safeStr((body as any).title).trim();
  const messageBody = (body as any).body ?? null;
  const link = safeStr((body as any).link).trim() || null;

  const actor_user_id_raw = safeStr((body as any).actor_user_id).trim();
  const actor_user_id = actor_user_id_raw || null;

  const metadata = (body as any).metadata ?? {};

  // optional: provided source keys
  const source_type_in = safeStr((body as any).source_type).trim() || null;
  const source_id_in = safeStr((body as any).source_id).trim() || null;

  // due_date: prefer explicit, else metadata
  const due_date = normalizeDueDate(
    (body as any).due_date ??
      (body as any)?.metadata?.dueDate ??
      (body as any)?.metadata?.due_date ??
      (body as any)?.metadata?.due
  );

  const bucket_in = safeStr((body as any).bucket).trim() || null;

  const recipientsIn = Array.isArray((body as any).recipients) ? (body as any).recipients : [];
  const recipients = uniqStrings(recipientsIn);

  // ---- validation
  if (project_id && !isUuid(project_id)) return err("project_id must be a UUID (or omit)", 400, { project_id });
  if (artifact_id && !isUuid(artifact_id)) return err("artifact_id must be a UUID (or omit)", 400, { artifact_id });

  if (!type) return err("type is required", 400);
  if (!title) return err("title is required", 400);
  if (!recipients.length) return err("recipients[] required", 400);

  const badRecipient = recipients.find((r) => !isUuid(r));
  if (badRecipient) return err("All recipients must be user UUIDs", 400, { badRecipient });

  if (actor_user_id && !isUuid(actor_user_id)) {
    return err("actor_user_id must be a UUID (or omit)", 400, { actor_user_id });
  }

  // ---- auth (cookie client)
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr || !auth?.user) return err("Not authenticated", 401, { authErr: authErr?.message || null });

  const callerId = auth.user.id;

  // ---- authorisation: if project_id provided, enforce owner/editor
  if (project_id) {
    const { data: roleRow, error: roleErr } = await sb
      .from("project_members")
      .select("role")
      .eq("project_id", project_id)
      .eq("user_id", callerId)
      .is("removed_at", null)
      .maybeSingle();

    if (roleErr) return err("Failed to check membership", 500, { roleErr: roleErr.message });

    const role = safeStr(roleRow?.role).toLowerCase();
    if (!(role === "owner" || role === "editor")) return err("Forbidden", 403, { role });

    // recipients must be project members
    const { data: memberRows, error: memErr } = await sb
      .from("project_members")
      .select("user_id")
      .eq("project_id", project_id)
      .in("user_id", recipients)
      .is("removed_at", null);

    if (memErr) return err("Failed to validate recipients", 500, { memErr: memErr.message });

    const allowed = new Set((memberRows ?? []).map((r: any) => safeStr(r?.user_id).trim()).filter(Boolean));
    const filteredRecipients = recipients.filter((id: string) => allowed.has(id));

    if (!filteredRecipients.length) {
      return err("No valid recipients for this project", 400, {
        project_id,
        callerId,
        recipients_in: recipients,
        recipients_valid_members: Array.from(allowed),
      });
    }

    // replace with filtered list
    recipients.length = 0;
    recipients.push(...filteredRecipients);
  }

  const svc = createServiceClient();

  // bucket derivation (unless explicitly provided)
  const derivedBucket = bucket_in || (due_date && isPastUtcDate(due_date) ? "overdue" : null);

  // derive stable source keys for UPSERT (important!)
  const { source_type, source_id } = deriveSourceKeys({
    project_id,
    artifact_id,
    type,
    due_date,
    source_type_in,
    source_id_in,
    metadata,
  });

  const usingSourceDedupe = !!(source_type && source_id);

  const rows = recipients.map((uid: string) => ({
    user_id: uid,
    project_id,
    artifact_id,
    type,
    title,
    body: messageBody ?? null,
    link,
    is_read: false,
    actor_user_id: actor_user_id || callerId,
    metadata: metadata ?? {},
    source_type: source_type,
    source_id: source_id,
    due_date,
    bucket: derivedBucket,
  }));

  // ---- Path A: UPSERT via (user_id, source_type, source_id)
  if (usingSourceDedupe) {
    const { data: upserted, error: upErr } = await svc
      .from("notifications")
      .upsert(rows, {
        onConflict: "user_id,source_type,source_id",
        ignoreDuplicates: false,
      })
      .select("id,user_id,project_id,artifact_id,type,title,is_read,created_at,source_type,source_id,due_date,bucket");

    if (upErr) {
      return err("Upsert failed", 500, {
        message: upErr.message,
        code: (upErr as any).code || null,
        details: (upErr as any).details || null,
        hint: (upErr as any).hint || null,
        usingSourceDedupe,
        source_type,
        source_id,
      });
    }

    return ok({
      upserted: upserted?.length ?? rows.length,
      items: upserted ?? [],
      meta: { usingSourceDedupe, source_type, source_id, derivedBucket, due_date },
    });
  }

  // ---- Path B: Insert (may hit UNIQUE (user_id, artifact_id, type))
  const { data: inserted, error: insErr } = await svc
    .from("notifications")
    .insert(rows)
    .select("id,user_id,project_id,artifact_id,type,title,is_read,created_at,due_date,bucket");

  if (!insErr) {
    return ok({
      inserted: inserted?.length ?? rows.length,
      items: inserted ?? [],
      meta: { usingSourceDedupe: false, derivedBucket, due_date },
    });
  }

  // ---- Fallback update if we hit unique violation on (user_id, artifact_id, type)
  const code = (insErr as any).code || "";
  const msg = insErr.message || "";

  if (String(code) === "23505" && artifact_id) {
    const updatedItems: any[] = [];

    for (const r of rows) {
      const { data: updated, error: upErr } = await svc
        .from("notifications")
        .update({
          title: r.title,
          body: r.body,
          link: r.link,
          metadata: r.metadata,
          actor_user_id: r.actor_user_id,
          due_date: r.due_date,
          bucket: r.bucket,
          is_read: false, // reopen
          // optional: bump created_at so it rises to top in UI
          created_at: new Date().toISOString(),
        })
        .eq("user_id", r.user_id)
        .eq("artifact_id", artifact_id)
        .eq("type", r.type)
        .select("id,user_id,project_id,artifact_id,type,title,is_read,created_at,due_date,bucket")
        .maybeSingle();

      if (upErr) {
        return err("Insert hit dedupe, and fallback update failed", 500, {
          insertError: { code, msg },
          updateError: upErr.message,
          user_id: r.user_id,
          artifact_id,
          type: r.type,
        });
      }

      if (updated) updatedItems.push(updated);
    }

    return ok({
      upserted: updatedItems.length,
      items: updatedItems,
      meta: { insertError: { code, msg }, usingSourceDedupe: false, derivedBucket, due_date },
    });
  }

  return err("Insert failed", 500, {
    message: insErr.message,
    code: (insErr as any).code || null,
    details: (insErr as any).details || null,
    hint: (insErr as any).hint || null,
  });
}

