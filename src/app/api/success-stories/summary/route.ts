// src/app/api/success-stories/summary/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

/* ---------------- utils ---------------- */

function clampDays(x: string | null) {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : 30;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function asNum(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** ✅ UK display date (dd/mm/yyyy) */
function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  if (!s) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (!yyyy || !mm || !dd) return null;
    return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yyyy)}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/** Keep stable sort key for timestamps */
function isoSortKey(x: any): string {
  if (!x) return "";
  const s = String(x).trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

type Win = {
  id: string;
  category: "Delivery" | "Risk" | "Governance" | "Learning" | string;
  title: string;
  summary: string;

  happened_at: string;
  happened_at_uk?: string | null;

  project_id?: string | null;
  project_title?: string | null;
  href?: string | null;
};

function pointsFor(breakdown: {
  milestones_done: number;
  wbs_done: number;
  raid_resolved: number;
  changes_delivered: number;
  lessons_positive: number;
}) {
  const w = {
    milestones_done: 3,
    wbs_done: 1,
    raid_resolved: 2,
    changes_delivered: 2,
    lessons_positive: 1,
  };
  return (
    breakdown.milestones_done * w.milestones_done +
    breakdown.wbs_done * w.wbs_done +
    breakdown.raid_resolved * w.raid_resolved +
    breakdown.changes_delivered * w.changes_delivered +
    breakdown.lessons_positive * w.lessons_positive
  );
}

function scoreFromPoints(points: number, days: number) {
  const target = Math.max(6, Math.round((20 * days) / 30));
  const raw = Math.round((points / target) * 100);
  return Math.max(0, Math.min(100, raw));
}

/* ---------------- org scope helpers ---------------- */

async function requireUser(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function resolveActiveOrgId(supabase: any, userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  const cookieOrgId = safeStr(cookieStore.get("active_org_id")?.value).trim();

  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id, created_at, removed_at")
    .eq("user_id", userId)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);

  const orgIds = (Array.isArray(data) ? data : [])
    .map((r: any) => safeStr(r?.organisation_id).trim())
    .filter(Boolean);

  if (!orgIds.length) return null;

  const set = new Set(orgIds);
  if (cookieOrgId && looksLikeUuid(cookieOrgId) && set.has(cookieOrgId)) return cookieOrgId;

  return orgIds[0];
}

type AllowedProject = { id: string; title: string; project_code: string | null };

async function loadOrgProjects(supabase: any, orgId: string): Promise<AllowedProject[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id,title,project_code,deleted_at")
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data : [])
    .map((p: any) => ({
      id: safeStr(p?.id).trim(),
      title: safeStr(p?.title).trim() || "Project",
      project_code: safeStr(p?.project_code).trim() || null,
    }))
    .filter((p: any) => Boolean(p.id));
}

function projectRouteId(p: AllowedProject | undefined | null) {
  return safeStr(p?.project_code).trim() || safeStr(p?.id).trim();
}

function hrefFor(kind: "milestones" | "raid" | "change" | "lessons" | "wbs", projectIdForRoute: string) {
  if (!projectIdForRoute) return null;
  if (kind === "wbs") return `/projects/${projectIdForRoute}/wbs`;
  if (kind === "milestones") return `/projects/${projectIdForRoute}/schedule`;
  if (kind === "raid") return `/projects/${projectIdForRoute}/raid`;

  // ✅ Project change board route (NOT /change)
  if (kind === "change") return `/projects/${projectIdForRoute}/change`;

  if (kind === "lessons") return `/projects/${projectIdForRoute}/lessons`;
  return `/projects/${projectIdForRoute}`;
}

// ... rest of your file unchanged (computeSummary + GET) ...