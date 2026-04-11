import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(payload: any, init?: ResponseInit) {
  const res = NextResponse.json(payload, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  return res;
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try { return JSON.parse(String(x)); } catch { return null; }
}

function extractPeriod(cj: any): { from: string; to: string } | null {
  const p = cj?.period;
  if (!p) return null;
  const from = safeStr(p.from).trim();
  const to   = safeStr(p.to).trim();
  if (!from && !to) return null;
  return { from, to };
}

function extractRag(cj: any): "green" | "amber" | "red" | null {
  const raw = safeStr(cj?.summary?.rag ?? cj?.rag).toLowerCase().trim();
  if (raw === "green" || raw === "amber" || raw === "red") return raw as any;
  return null;
}

function extractHeadline(cj: any): string | null {
  const v = safeStr(cj?.summary?.headline ?? cj?.headline).trim();
  return v || null;
}

function mapArtifactRow(row: any) {
  const cj = safeJson(row.content_json ?? row.snapshot);
  return {
    artifactId:     safeStr(row.id ?? row.artifact_id),
    title:          safeStr(row.title) || null,
    period:         extractPeriod(cj),
    rag:            extractRag(cj),
    headline:       extractHeadline(cj),
    savedAt:        safeStr(row.last_saved_at ?? row.updated_at ?? row.created_at),
    contentJson:    cj,
    versionNo:      row.version ?? row.version_no ?? null,
    isCurrent:      row.is_current ?? false,
    approvalStatus: safeStr(row.approval_status ?? row.status ?? ""),
    source:         "artifact_revision",
  };
}

const ARTIFACT_SELECT = [
  "id", "title", "content_json", "version",
  "updated_at", "created_at", "last_saved_at",
  "is_current", "approval_status", "status",
  "artifact_type", "type", "root_artifact_id",
].join(", ");

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const url        = new URL(req.url);
    const projectId  = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();
    const limitRaw   = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit      = Math.max(1, Math.min(100, isNaN(limitRaw) ? 50 : limitRaw));

    if (!projectId) {
      return noStore({ ok: false, error: "Missing projectId" }, { status: 400 });
    }

    // ── Access check ─────────────────────────────────────────────
    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("id, organisation_id, deleted_at")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr) return noStore({ ok: false, error: projErr.message }, { status: 500 });
    if (!proj?.id || proj.deleted_at != null) {
      return noStore({ ok: false, error: "Project not found" }, { status: 404 });
    }

    const orgId = safeStr(proj.organisation_id).trim();
    if (orgId) {
      const { data: mem } = await supabase
        .from("organisation_members")
        .select("role")
        .eq("organisation_id", orgId)
        .eq("user_id", auth.user.id)
        .is("removed_at", null)
        .maybeSingle();
      if (!mem) return noStore({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    let reports: any[] = [];

    /* ══════════════════════════════════════════════════════════════
       STRATEGY 1 — Revision chain for this specific artifact
       Covers: root artifact + all revisions linked by root_artifact_id
    ══════════════════════════════════════════════════════════════ */
    if (artifactId) {
      const { data: current } = await supabase
        .from("artifacts")
        .select("id, root_artifact_id")
        .eq("id", artifactId)
        .maybeSingle();

      // root_artifact_id is null when the artifact IS the root
      const rootId = safeStr(current?.root_artifact_id || artifactId);

      const { data: chain, error: chainErr } = await supabase
        .from("artifacts")
        .select(ARTIFACT_SELECT)
        .eq("project_id", projectId)
        .is("deleted_at", null)
        // id.eq.rootId catches the root row (root_artifact_id is null on root)
        // root_artifact_id.eq.rootId catches all revision rows
        .or(`id.eq.${rootId},root_artifact_id.eq.${rootId}`)
        .order("version", { ascending: false })
        .limit(limit);

      if (chainErr) {
        console.warn("[weekly-history] S1 chain failed:", chainErr.message);
      } else if (Array.isArray(chain) && chain.length > 0) {
        reports = chain.map(mapArtifactRow).filter(Boolean);
        console.log(`[weekly-history] S1: ${reports.length} versions, root=${rootId}`);
      }
    }

    /* ══════════════════════════════════════════════════════════════
       STRATEGY 2 — All WEEKLY_REPORT rows in project by type column
       NB: artifact_type is NULL for weekly reports in this app —
       the normalize trigger did not fire. Query by type='WEEKLY_REPORT'
       (uppercase) which is the actual stored value.
    ══════════════════════════════════════════════════════════════ */
    if (reports.length === 0) {
      const { data: byType, error: btErr } = await supabase
        .from("artifacts")
        .select(ARTIFACT_SELECT)
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .eq("type", "WEEKLY_REPORT")          // exact match, uppercase
        .order("version", { ascending: false })
        .limit(limit);

      if (btErr) {
        console.warn("[weekly-history] S2 (type=WEEKLY_REPORT) failed:", btErr.message);
      } else if (Array.isArray(byType) && byType.length > 0) {
        reports = byType.map(mapArtifactRow).filter(Boolean);
        console.log(`[weekly-history] S2: ${reports.length} rows`);
      }
    }

    /* ══════════════════════════════════════════════════════════════
       STRATEGY 3 — artifact_type = 'weekly_report' (lowercase enum)
       Fallback for rows where the trigger DID normalise artifact_type
    ══════════════════════════════════════════════════════════════ */
    if (reports.length === 0) {
      const { data: byArtType, error: batErr } = await supabase
        .from("artifacts")
        .select(ARTIFACT_SELECT)
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .eq("artifact_type", "weekly_report")
        .order("version", { ascending: false })
        .limit(limit);

      if (batErr) {
        console.warn("[weekly-history] S3 (artifact_type) failed:", batErr.message);
      } else if (Array.isArray(byArtType) && byArtType.length > 0) {
        reports = byArtType.map(mapArtifactRow).filter(Boolean);
        console.log(`[weekly-history] S3: ${reports.length} rows`);
      }
    }

    /* ══════════════════════════════════════════════════════════════
       STRATEGY 4 — artifact_versions snapshot table (last resort)
    ══════════════════════════════════════════════════════════════ */
    if (reports.length === 0 && artifactId) {
      const { data: versions, error: vErr } = await supabase
        .from("artifact_versions")
        .select("id, artifact_id, snapshot, title, version_no, created_at")
        .eq("artifact_id", artifactId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (vErr) {
        console.warn("[weekly-history] S4 (artifact_versions) failed:", vErr.message);
      } else if (Array.isArray(versions) && versions.length > 0) {
        reports = versions.map(row => {
          const cj = safeJson(row.snapshot);
          return {
            artifactId:  safeStr(row.artifact_id),
            title:       safeStr(row.title) || null,
            period:      extractPeriod(cj),
            rag:         extractRag(cj),
            headline:    extractHeadline(cj),
            savedAt:     safeStr(row.created_at),
            contentJson: cj,
            versionNo:   row.version_no ?? null,
            source:      "version_snapshot",
          };
        }).filter(Boolean);
        console.log(`[weekly-history] S4: ${reports.length} snapshots`);
      }
    }

    console.log(`[weekly-history] DONE: project=${projectId} artifact=${artifactId} total=${reports.length}`);

    return noStore({ ok: true, reports });

  } catch (e: any) {
    console.error("[weekly-history] FATAL:", e?.message, e?.stack);
    return noStore({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}