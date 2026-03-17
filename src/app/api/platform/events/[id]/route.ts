import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Status = "open" | "investigating" | "resolved" | "ignored";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function normalizeStatus(x: unknown): Status | null {
  const s = safeStr(x).trim().toLowerCase();
  if (s === "open" || s === "investigating" || s === "resolved" || s === "ignored") return s;
  return null;
}

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

async function readId(ctx: any): Promise<string> {
  try {
    const p = await ctx?.params;
    return safeStr(p?.id).trim();
  } catch {
    return "";
  }
}

export async function PATCH(req: Request, ctx: any) {
  try {
    const id = await readId(ctx);
    if (!id) return jsonErr("Missing event id", 400);

    const supabase = await createClient();

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user?.id) {
      return jsonErr("Not authenticated", 401, { authErr: authErr?.message });
    }

    const body = await req.json().catch(() => ({}));
    const status = normalizeStatus(body?.status);
    if (!status) {
      return jsonErr("Invalid status", 400, {
        allowed: ["open", "investigating", "resolved", "ignored"],
      });
    }

    const metadataPatch =
      body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : null;

    const { data: existing, error: readErr } = await supabase
      .from("platform_events")
      .select("id, metadata")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return jsonErr("Failed to load platform event", 500, { detail: readErr.message });
    if (!existing?.id) return jsonErr("Platform event not found", 404);

    const nextMetadata = {
      ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
      ...(metadataPatch || {}),
      status_updated_at: new Date().toISOString(),
      status_updated_by: user.id,
    };

    const { data, error } = await supabase
      .from("platform_events")
      .update({
        status,
        metadata: nextMetadata,
      })
      .eq("id", id)
      .select("id,status,updated_at,last_seen_at,metadata")
      .single();

    if (error) {
      return jsonErr("Failed to update platform event", 500, { detail: error.message });
    }

    return jsonOk({ item: data });
  } catch (e: any) {
    return jsonErr("Platform event status update failed", 500, {
      detail: safeStr(e?.message || e),
    });
  }
}