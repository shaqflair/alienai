import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Severity = "info" | "warning" | "critical";
type Status = "open" | "investigating" | "resolved" | "ignored";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeTrim(x: unknown, max = 5000): string {
  return safeStr(x).trim().slice(0, max);
}

function normalizeSeverity(x: unknown): Severity {
  const s = safeTrim(x, 32).toLowerCase();
  if (s === "info" || s === "warning" || s === "critical") return s;
  return "warning";
}

function normalizeStatus(x: unknown): Status {
  const s = safeTrim(x, 32).toLowerCase();
  if (s === "open" || s === "investigating" || s === "resolved" || s === "ignored") return s;
  return "open";
}

function safeJsonObject(x: unknown): Record<string, any> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  try {
    return JSON.parse(JSON.stringify(x));
  } catch {
    return {};
  }
}

function normalizeMessageForFingerprint(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/g, ":uuid")
    .replace(/\b\d{2,}\b/g, ":n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function buildFingerprint(input: {
  event_type: string;
  source: string;
  route: string;
  title: string;
  message: string;
}): string {
  return [
    normalizeMessageForFingerprint(input.event_type),
    normalizeMessageForFingerprint(input.source),
    normalizeMessageForFingerprint(input.route),
    normalizeMessageForFingerprint(input.title),
    normalizeMessageForFingerprint(input.message),
  ].join("|");
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

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user?.id) {
      return jsonErr("Not authenticated", 401, { authErr: authErr?.message });
    }

    const body = await req.json().catch(() => ({}));

    const event_type = safeTrim(body?.event_type, 100);
    const severity = normalizeSeverity(body?.severity);
    const source = safeTrim(body?.source, 200);
    const title = safeTrim(body?.title, 200);
    const message = safeTrim(body?.message, 4000) || null;
    const route = safeTrim(body?.route, 500) || null;
    const project_id = safeTrim(body?.project_id, 100) || null;
    const artifact_id = safeTrim(body?.artifact_id, 100) || null;
    const status = normalizeStatus(body?.status);
    const metadata = safeJsonObject(body?.metadata);

    if (!event_type) return jsonErr("event_type is required", 400);
    if (!source) return jsonErr("source is required", 400);
    if (!title) return jsonErr("title is required", 400);

    const fingerprint =
      safeTrim(body?.fingerprint, 500) ||
      buildFingerprint({
        event_type,
        source,
        route: route || "",
        title,
        message: message || "",
      });

    const { data: existing, error: existingErr } = await supabase
      .from("platform_events")
      .select("id, occurrence_count, status")
      .eq("fingerprint", fingerprint)
      .in("status", ["open", "investigating"])
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingErr) {
      return jsonErr("Failed to check existing platform event", 500, { detail: existingErr.message });
    }

    if (existing?.id) {
      const nextCount = Number(existing.occurrence_count || 0) + 1;

      const { error: updateErr } = await supabase
        .from("platform_events")
        .update({
          last_seen_at: new Date().toISOString(),
          occurrence_count: nextCount,
          severity,
          message,
          route,
          project_id,
          artifact_id,
          metadata,
        })
        .eq("id", existing.id);

      if (updateErr) {
        return jsonErr("Failed to update platform event", 500, { detail: updateErr.message });
      }

      return jsonOk({
        action: "updated",
        id: existing.id,
        occurrence_count: nextCount,
        fingerprint,
      });
    }

    const insertRow = {
      event_type,
      severity,
      source,
      title,
      message,
      route,
      project_id,
      artifact_id,
      metadata,
      fingerprint,
      status,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      occurrence_count: 1,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("platform_events")
      .insert(insertRow)
      .select("id")
      .single();

    if (insertErr) {
      return jsonErr("Failed to insert platform event", 500, { detail: insertErr.message });
    }

    return jsonOk({
      action: "created",
      id: inserted?.id ?? null,
      occurrence_count: 1,
      fingerprint,
    });
  } catch (e: any) {
    return jsonErr("Platform event logging failed", 500, {
      detail: safeStr(e?.message || e),
    });
  }
}