import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function extFromMime(mime: string) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("svg")) return "svg";
  if (m.includes("webp")) return "webp";
  return "png";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id?: string }>}
) {
  const supabase = await createClient();

  const projectId = safeParam((await params)?.id);
  if (!projectId || projectId === "undefined") {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) {
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }
  if (!auth?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Member gate
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
  if (!mem) return NextResponse.json({ error: "Not a project member" }, { status: 403 });

  // Only owner/editor can change branding
  const role = String((mem as any)?.role ?? "viewer").toLowerCase();
  if (!(role === "owner" || role === "editor")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  // Basic guardrails
  const maxBytes = 2 * 1024 * 1024; // 2MB
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "Logo is too large (max 2MB)" }, { status: 400 });
  }

  const mime = String(file.type || "");
  if (!mime.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }

  const ext = extFromMime(mime);
  const path = `${projectId}/client-logo.${ext}`;

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Upload (upsert so re-upload replaces)
  const { error: upErr } = await supabase.storage
    .from("project-logos")
    .upload(path, bytes, {
      contentType: mime || "image/png",
      upsert: true,
      cacheControl: "3600",
    });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Public URL
  const { data: pub } = supabase.storage.from("project-logos").getPublicUrl(path);
  const publicUrl = pub?.publicUrl ?? null;

  if (!publicUrl) {
    return NextResponse.json({ error: "Could not create public URL" }, { status: 500 });
  }

  // Save into projects.client_logo_url
  const { data: saved, error: saveErr } = await supabase
    .from("projects")
    .update({ client_logo_url: publicUrl })
    .eq("id", projectId)
    .select("id")
    .maybeSingle();

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });
  if (!saved) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  return NextResponse.json({ publicUrl }, { status: 200 });
}

