import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";

export const runtime = "nodejs";

const BUCKET = "Aliena";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

/* ---------------- small utils ---------------- */

function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

function sanitizeFilename(name: string) {
  const base = String(name || "file").trim();
  const cleaned = base
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return cleaned || "file";
}

function nowIso() {
  return new Date().toISOString();
}

async function requireAuthAndEdit(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Not found");

  const role = String((mem as any).role ?? "viewer").toLowerCase();
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  if (!canEdit) throw new Error("Forbidden");
  return { userId: auth.user.id, role };
}

/* ---------------- handler ---------------- */

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const service = createServiceClient();

    const form = await req.formData().catch(() => null);
    if (!form) return jsonErr("Expected multipart/form-data", 400);

    const artifactId = String(form.get("artifact_id") || "").trim();
    if (!artifactId) return jsonErr("Missing artifact_id", 400);
    if (!isUuid(artifactId)) return jsonErr("Invalid artifact_id", 400);

    const files = form.getAll("files").filter(Boolean) as File[];
    if (!files.length) return jsonErr("No files provided (field name must be 'files')", 400);

    // Fetch artifact (we need project_id and current json)
    const { data: artifact, error: aErr } = await supabase
      .from("artifacts")
      .select("id, project_id, content_json, is_locked")
      .eq("id", artifactId)
      .single();

    if (aErr || !artifact) return jsonErr(aErr?.message || "Artifact not found", 404);
    if ((artifact as any).is_locked) return jsonErr("Artifact is locked", 409);

    const projectId = String((artifact as any).project_id || "").trim();
    if (!projectId) return jsonErr("Artifact missing project_id", 500);

    // Enforce auth + edit permission using user session client
    await requireAuthAndEdit(supabase, projectId);

    // Upload each file with service role
    const uploadedAt = nowIso();
    const newItems: any[] = [];

    for (const f of files) {
      const safeName = sanitizeFilename((f as any).name);
      const ts = Date.now();
      const path = `artifacts/${artifactId}/${ts}_${safeName}`;

      const ab = await f.arrayBuffer();
      const contentType = (f as any).type || "application/octet-stream";

      const { error: upErr } = await service.storage.from(BUCKET).upload(path, ab, {
        contentType,
        upsert: false,
      });

      if (upErr) {
        return jsonErr("Upload failed", 500, { message: upErr.message, file: safeName });
      }

      // Signed URL (works whether bucket is public or private)
      const { data: signed, error: sErr } = await service.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
      if (sErr || !signed?.signedUrl) {
        return jsonErr("Upload succeeded but failed to create signed URL", 500, { message: sErr?.message, path });
      }

      newItems.push({
        label: null,
        url: signed.signedUrl,
        // âœ… keep the storage path so we can delete later reliably
        path,
        filename: safeName,
        size_bytes: (f as any).size ?? null,
        uploaded_at: uploadedAt,
        bucket: BUCKET,
      });
    }

    // Merge into content_json.attachments.items
    const content = safeJson((artifact as any).content_json) || {};
    const next = { ...content };

    if (!next.attachments || typeof next.attachments !== "object") next.attachments = { items: [] };
    if (!Array.isArray(next.attachments.items)) next.attachments.items = [];

    next.attachments.items = [...next.attachments.items, ...newItems];

    const { error: saveErr } = await supabase
      .from("artifacts")
      .update({ content_json: next, last_saved_at: nowIso() })
      .eq("id", artifactId);

    if (saveErr) return jsonErr("Uploaded but failed to update artifact JSON", 500, { message: saveErr.message });

    return jsonOk({ items: newItems });
  } catch (e: any) {
    const msg = String(e?.message || e || "Server error");
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 500;
    return jsonErr(msg, status);
  }
}


