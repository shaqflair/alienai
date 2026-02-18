// src/app/api/notifications/generate/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function err(message: string, status = 400, meta?: any) {
  const res = NextResponse.json(
    { ok: false, error: message, ...(meta ? { meta } : {}) },
    { status }
  );
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

/* ---------------- utils ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function parseIntClamped(x: string | null, def: number, min: number, max: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function todayYmdUtc() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysYmd(ymd: string, days: number) {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isDoneStatus(s: any) {
  const v = safeStr(s).trim().toLowerCase();
  return v === "done" || v === "completed" || v === "closed" || v === "complete";
}

function isClosedRaidStatus(s: any) {
  const v = safeStr(s).trim().toLowerCase();
  return v === "closed" || v === "invalid";
}

/**
 * Your DB uses an enum for notifications.type.
 * We don t need to import the enum type in TS   just ensure we only emit valid labels.
 */
type NotifRow = {
  user_id: string;
  project_id: string;
  artifact_id?: string | null;

  type: string; // enum label
  title: string;
  body?: string | null;
  link?: string | null;

  is_read: boolean;

  metadata: any;

  source_type: string;
  source_id: string;

  due_date?: string | null; // DATE column accepts "YYYY-MM-DD"
  bucket?: string | null;
};

const GENERATED_SOURCE_TYPES = ["schedule_milestone", "raid_item", "wbs_item"] as const;
const GENERATED_BUCKETS = ["overdue", "due_soon"] as const;

async function deleteGeneratedForUser(svc: any, userId: string) {
  // Delete only what this engine owns (buckets + known source_types)
  const { count, error } = await svc
    .from("notifications")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .in("bucket", [...GENERATED_BUCKETS])
    .in("source_type", [...GENERATED_SOURCE_TYPES]);

  if (error) throw error;
  return Number(count || 0);
}

async function insertBatch(svc: any, rows: NotifRow[]) {
  if (!rows.length) return 0;

  // Chunk inserts to avoid request limits
  const chunkSize = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const { error } = await svc.from("notifications").insert(chunk);
    if (error) throw error;

    inserted += chunk.length;
  }

  return inserted;
}

async function getProjectIdsForUser(params: { svc: any; userId: string }) {
  const { svc, userId } = params;

  const { data, error } = await svc
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId)
    .is("removed_at", null);

  if (error) throw error;

  const projectIds = Array.from(
    new Set((data || []).map((r: any) => safeStr(r?.project_id).trim()).filter(Boolean))
  );

  return { projectIds, meta: { via: "project_members_only", projectCount: projectIds.length } };
}

async function getProjectMetaMap(svc: any, projectIds: string[]) {
  const map = new Map<string, { project_code: string | null; project_name: string | null }>();
  if (!projectIds.length) return map;

  // Note: your "human id" is projects.project_code
  const { data, error } = await svc
    .from("projects")
    .select("id, project_code, name")
    .in("id", projectIds);

  if (error) throw error;

  for (const p of data || []) {
    const id = safeStr((p as any)?.id).trim();
    if (!id) continue;
    map.set(id, {
      project_code: (p as any)?.project_code ?? null,
      project_name: (p as any)?.name ?? null,
    });
  }

  return map;
}

async function generateForUser(params: { svc: any; userId: string; windowDays: number }) {
  const { svc, userId, windowDays } = params;

  const { projectIds, meta: scopeMeta } = await getProjectIdsForUser({ svc, userId });

  const today = todayYmdUtc();
  const soonCutoff = addDaysYmd(today, windowDays);

  if (!projectIds.length) {
    const deleted = await deleteGeneratedForUser(svc, userId);
    return { userId, generated: 0, deleted, meta: { projectCount: 0, windowDays, scopeMeta } };
  }

  // ? One lookup: project code + name for tiles
  const projectMeta = await getProjectMetaMap(svc, projectIds);
  const proj = (projectId: string) =>
    projectMeta.get(projectId) ?? { project_code: null, project_name: null };

  const rows: NotifRow[] = [];

  /* ---- Schedule milestones ---- */
  const { data: milestones, error: msErr } = await svc
    .from("schedule_milestones")
    .select("id,project_id,milestone_name,end_date,status")
    .in("project_id", projectIds)
    .not("end_date", "is", null);

  if (msErr) throw msErr;

  for (const m of milestones || []) {
    const id = safeStr(m?.id).trim();
    const projectId = safeStr(m?.project_id).trim();
    const end = safeStr(m?.end_date).slice(0, 10);
    if (!id || !projectId || !end) continue;
    if (isDoneStatus(m?.status)) continue;

    const name = safeStr(m?.milestone_name).trim() || "Milestone";
    const pm = proj(projectId);

    if (end < today) {
      rows.push({
        user_id: userId,
        project_id: projectId,
        type: "milestone_overdue",
        title: `Milestone overdue: ${name}`,
        body: `Was due ${end}`,
        link: `/projects/${projectId}/schedule`,
        is_read: false,
        metadata: {
          severity: "high",
          kind: "schedule_milestone",
          due_date: end,
          project_code: pm.project_code,
          project_name: pm.project_name,
        },
        source_type: "schedule_milestone",
        source_id: id,
        due_date: end,
        bucket: "overdue",
      });
    } else if (end >= today && end <= soonCutoff) {
      rows.push({
        user_id: userId,
        project_id: projectId,
        type: "milestone_due",
        title: `Milestone due soon: ${name}`,
        body: `Due ${end}`,
        link: `/projects/${projectId}/schedule`,
        is_read: false,
        metadata: {
          severity: "medium",
          kind: "schedule_milestone",
          due_date: end,
          project_code: pm.project_code,
          project_name: pm.project_name,
        },
        source_type: "schedule_milestone",
        source_id: id,
        due_date: end,
        bucket: "due_soon",
      });
    }
  }

  /* ---- RAID items ---- */
  const { data: raid, error: raidErr } = await svc
    .from("raid_items")
    .select("id,project_id,type,title,description,due_date,status,public_id")
    .in("project_id", projectIds)
    .not("due_date", "is", null);

  if (raidErr) throw raidErr;

  for (const r of raid || []) {
    const id = safeStr(r?.id).trim();
    const projectId = safeStr(r?.project_id).trim();
    const due = safeStr(r?.due_date).slice(0, 10);
    if (!id || !projectId || !due) continue;
    if (isClosedRaidStatus(r?.status)) continue;

    const kind = safeStr(r?.type).trim() || "RAID";
    const label =
      safeStr(r?.title).trim() ||
      safeStr(r?.public_id).trim() ||
      safeStr(r?.description).trim().slice(0, 60) ||
      "RAID item";

    const pm = proj(projectId);

    if (due < today) {
      rows.push({
        user_id: userId,
        project_id: projectId,
        type: "raid_overdue",
        title: `${kind} overdue: ${label}`,
        body: `Was due ${due}`,
        link: `/projects/${projectId}/raid`,
        is_read: false,
        metadata: {
          severity: "high",
          kind: "raid_item",
          raid_type: kind,
          public_id: r?.public_id ?? null,
          due_date: due,
          project_code: pm.project_code,
          project_name: pm.project_name,
        },
        source_type: "raid_item",
        source_id: id,
        due_date: due,
        bucket: "overdue",
      });
    } else if (due >= today && due <= soonCutoff) {
      rows.push({
        user_id: userId,
        project_id: projectId,
        type: "raid_due",
        title: `${kind} due soon: ${label}`,
        body: `Due ${due}`,
        link: `/projects/${projectId}/raid`,
        is_read: false,
        metadata: {
          severity: "medium",
          kind: "raid_item",
          raid_type: kind,
          public_id: r?.public_id ?? null,
          due_date: due,
          project_code: pm.project_code,
          project_name: pm.project_name,
        },
        source_type: "raid_item",
        source_id: id,
        due_date: due,
        bucket: "due_soon",
      });
    }
  }

  /* ---- WBS items ---- */
  const { data: wbs, error: wbsErr } = await svc
    .from("wbs_items")
    .select("id,project_id,name,due_date,status")
    .in("project_id", projectIds)
    .not("due_date", "is", null);

  if (wbsErr) throw wbsErr;

  for (const w of wbs || []) {
    const id = safeStr(w?.id).trim();
    const projectId = safeStr(w?.project_id).trim();
    const due = safeStr(w?.due_date).slice(0, 10);
    if (!id || !projectId || !due) continue;
    if (isDoneStatus(w?.status)) continue;

    const name = safeStr(w?.name).trim() || "Work item";
    const pm = proj(projectId);

    if (due < today) {
      rows.push({
        user_id: userId,
        project_id: projectId,
        type: "task_overdue",
        title: `Task overdue: ${name}`,
        body: `Was due ${due}`,
        link: `/projects/${projectId}/wbs`,
        is_read: false,
        metadata: {
          severity: "high",
          kind: "wbs_item",
          due_date: due,
          project_code: pm.project_code,
          project_name: pm.project_name,
        },
        source_type: "wbs_item",
        source_id: id,
        due_date: due,
        bucket: "overdue",
      });
    } else if (due >= today && due <= soonCutoff) {
      rows.push({
        user_id: userId,
        project_id: projectId,
        type: "task_due",
        title: `Task due soon: ${name}`,
        body: `Due ${due}`,
        link: `/projects/${projectId}/wbs`,
        is_read: false,
        metadata: {
          severity: "medium",
          kind: "wbs_item",
          due_date: due,
          project_code: pm.project_code,
          project_name: pm.project_name,
        },
        source_type: "wbs_item",
        source_id: id,
        due_date: due,
        bucket: "due_soon",
      });
    }
  }

  // ? No upsert. We do a clean regen each run.
  const deleted = await deleteGeneratedForUser(svc, userId);
  const generated = await insertBatch(svc, rows);

  return {
    userId,
    generated,
    deleted,
    meta: {
      projectCount: projectIds.length,
      windowDays,
      scopeMeta,
      rows: rows.length,
      projectsWithMeta: projectMeta.size,
    },
  };
}

/* ---------------- auth / triggers ---------------- */

function isDevTrigger(req: Request) {
  const url = new URL(req.url);
  const dev = safeStr(url.searchParams.get("dev")).trim() === "1";
  return dev && process.env.NODE_ENV !== "production";
}

function checkCronSecret(req: Request) {
  const secret = safeStr(process.env.CRON_SECRET).trim();
  if (!secret) return { ok: false, reason: "CRON_SECRET not set" };

  const url = new URL(req.url);
  const got =
    safeStr(req.headers.get("x-cron-secret")).trim() ||
    safeStr(url.searchParams.get("secret")).trim();

  return { ok: got === secret, reason: got === secret ? "" : "Forbidden" };
}

/* ---------------- handlers ---------------- */

export async function GET(req: Request) {
  try {
    if (!isDevTrigger(req)) return err("Forbidden", 403, { hint: "Use ?dev=1 in non-production only" });

    const url = new URL(req.url);
    const windowDays = parseIntClamped(url.searchParams.get("days"), 14, 1, 60);

    const svc = createServiceClient();

    const { data: users, error: uErr } = await svc
      .from("project_members")
      .select("user_id")
      .is("removed_at", null);
    if (uErr) return err(uErr.message, 500);

    // ✅ FIX: removed extra closing parenthesis
    const userIds = Array.from(
      new Set((users || []).map((r: any) => safeStr(r?.user_id).trim()).filter(Boolean))
    );

    let totalGenerated = 0;
    let totalDeleted = 0;
    const perUser: any[] = [];

    for (const userId of userIds) {
      try {
        const r = await generateForUser({ svc, userId, windowDays });
        totalGenerated += Number(r.generated || 0);
        totalDeleted += Number(r.deleted || 0);
        perUser.push(r);
      } catch (e: any) {
        perUser.push({ userId, generated: 0, deleted: 0, error: String(e?.message || "Failed") });
      }
    }

    return ok({
      mode: "dev",
      windowDays,
      users: userIds.length,
      generated: totalGenerated,
      deleted: totalDeleted,
      results: perUser.slice(0, 50),
    });
  } catch (e: any) {
    return err(String(e?.message || "Failed"), 500);
  }
}

export async function POST(req: Request) {
  try {
    const gate = checkCronSecret(req);
    if (!gate.ok) return err(gate.reason, 403);

    const url = new URL(req.url);
    const windowDays = parseIntClamped(url.searchParams.get("days"), 14, 1, 60);

    const svc = createServiceClient();

    const { data: users, error: uErr } = await svc
      .from("project_members")
      .select("user_id")
      .is("removed_at", null);
    if (uErr) return err(uErr.message, 500);

    // ✅ FIX: removed extra closing parenthesis
    const userIds = Array.from(
      new Set((users || []).map((r: any) => safeStr(r?.user_id).trim()).filter(Boolean))
    );

    let totalGenerated = 0;
    let totalDeleted = 0;
    const perUser: any[] = [];

    for (const userId of userIds) {
      try {
        const r = await generateForUser({ svc, userId, windowDays });
        totalGenerated += Number(r.generated || 0);
        totalDeleted += Number(r.deleted || 0);
        perUser.push(r);
      } catch (e: any) {
        perUser.push({ userId, generated: 0, deleted: 0, error: String(e?.message || "Failed") });
      }
    }

    return ok({
      mode: "cron",
      windowDays,
      users: userIds.length,
      generated: totalGenerated,
      deleted: totalDeleted,
      results: perUser.slice(0, 50),
    });
  } catch (e: any) {
    return err(String(e?.message || "Failed"), 500);
  }
}
