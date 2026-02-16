// src/app/api/change/[id]/attachments/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

// You can override bucket name via env var, else default
const BUCKET = process.env.CHANGE_ATTACHMENTS_BUCKET || "change_attachments";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function looksLikePublicCr(s: string) {
  return /^cr-\d+$/i.test(s.trim());
}

function sanitizeFileName(name: string) {
  const n = safeStr(name).trim() || "file";
  // keep it safe for storage paths
  return n.replace(/[^\w.\-()+ ]+/g, "_").replace(/\s+/g, " ").slice(0, 180);
}

async function requireAuth(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

/**
 * Supports:
 * - UUID change request id
 * - public id like "cr-15" (expects change_requests.public_id)
 */
async function resolveChangeRequest(supabase: any, rawChangeId: string) {
  const raw = safeStr(rawChangeId).trim();
  if (!raw) return null;

  const q = supabase.from("change_requests").select("id, project_id, artifact_id, public_id");

  let resp;
  if (looksLikeUuid(raw)) {
    resp = await q.eq("id", raw).maybeSingle();
  } else if (looksLikePublicCr(raw)) {
    resp = await q.eq("public_id", raw.toLowerCase()).maybeSingle();
  } else {
    // Unknown identifier format – avoid hitting uuid columns with junk
    throw new Error("Invalid change id");
  }

  const { data: cr, error } = resp;
  if (error) throw new Error(error.message);
  return cr || null;
}

async function requireChangeAccess(supabase: any, rawChangeId: string) {
  // 1) resolve + fetch change request (supports uuid or public_id)
  const cr = await resolveChangeRequest(supabase, rawChangeId);
  if (!cr) throw new Error("Not found");

  // 2) membership check (project_members)
  const user = await requireAuth(supabase);

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", cr.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Forbidden");

  return {
    user,
    changeId: safeStr(cr.id), // canonical UUID
    projectId: safeStr(cr.project_id),
    artifactId: safeStr(cr.artifact_id),
    publicId: safeStr(cr.public_id),
  };
}

function jsonOk(payload: any) {
  return NextResponse.json({ ok: true, ...payload }, { status: 200 });
}
function jsonErr(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function filenameFromStorageObjectName(objName: string) {
  // stored as: `${ts}__${filename}`
  const n = safeStr(objName).trim();
  if (!n) return "Attachment";
  const idx = n.indexOf("__");
  if (idx >= 0 && idx + 2 < n.length) return n.slice(idx + 2);
  return n;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    const rawId = safeStr(id).trim();
    if (!rawId) return jsonErr("Missing change id", 400);

    const supabase = await createClient();
    const access = await requireChangeAccess(supabase, rawId);

    const prefix = `change/${access.changeId}`;

    // 1) Prefer DB table if you have it
    let rows: any[] = [];
    try {
      const { data, error } = await supabase
        .from("change_attachments")
        .select("id, change_id, filename, content_type, size_bytes, path, created_at, created_by")
        .eq("change_id", access.changeId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      rows = Array.isArray(data) ? data : [];
    } catch {
      rows = [];
    }

    // If DB rows exist, use them (best UX: stable metadata)
    if (rows.length) {
      const items: any[] = [];

      for (const r of rows) {
        const path = safeStr(r?.path);
        let signedUrl = "";
        if (path) {
          const { data: signed, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
          if (!sErr) signedUrl = safeStr((signed as any)?.signedUrl);
        }

        items.push({
          id: safeStr(r?.id) || path,
          filename: safeStr(r?.filename) || "Attachment",
          content_type: safeStr(r?.content_type) || "application/octet-stream",
          size_bytes: Number(r?.size_bytes ?? 0) || 0,
          path,
          created_at: r?.created_at,
          signedUrl,
          url: signedUrl,
        });
      }

      return jsonOk({
        items,
        source: "db",
        bucket: BUCKET,
        prefix,
        projectId: access.projectId,
        artifactId: access.artifactId,
        changeId: access.changeId,
        publicId: access.publicId,
      });
    }

    // 2) Fallback: list from Storage directly.
    // This fixes the scenario where uploads succeed but DB insert was blocked (RLS) and silently skipped.
    const { data: listed, error: listErr } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });

    if (listErr) {
      // Keep error message explicit so you can see RLS/policy issues (e.g. "new row violates RLS" / "permission denied")
      throw new Error(listErr.message);
    }

    const objs = Array.isArray(listed) ? listed : [];
    const items: any[] = [];

    for (const o of objs) {
      const objName = safeStr((o as any)?.name);
      if (!objName) continue;

      const path = `${prefix}/${objName}`;

      let signedUrl = "";
      const { data: signed, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
      if (!sErr) signedUrl = safeStr((signed as any)?.signedUrl);

      const meta = (o as any)?.metadata ?? {};
      const sizeBytes = Number((o as any)?.size ?? 0) || Number((meta as any)?.size ?? 0) || Number((meta as any)?.contentLength ?? 0) || 0;

      const contentType = safeStr((meta as any)?.mimetype) || safeStr((meta as any)?.contentType) || "application/octet-stream";

      items.push({
        id: safeStr((o as any)?.id) || path,
        filename: filenameFromStorageObjectName(objName),
        content_type: contentType,
        size_bytes: sizeBytes,
        path,
        created_at: (o as any)?.created_at || (o as any)?.updated_at || null,
        signedUrl,
        url: signedUrl,
      });
    }

    return jsonOk({
      items,
      source: "storage",
      bucket: BUCKET,
      prefix,
      projectId: access.projectId,
      artifactId: access.artifactId,
      changeId: access.changeId,
      publicId: access.publicId,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed to list attachments";
    const code = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : msg === "Invalid change id" ? 400 : 400;
    return jsonErr(msg, code);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    const rawId = safeStr(id).trim();
    if (!rawId) return jsonErr("Missing change id", 400);

    const supabase = await createClient();
    const access = await requireChangeAccess(supabase, rawId);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonErr("Missing file", 400);

    const filename = sanitizeFileName(safeStr(form.get("filename")) || file.name);
    const contentType = safeStr(form.get("content_type")) || file.type || "application/octet-stream";

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `change/${access.changeId}/${ts}__${filename}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType,
      upsert: false,
    });

    if (upErr) throw new Error(upErr.message);

    // Insert DB record if table exists (best-effort)
    // NOTE: Even if this fails (RLS), GET now falls back to Storage listing so UI still shows files.
    let rec: any = null;
    try {
      const artifactIdFromForm = safeStr(form.get("artifactId")).trim();

      const { data: ins, error: insErr } = await supabase
        .from("change_attachments")
        .insert({
          change_id: access.changeId,
          project_id: access.projectId || null,
          artifact_id: (artifactIdFromForm || access.artifactId) || null,
          filename,
          content_type: contentType,
          size_bytes: Number(file.size || 0) || 0,
          path,
          created_by: access.user.id,
        })
        .select("id, filename, content_type, size_bytes, path, created_at")
        .maybeSingle();

      if (insErr) throw insErr;
      rec = ins;
    } catch {
      // ok — storage upload already succeeded
    }

    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
    const signedUrl = safeStr((signed as any)?.signedUrl);

    return jsonOk({
      item: {
        id: safeStr(rec?.id) || path,
        filename,
        content_type: contentType,
        size_bytes: Number(file.size || 0) || 0,
        path,
        created_at: rec?.created_at || new Date().toISOString(),
        signedUrl,
        url: signedUrl,
      },
      changeId: access.changeId,
      publicId: access.publicId,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Upload failed";
    const code = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : msg === "Invalid change id" ? 400 : 400;
    return jsonErr(msg, code);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const { id } = await ctx.params;
    const rawId = safeStr(id).trim();
    if (!rawId) return jsonErr("Missing change id", 400);

    const supabase = await createClient();
    const access = await requireChangeAccess(supabase, rawId);

    const u = new URL(req.url);
    const attachmentId = safeStr(u.searchParams.get("attachmentId")).trim();
    const pathParam = safeStr(u.searchParams.get("path")).trim();

    let path = pathParam;

    const mustPrefix = `change/${access.changeId}/`;

    // If no explicit path, try to resolve it via DB attachment id (UUID)
    if (!path && attachmentId) {
      // If attachmentId is actually a path (storage-style), accept it
      if (attachmentId.startsWith("change/") && attachmentId.includes("/")) {
        path = attachmentId;
      } else if (looksLikeUuid(attachmentId)) {
        const { data, error } = await supabase
          .from("change_attachments")
          .select("id, change_id, path")
          .eq("id", attachmentId)
          .eq("change_id", access.changeId)
          .maybeSingle();

        if (error) throw new Error(error.message);
        if (!data) return jsonErr("Not found", 404);
        path = safeStr((data as any)?.path);
      } else {
        return jsonErr("Invalid attachment id", 400);
      }
    }

    if (!path) return jsonErr("Missing attachment path", 400);

    // Safety: ensure the path is within this change folder
    if (!path.startsWith(mustPrefix)) return jsonErr("Forbidden", 403);

    // 1) remove from storage
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
    if (rmErr) throw new Error(rmErr.message);

    // 2) best-effort: remove DB record(s)
    try {
      if (attachmentId && looksLikeUuid(attachmentId)) {
        await supabase.from("change_attachments").delete().eq("id", attachmentId).eq("change_id", access.changeId);
      } else {
        await supabase.from("change_attachments").delete().eq("change_id", access.changeId).eq("path", path);
      }
    } catch {
      // ok — storage already removed the file
    }

    return jsonOk({ deleted: true, path });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Delete failed";
    const code =
      msg === "Unauthorized"
        ? 401
        : msg === "Forbidden"
        ? 403
        : msg === "Not found"
        ? 404
        : msg === "Invalid change id"
        ? 400
        : 400;
    return jsonErr(msg, code);
  }
}
