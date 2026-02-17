// src/app/api/change/portfolio/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

/* ---------------- utils ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampLimit(x: string | null) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 50;
  return Math.max(10, Math.min(200, Math.floor(n)));
}

function parseCsv(x: string | null): string[] {
  const s = safeStr(x).trim();
  if (!s) return [];
  return s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** ISO timestamp N days ago */
function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** âœ… UK display dd/mm/yyyy (or dd/mm/yyyy hh:mm) */
function fmtUkDateTime(x: any, withTime = false): string | null {
  if (!x) return null;
  const s = String(x).trim();
  if (!s) return null;

  // support date-only ISO
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
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

  if (!withTime) return `${dd}/${mm}/${yyyy}`;

  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function normalizePrioritySet(prios: string[]) {
  const set = new Set<string>();
  for (const p of prios) {
    const v = p.trim().toLowerCase();
    if (!v) continue;
    if (v === "high") set.add("High");
    else if (v === "critical") set.add("Critical");
    else if (v === "medium") set.add("Medium");
    else if (v === "low") set.add("Low");
    else set.add(p);
  }
  return Array.from(set);
}

function normalizeStatusSet(xs: string[]) {
  // supports either governance status or delivery_status (your board lanes)
  const allowed = new Set([
    "new",
    "analysis",
    "review",
    "in_progress",
    "implemented",
    "closed",
    "draft",
    "approved",
    "rejected",
  ]);

  const out: string[] = [];
  for (const s of xs) {
    const v = s.trim().toLowerCase();
    if (!v) continue;
    if (allowed.has(v)) out.push(v);
  }
  return out;
}

/**
 * Cursor format: `${created_at}|${id}`
 * Seek on (created_at desc, id desc)
 */
function parseCursor(cursor: string | null) {
  const s = safeStr(cursor).trim();
  if (!s) return null;
  const [created_at, id] = s.split("|");
  if (!created_at || !id) return null;
  return { created_at, id };
}

/* ---------------- handler ---------------- */

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const url = new URL(req.url);

    const q = safeStr(url.searchParams.get("q")).trim();
    const limit = clampLimit(url.searchParams.get("limit"));
    const cursor = parseCursor(url.searchParams.get("cursor"));

    const priorityCsv = normalizePrioritySet(parseCsv(url.searchParams.get("priority")));
    const statusCsv = normalizeStatusSet(parseCsv(url.searchParams.get("status")));
    const stale = safeStr(url.searchParams.get("stale")).trim() === "1";

    const staleDays = (() => {
      const n = Number(url.searchParams.get("staleDays"));
      return Number.isFinite(n) ? Math.max(7, Math.min(120, Math.floor(n))) : 14;
    })();

    // memberships
    const { data: pmRows, error: pmErr } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", auth.user.id)
      .is("removed_at", null);

    if (pmErr) return jsonErr(pmErr.message, 400);

    const projectIds = (pmRows || [])
      .map((r: any) => safeStr(r?.project_id).trim())
      .filter(Boolean);

    if (!projectIds.length) {
      return jsonOk({ items: [], nextCursor: null, facets: { priorities: [], statuses: [] } });
    }

    let query = supabase
      .from("change_requests")
      .select(
        `
        id,
        public_id,
        seq,
        project_id,
        artifact_id,
        title,
        description,
        status,
        delivery_status,
        priority,
        decision_status,
        decision_at,
        updated_at,
        created_at,
        requester_name,
        requester_id,
        projects:projects(id,title,project_code)
      `
      )
      .in("project_id", projectIds);

    // text search (cheap)
    if (q) {
      const qq = q.replace(/[%_]/g, "\\$&");
      query = query.or(
        [
          `title.ilike.%${qq}%`,
          `description.ilike.%${qq}%`,
          `public_id.ilike.%${qq}%`,
          `priority.ilike.%${qq}%`,
        ].join(",")
      );
    }

    if (priorityCsv.length) {
      query = query.in("priority", priorityCsv);
    }

    // status filter (either status or delivery_status)
    if (statusCsv.length) {
      const list = statusCsv.map((s) => `"${s.replace(/"/g, "")}"`).join(",");
      query = query.or([`status.in.(${list})`, `delivery_status.in.(${list})`].join(","));
    }

    // stale filter (older than N days)
    if (stale) {
      query = query.lt("updated_at", daysAgoIso(staleDays));
      // avoid closed clutter
      query = query.not("delivery_status", "ilike", "%closed%");
      query = query.not("status", "ilike", "%closed%");
    }

    // cursor seek
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
      );
    }

    query = query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);

    const { data, error } = await query;
    if (error) return jsonErr(error.message, 500);

    const rows = Array.isArray(data) ? data : [];

    // âœ… Add UK date display fields (keep raw ISO too)
    const items = rows.map((r: any) => {
      const created_at = r?.created_at ?? null;
      const updated_at = r?.updated_at ?? null;
      const decision_at = r?.decision_at ?? null;

      return {
        ...r,
        created_at,
        updated_at,
        decision_at,
        created_at_uk: fmtUkDateTime(created_at, true),
        updated_at_uk: fmtUkDateTime(updated_at, true),
        decision_at_uk: fmtUkDateTime(decision_at, true),

        // handy project id for tiles (you requested this elsewhere)
        project_code: r?.projects?.project_code ?? null,
        project_title: r?.projects?.title ?? null,
      };
    });

    const last = items[items.length - 1];
    const nextCursor = last?.created_at && last?.id ? `${last.created_at}|${last.id}` : null;

    // facets (lightweight)
    const priorities = Array.from(new Set(items.map((x: any) => safeStr(x?.priority)).filter(Boolean)));
    const statuses = Array.from(
      new Set(items.map((x: any) => safeStr(x?.delivery_status || x?.status)).filter(Boolean))
    );

    return jsonOk({
      items,
      nextCursor,
      facets: { priorities, statuses },
    });
  } catch (e: any) {
    console.error("[GET /api/change/portfolio]", e);
    return jsonErr(safeStr(e?.message) || "Failed to load portfolio changes", 500);
  }
}


