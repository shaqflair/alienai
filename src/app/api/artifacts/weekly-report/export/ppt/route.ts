import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { jsonErr, fileResponse } from "@/lib/exports/_shared/fileResponse";
import { safeStr } from "@/lib/exports/_shared/utils";

import { normalizeWeeklyReportV1 } from "@/lib/exports/weekly-report/transform";
import { exportWeeklyReportPptxBuffer } from "@/lib/exports/weekly-report/exportWeeklyReportPptxBuffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- local helpers ---------------- */

type Rag = "green" | "amber" | "red";

function asRag(x: any): Rag | null {
  const r = safeStr(x).trim().toLowerCase();
  if (r === "green" || r === "amber" || r === "red") return r;
  return null;
}

function buildPreviousSnapshot(prevModel: any) {
  const summaryRag = asRag(prevModel?.summary?.rag) ?? "green";

  const milestonesByName: Record<string, { rag: Rag }> = {};
  const prevMilestones = Array.isArray(prevModel?.milestones) ? prevModel.milestones : [];

  for (const m of prevMilestones) {
    const name = safeStr(m?.name).trim();
    if (!name) continue;

    // Your model stores milestone "status" which you're treating as rag in the ppt layer
    const rag = asRag(m?.status) ?? summaryRag;
    milestonesByName[name] = { rag };
  }

  return {
    summary: { rag: summaryRag },
    milestonesByName,
    period: prevModel?.period ?? null,
    artifactId: safeStr(prevModel?.meta?.sources?.artifactId).trim() || null,
  };
}

function isTruthyParam(v: string) {
  const s = safeStr(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    // Accept (optional) includeDraft flag for future behavior (safe no-op for now)
    const includeDraft = safeStr(url.searchParams.get("includeDraft")).trim();
    const includeDraftBool = isTruthyParam(includeDraft);

    if (!projectId || !artifactId) {
      return jsonErr("Missing projectId/artifactId", 400, { projectId, artifactId, includeDraft });
    }

    const sb = await createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth?.user) return jsonErr("Not authenticated", 401);

    // 1) Load current artifact
    const { data: artifact, error } = await sb
      .from("artifacts")
      .select("id, project_id, type, created_at, title, content_json, content, projects:project_id ( id, project_code, title )")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .single();

    if (error || !artifact) return jsonErr(error?.message || "Artifact not found", 404);

    const raw = (artifact as any).content_json ?? (artifact as any).content;
    const model = normalizeWeeklyReportV1(raw);

    if (!model) {
      return jsonErr("Weekly report content is empty or invalid JSON", 422, {
        artifactId,
        projectId,
        hasContentJson: Boolean((artifact as any).content_json),
      });
    }

    // Tag current artifact id into sources (handy for downstream)
    (model as any).meta = (model as any).meta && typeof (model as any).meta === "object" ? (model as any).meta : {};
    (model as any).meta.sources =
      (model as any).meta.sources && typeof (model as any).meta.sources === "object" ? (model as any).meta.sources : {};
    (model as any).meta.sources.artifactId = safeStr((artifact as any).id).trim() || null;

    const projectCode = safeStr((artifact as any)?.projects?.project_code).trim();
    const projectName = safeStr((artifact as any)?.projects?.title).trim();

    // 2) Load previous weekly report (same project, same type, earlier created_at)
    // NOTE: artifact_type does not include weekly report, so we match on `type`.
    const currentCreatedAt = (artifact as any)?.created_at;
    const currentType = safeStr((artifact as any)?.type).trim();

    if (currentCreatedAt && currentType) {
      // If in future you want includeDraft to change behaviour, this is where youâ€™d branch.
      // For now: we DO include drafts by default (safe), but you can tighten later.
      // You could add: .neq("approval_status","draft") unless includeDraftBool
      const prevQ = sb
        .from("artifacts")
        .select("id, created_at, content_json, content, approval_status, deleted_at, type")
        .eq("project_id", projectId)
        .eq("type", currentType)
        .lt("created_at", currentCreatedAt)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1);

      const { data: prevRows } = await prevQ;
      const prev = Array.isArray(prevRows) && prevRows.length ? prevRows[0] : null;

      if (prev) {
        const prevRaw = (prev as any).content_json ?? (prev as any).content;
        const prevModel = normalizeWeeklyReportV1(prevRaw);

        if (prevModel) {
          // Attach prev artifact id into prev model sources (handy)
          (prevModel as any).meta = (prevModel as any).meta && typeof (prevModel as any).meta === "object" ? (prevModel as any).meta : {};
          (prevModel as any).meta.sources =
            (prevModel as any).meta.sources && typeof (prevModel as any).meta.sources === "object"
              ? (prevModel as any).meta.sources
              : {};
          (prevModel as any).meta.sources.artifactId = safeStr((prev as any).id).trim() || null;

          // Inject the snapshot the PPT renderer expects
          (model as any).meta.sources.previous_snapshot = buildPreviousSnapshot(prevModel);
        } else {
          // Keep export working even if previous is malformed
          (model as any).meta.sources.previous_snapshot = null;
        }
      } else {
        (model as any).meta.sources.previous_snapshot = null;
      }
    }

    const { buffer, filename } = await exportWeeklyReportPptxBuffer({
      model,
      projectCode,
      projectName,
    });

    return fileResponse(
      buffer,
      filename,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Export failed" }, { status: 500 });
  }
}


