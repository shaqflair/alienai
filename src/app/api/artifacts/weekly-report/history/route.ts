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
  const to = safeStr(p.to).trim();
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

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const projectId  = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();
    const limitRaw   = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit      = Math.max(1, Math.min(100, isNaN(limitRaw) ? 50 : limitRaw));

    if (!projectId) return noStore({ ok: false, error: "Missing projectId" }, { status: 400 });

    // Access check
    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("id, organisation_id, deleted_at")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) return noStore({ ok: false, error: projErr.message }, { status: 500 });
    if (!proj?.id || proj.deleted_at != null) return noStore({ ok: false, error: "Project not found" }, { status: 404 });

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

    // ── Primary: read from artifact_versions ────────────────────────────────
    // This is written by updateArtifactJsonArgs on every meaningful save.
    let reports: any[] = [];

    if (artifactId) {
      const { data: versions, error: verErr } = await supabase
        .from("artifact_versions")
        .select("id, artifact_id, snapshot, title, version_no, created_at, artifact_type")
        .eq("artifact_id", artifactId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!verErr && Array.isArray(versions) && versions.length > 0) {
        reports = versions.map((row: any) => {
          const cj = safeJson(row.snapshot);
          return {
            artifactId: safeStr(row.artifact_id),
            title:      safeStr(row.title) || null,
            period:     extractPeriod(cj),
            rag:        extractRag(cj),
            headline:   extractHeadline(cj),
            savedAt:    safeStr(row.created_at),
            contentJson: cj,
            versionNo:  row.version_no ?? null,
          };
        }).filter(Boolean);
      }
    }

    // ── Fallback: other weekly_report artifacts for this project ─────────────
    // Used when artifact_versions has no entries yet (before first save via new code)
    if (reports.length === 0) {
      const { data: artData } = await supabase
        .from("artifacts")
        .select("id, title, content_json, updated_at, created_at, type")
        .eq("project_id", projectId)
        .ilike("type", "%weekly_report%")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit + 5);

      reports = (artData ?? [])
        .filter((row: any) => !artifactId || safeStr(row.id) !== artifactId)
        .map((row: any) => {
          const cj = safeJson(row.content_json);
          return {
            artifactId:  safeStr(row.id),
            title:       safeStr(row.title) || null,
            period:      extractPeriod(cj),
            rag:         extractRag(cj),
            headline:    extractHeadline(cj),
            savedAt:     safeStr(row.updated_at ?? row.created_at),
            contentJson: cj,
          };
        })
        .filter(Boolean)
        .slice(0, limit);
    }

    return noStore({ ok: true, reports });
  } catch (e: any) {
    return noStore({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}