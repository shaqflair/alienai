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

    // Auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim(); // optional — exclude current
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 50 : limitRaw));

    if (!projectId) return noStore({ ok: false, error: "Missing projectId" }, { status: 400 });

    // Access check — user must be a member of the project's org
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

    // Query all weekly_report artifacts for the project
    // Try v_artifact_board first (has artifact_id denormalized), fallback to artifacts table
    let rows: any[] = [];

    const { data: boardData, error: boardErr } = await supabase
      .from("v_artifact_board")
      .select("artifact_id, id, title, content_json, updated_at, created_at, artifact_type, type")
      .eq("project_id", projectId)
      .or("artifact_type.eq.weekly_report,type.eq.weekly_report")
      .order("updated_at", { ascending: false })
      .limit(limit + 5); // slight over-fetch for the exclusion below

    if (!boardErr && Array.isArray(boardData)) {
      rows = boardData;
    } else {
      // Fallback: query artifacts table directly
      const { data: artData, error: artErr } = await supabase
        .from("artifacts")
        .select("id, title, content_json, updated_at, created_at, artifact_type, type")
        .eq("project_id", projectId)
        .or("artifact_type.eq.weekly_report,type.eq.weekly_report")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit + 5);

      if (artErr) return noStore({ ok: false, error: artErr.message }, { status: 500 });
      rows = Array.isArray(artData) ? artData : [];
    }

    // Shape each row
    const reports = rows
      .map((row: any) => {
        const rowArtifactId = safeStr(row?.artifact_id ?? row?.id).trim();
        if (!rowArtifactId) return null;

        const cj = safeJson(row?.content_json);
        const period = extractPeriod(cj);
        const rag = extractRag(cj);
        const headline = extractHeadline(cj);
        const savedAt = safeStr(row?.updated_at ?? row?.created_at).trim();
        const title = safeStr(row?.title).trim() || null;

        return {
          artifactId: rowArtifactId,
          title,
          period,
          rag,
          headline,
          savedAt,
          contentJson: cj,
        };
      })
      .filter(Boolean)
      // Exclude the currently open artifact (it's already in the editor)
      .filter((r: any) => !artifactId || r.artifactId !== artifactId)
      .slice(0, limit);

    return noStore({ ok: true, reports });
  } catch (e: any) {
    return noStore({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
