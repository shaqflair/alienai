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

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

async function requireAuthAndMembership(supabase: any, projectId: string) {
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

  return { userId: auth.user.id, role: String((mem as any).role ?? "viewer").toLowerCase() };
}

/* ---------------- handler ---------------- */

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const service = createServiceClient();

    const body = await req.json().catch(() => ({}));
    const artifactId = String(body?.artifact_id || "").trim();
    const path = String(body?.path || "").trim();
    const expiresIn = Number(body?.expires_in ?? 60 * 60 * 24 * 7);

    if (!artifactId) return jsonErr("Missing artifact_id", 400);
    if (!isUuid(artifactId)) return jsonErr("Invalid artifact_id", 400);
    if (!path) return jsonErr("Missing path", 400);

    const { data: artifact, error: aErr } = await supabase
      .from("artifacts")
      .select("id, project_id")
      .eq("id", artifactId)
      .single();

    if (aErr || !artifact) return jsonErr(aErr?.message || "Artifact not found", 404);

    const projectId = String((artifact as any).project_id || "").trim();
    if (!projectId) return jsonErr("Artifact missing project_id", 500);

    await requireAuthAndMembership(supabase, projectId);

    const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, Math.max(60, Math.min(expiresIn, 60 * 60 * 24 * 30)));
    if (error || !data?.signedUrl) return jsonErr(error?.message || "Failed to create signed URL", 500);

    return jsonOk({ url: data.signedUrl, path, bucket: BUCKET });
  } catch (e: any) {
    const msg = String(e?.message || e || "Server error");
    const status = msg === "Unauthorized" ? 401 : msg === "Not found" ? 404 : 500;
    return jsonErr(msg, status);
  }
}
