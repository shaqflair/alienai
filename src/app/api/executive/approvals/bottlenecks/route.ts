// src/app/api/executive/approvals/bottlenecks/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { clampDays, orgIdsForUser, requireUser, safeStr, num } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const _auth = await requireUser(supabase); const user = (_auth as any)?.user ?? _auth;

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));

    // Single-org mode: orgIdsForUser returns [profiles.active_organisation_id] (or [])
    const orgIds = await orgIdsForUser(user.id);
    if (!orgIds.length) return jsonOk({ days, items: [] });

    const orgId = safeStr(orgIds[0]).trim();
    if (!orgId) return jsonOk({ days, items: [] });

    // Prefer exec_approval_bottlenecks cache if present + has rows
    const { data: cached, error: cachedErr } = await supabase
      .from("exec_approval_bottlenecks")
      .select("*")
      .eq("org_id", orgId)
      .limit(200);

    // If table missing, Supabase returns an error. We treat that as "no cache available".
    if (!cachedErr && Array.isArray(cached) && cached.length) {
      const items = cached
        .map((r: any) => ({
          kind: safeStr(r?.kind || r?.approver_kind || "group"),
          label: safeStr(
            r?.label ||
              r?.approver_label ||
              r?.group_name ||
              r?.user_name ||
              "Unknown"
          ),
          pending_count: num(r?.pending_count ?? r?.count),
          projects_affected: num(r?.projects_affected ?? r?.project_count),
          avg_wait_days: num(r?.avg_wait_days ?? r?.avg_days ?? r?.avg_wait),
          max_wait_days: num(r?.max_wait_days ?? r?.max_days ?? r?.max_wait),
        }))
        .sort((a, b) => b.pending_count - a.pending_count)
        .slice(0, 25);

      return jsonOk({ days, orgId, source: "cache", items });
    }

    // Fallback: compute from v_pending_artifact_approvals (org-scoped)
    const { data: rows, error: rowsErr } = await supabase
      .from("v_pending_artifact_approvals")
      .select("*")
      .eq("org_id", orgId)
      .limit(5000);

    // If view missing, return empty rather than hard-fail (prevents cockpit blanking)
    const list = !rowsErr && Array.isArray(rows) ? rows : [];
    const by = new Map<string, any>();

    for (const r of list) {
      const label =
        safeStr(r?.approver_label) ||
        safeStr(r?.approval_group_name) ||
        safeStr(r?.group_name) ||
        safeStr(r?.approver_name) ||
        "Unassigned";

      const key = label.toLowerCase().trim();
      if (!key) continue;

      const created_at = safeStr(r?.created_at || r?.task_created_at || r?.pending_since);
      const t = created_at ? new Date(created_at).getTime() : NaN;
      const waitDays = Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : 0;

      const project_id = safeStr(r?.project_id);

      const cur = by.get(key) || {
        kind: safeStr(r?.approver_kind || (r?.approval_group_id ? "group" : "user") || "group"),
        label,
        pending_count: 0,
        projects: new Set<string>(),
        waitSum: 0,
        waitMax: 0,
      };

      cur.pending_count += 1;
      if (project_id) cur.projects.add(project_id);
      cur.waitSum += waitDays;
      cur.waitMax = Math.max(cur.waitMax, waitDays);

      by.set(key, cur);
    }

    const items = Array.from(by.values())
      .map((x: any) => ({
        kind: x.kind,
        label: x.label,
        pending_count: x.pending_count,
        projects_affected: x.projects.size,
        avg_wait_days: x.pending_count ? Math.round((x.waitSum / x.pending_count) * 10) / 10 : 0,
        max_wait_days: x.waitMax,
      }))
      .sort((a, b) => b.pending_count - a.pending_count)
      .slice(0, 25);

    return jsonOk({ days, orgId, source: "live", items });
  } catch (e: any) {
    return jsonErr(e?.message || "Failed", 500);
  }
}