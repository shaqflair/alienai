//src/app/api/organisations/create/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function ok(data: any, status = 200) {
  return noStoreJson({ ok: true, ...data }, status);
}

function err(error: string, status = 400) {
  return noStoreJson({ ok: false, error }, status);
}

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

function sbErrText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/* ---------------- handler ---------------- */

export async function POST(req: Request) {
  const sb = await createClient();

  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return err(sbErrText(authErr), 401);
  if (!auth?.user) return err("Not authenticated", 401);

  const body = await req.json().catch(() => ({}));
  const name = safeStr(body?.name).trim();
  if (!name) return err("Organisation name required", 400);

  // 1) create org
  const { data: org, error: orgErr } = await sb
    .from("organisations")
    .insert({ name, created_by: auth.user.id })
    .select("id, name")
    .single();

  if (orgErr) return err(sbErrText(orgErr), 400);
  if (!org?.id) return err("Failed to create organisation", 400);

  // 2) create membership for creator (owner)
  const { error: memErr } = await sb.from("organisation_members").insert({
    organisation_id: org.id,
    user_id: auth.user.id,
    role: "owner",
  });

  if (memErr) {
    // Best-effort cleanup to avoid leaving an orphan org
    await sb.from("organisations").delete().eq("id", org.id);

    return err(
      `Organisation created but failed to create owner membership: ${sbErrText(memErr)}`,
      400
    );
  }

  return ok({ organisation: org }, 201);
}