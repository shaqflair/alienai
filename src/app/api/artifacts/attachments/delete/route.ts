import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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

function looksLikeStoragePath(p: string) {
  return p.startsWith("artifacts/") || p.startsWith("projects/") || p.includes("/");
}

function tryDerivePathFromUrl(url: string): string | null {
  // Supports:
  // - /storage/v1/object/sign/<bucket>/<path>?token=...
  // - /storage/v1/object/public/<bucket>/<path>
  // - /storage/v1/object/<bucket>/<path>
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);

    // find bucket segment and join remainder as path
    const signIdx = parts.indexOf("sign");
    if (signIdx !== -1 && parts[signIdx + 1] && parts[signIdx + 2]) {
      const bucket = parts[signIdx + 1];
      const path = parts.slice(signIdx + 2).join("/");
      if (bucket && path) return decodeURIComponent(path);
    }

    const publicIdx = parts.indexOf("public");
    if (publicIdx !== -1 && parts[publicIdx + 1] && parts[publicIdx + 2]) {
      const bucket = parts[publicIdx + 1];
      const path = parts.slice(publicIdx + 2).join("/");
      if (bucket && path) return decodeURIComponent(path);
    }

    const objectIdx = parts.indexOf("object");
    if (objectIdx !== -1 && parts[objectIdx + 1] && parts[objectIdx + 2]) {
      const bucket = parts[objectIdx + 1];
      const path = parts.slice(objectIdx + 2).join("/");
      if (bucket && path) return decodeURIComponent(path);
    }

    return null;
  } catch {
    return null;
  }
}

/* ---------------- handler ---------------- */

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const service = createServiceClient();

    const body = await req.json().catch(() => ({}));
    const artifactId = String(body?.artifact_id || "").trim();
    if (!artifactId) return jsonErr("Missing artifact_id", 400);
    if (!isUuid(artifactId)) return jsonErr("Invalid artifact_id", 400);

    const pathInput = String(body?.path || "").trim();
    const urlInput = String(body?.url || "").trim();
    const filenameInput = String(body?.filename || "").trim();

    if (!pathInput && !urlInput && !filenameInput) {
      return jsonErr("Provide one of: path, url, filename", 400);
    }

    const { data: artifact, error: aErr } = await supabase
      .from("artifacts")
      .select("id, project_id, content_json, is_locked")
      .eq("id", artifactId)
      .single();

    if (aErr || !artifact) return jsonErr(aErr?.message || "Artifact not found", 404);
    if ((artifact as any).is_locked) return jsonErr("Artifact is locked", 409);

    const projectId = String((artifact as any).project_id || "").trim();
    if (!projectId) return jsonErr("Artifact missing project_id", 500);

    await requireAuthAndEdit(supabase, projectId);

    const content = safeJson((artifact as any).content_json) || {};
    const items: any[] = Array.isArray(content?.attachments?.items) ? content.attachments.items : [];

    // Determine target path
    let targetPath: string | null = null;

    if (pathInput && looksLikeStoragePath(pathInput)) targetPath = pathInput;
    if (!targetPath && urlInput) targetPath = tryDerivePathFromUrl(urlInput);

    // If still no path, try to find by filename in stored items
    if (!targetPath && filenameInput) {
      const found = items.find((it) => String(it?.filename || "").trim() === filenameInput);
      targetPath = String(found?.path || "") || (found?.url ? tryDerivePathFromUrl(String(found.url)) : null);
    }

    // If still no path, try match by url
    if (!targetPath && urlInput) {
      const found = items.find((it) => String(it?.url || "") === urlInput);
      targetPath = String(found?.path || "") || (found?.url ? tryDerivePathFromUrl(String(found.url)) : null);
    }

    // Remove from storage if we got a path
    if (targetPath) {
      const { error: rmErr } = await service.storage.from(BUCKET).remove([targetPath]);
      if (rmErr) {
        return jsonErr("Failed to delete from storage", 500, { message: rmErr.message, path: targetPath });
      }
    }

    // Remove from JSON list
    const nextItems = items.filter((it) => {
      const itPath = String(it?.path || "").trim() || (it?.url ? tryDerivePathFromUrl(String(it.url)) : "");
      const itUrl = String(it?.url || "").trim();
      const itFn = String(it?.filename || "").trim();

      if (targetPath && itPath === targetPath) return false;
      if (urlInput && itUrl === urlInput) return false;
      if (filenameInput && itFn === filenameInput) return false;

      return true;
    });

    const next = { ...content };
    if (!next.attachments || typeof next.attachments !== "object") next.attachments = { items: [] };
    next.attachments.items = nextItems;

    const { error: saveErr } = await supabase
      .from("artifacts")
      .update({ content_json: next, last_saved_at: nowIso() })
      .eq("id", artifactId);

    if (saveErr) return jsonErr("Deleted from storage but failed to update artifact JSON", 500, { message: saveErr.message });

    return jsonOk({ removed: true, path: targetPath || null, remaining: nextItems.length });
  } catch (e: any) {
    const msg = String(e?.message || e || "Server error");
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 500;
    return jsonErr(msg, status);
  }
}
