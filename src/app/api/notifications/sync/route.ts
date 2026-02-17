import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(payload: any, init?: ResponseInit) {
  const res = NextResponse.json(payload, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}

function ymdFromIso(iso: string | null | undefined) {
  const s = safeStr(iso).trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // store as date (YYYY-MM-DD) in UTC
  return d.toISOString().slice(0, 10);
}

type DueItem = {
  itemType: "artifact" | "milestone" | "work_item" | "raid" | "change";
  title: string;
  dueDate: string | null;
  status?: string | null;
  ownerLabel?: string | null;
  ownerEmail?: string | null;
  link?: string | null;
  meta?: any;
};

function sourceTypeFor(itemType: DueItem["itemType"]) {
  switch (itemType) {
    case "milestone":
      return "schedule_milestone";
    case "work_item":
      return "wbs_item";
    case "raid":
      return "raid_item";
    case "change":
      return "change_request";
    case "artifact":
    default:
      return "artifact";
  }
}

function sourceIdFor(x: DueItem): string | null {
  const m = x?.meta ?? {};
  // Prefer explicit ids by type
  if (x.itemType === "milestone") return safeStr(m?.milestoneId).trim() || null;
  if (x.itemType === "work_item") return safeStr(m?.wbsItemId).trim() || null;
  if (x.itemType === "raid") return safeStr(m?.raidId).trim() || null;
  if (x.itemType === "change") return safeStr(m?.changeId).trim() || null;
  if (x.itemType === "artifact") return safeStr(m?.artifactId).trim() || safeStr(m?.sourceArtifactId).trim() || null;

  return null;
}

function artifactIdFor(x: DueItem): string | null {
  const m = x?.meta ?? {};
  // Your ai/events already carries sourceArtifactId in many places
  const a =
    safeStr(m?.sourceArtifactId).trim() ||
    safeStr(m?.artifactId).trim() ||
    safeStr(m?.source_artifact_id).trim();
  return a || null;
}

function buildNotifTitle(x: DueItem) {
  const m = x?.meta ?? {};
  const code = safeStr(m?.project_code).trim();
  const kind =
    x.itemType === "work_item"
      ? "WBS"
      : x.itemType === "raid"
        ? "RAID"
        : x.itemType === "milestone"
          ? "Milestone"
          : x.itemType === "change"
            ? "Change"
            : "Artifact";

  const t = safeStr(x.title).trim() || kind;
  return code ? `${code} — ${kind}: ${t}` : `${kind}: ${t}`;
}

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr || !auth?.user) {
      return jsonNoStore({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const windowDays = clampInt((body as any)?.windowDays, 1, 90, 14);

    // Call your existing due engine (org-scoped)
    const baseUrl = new URL(req.url);
    const eventsUrl = new URL("/api/ai/events", baseUrl.origin);

    const resp = await fetch(eventsUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // forward cookies so /api/ai/events sees the user session
        cookie: req.headers.get("cookie") || "",
      },
      body: JSON.stringify({ eventType: "artifact_due", windowDays }),
      cache: "no-store",
    });

    const payload = await resp.json().catch(() => null);
    if (!payload?.ok) {
      return jsonNoStore(
        { ok: false, error: "Failed to load due events", meta: payload?.error || payload },
        { status: 500 }
      );
    }

    const dueSoon: DueItem[] = Array.isArray(payload?.ai?.dueSoon) ? payload.ai.dueSoon : [];

    const today = startOfUtcDay(new Date()).getTime();

    const svc = createServiceClient();

    // Build notification rows (deduped by user_id+source_type+source_id)
    const rows = dueSoon
      .map((x) => {
        const source_id = sourceIdFor(x);
        if (!source_id) return null;

        const dueYmd = ymdFromIso(x.dueDate);
        if (!dueYmd) return null;

        const dueMs = new Date(x.dueDate as string).getTime();
        const isOverdue = Number.isFinite(dueMs) ? dueMs < today : false;

        const bucket = isOverdue ? "overdue" : "due_soon";

        const project_id = safeStr(x?.meta?.project_id).trim() || null;
        const artifact_id = artifactIdFor(x);

        return {
          user_id: auth.user.id,
          project_id: project_id || null,
          artifact_id: artifact_id || null,

          // Keep enum stable — use existing type you already support
          type: "system",
          title: buildNotifTitle(x),
          body: `Due: ${dueYmd}`,
          link: safeStr(x.link).trim() || null,
          is_read: false,
          actor_user_id: auth.user.id,
          metadata: {
            status: x.status ?? null,
            itemType: x.itemType,
          },

          // New fields you added
          bucket,
          source_type: sourceTypeFor(x.itemType),
          source_id,
          due_date: dueYmd,
        };
      })
      .filter(Boolean) as any[];

    if (!rows.length) {
      return jsonNoStore({ ok: true, windowDays, synced: 0, overdue: 0, due_soon: 0 });
    }

    const { error: upErr } = await svc
      .from("notifications")
      .upsert(rows, { onConflict: "user_id,source_type,source_id" });

    if (upErr) {
      return jsonNoStore({ ok: false, error: "Upsert failed", meta: upErr.message }, { status: 500 });
    }

    const overdue = rows.filter((r) => r.bucket === "overdue").length;
    const due_soon = rows.filter((r) => r.bucket === "due_soon").length;

    return jsonNoStore({ ok: true, windowDays, synced: rows.length, overdue, due_soon });
  } catch (e: any) {
    return jsonNoStore(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

