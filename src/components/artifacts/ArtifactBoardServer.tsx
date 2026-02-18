// src/app/projects/[id]/artifacts/_components/ArtifactBoardServer.tsx
import "server-only";

import { createClient } from "@/utils/supabase/server";
import ArtifactBoardClient, { type ArtifactBoardRow } from "@/components/artifacts/ArtifactBoardClient";

export const runtime = "nodejs";

/* ---------------- utils ---------------- */

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

function normalizeKey(x: unknown) {
  return safeStr(x).trim().toUpperCase();
}

function booly(v: any) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = safeLower(v);
  if (s === "true" || s === "t" || s === "yes" || s === "y" || s === "1") return true;
  return false;
}

const ALLOWED_KEYS = new Set(
  [
    "CHANGE_REQUESTS",
    "PROJECT_CHARTER",
    "RAID",
    "SCHEDULE",
    "WBS",
    "STAKEHOLDER_REGISTER",
    "LESSONS_LEARNED",
    "PROJECT_CLOSURE_REPORT",
    "WEEKLY_REPORT",
    "DELIVERY_REPORT",
    "WEEKLY_STATUS",
    "WEEKLY_UPDATE",
    "CHANGE_REQUEST",
    "CHANGE LOG",
    "CHANGE_LOG",
    "PROJECT CHARTER",
    "STAKEHOLDER REGISTER",
    "LESSONS LEARNED",
    "CLOSURE_REPORT",
    "CLOSURE REPORT",
    "STATUS_DASHBOARD",
    "STATUS DASHBOARD",
    "SCHEDULE / ROADMAP",
    "ROADMAP",
    "GANTT",
    "WORK_BREAKDOWN_STRUCTURE",
    "WORK BREAKDOWN STRUCTURE",
    "RAID_LOG",
    "RAID LOG",
  ].map((x) => normalizeKey(x))
);

function derivedUiStatus(a: any): "Draft" | "In review" | "Approved" | "Blocked" {
  const s = safeLower(a?.approval_status ?? a?.status ?? "");
  if (s === "approved") return "Approved";
  if (s === "submitted") return "In review";
  if (s === "changes_requested" || s === "rejected" || s === "on_hold") return "Blocked";
  return "Draft";
}

function derivedPhase(a: any): "Initiating" | "Planning" | "Executing" | "Monitoring & Controlling" | "Closing" {
  const p = safeLower(a?.phase);
  if (p === "initiating") return "Initiating";
  if (p === "planning") return "Planning";
  if (p === "executing") return "Executing";
  if (p === "monitoring & controlling" || p === "monitoring_and_controlling" || p === "monitoring") {
    return "Monitoring & Controlling";
  }
  if (p === "closing") return "Closing";

  const t = safeLower(a?.artifact_key ?? a?.type);

  if (t.includes("charter") || t === "pid") return "Initiating";
  if (t.includes("wbs") || t.includes("schedule") || t.includes("roadmap") || t.includes("plan")) return "Planning";
  if (t.includes("weekly") || t.includes("delivery_report") || t.includes("status_report")) return "Executing";
  if (t.includes("raid") || t.includes("change")) return "Monitoring & Controlling";
  if (t.includes("lessons") || t.includes("closure") || t.includes("status_dashboard")) return "Closing";

  return "Executing";
}

function initialsFromEmail(email: string) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return "—";
  const local = e.split("@")[0] || e;
  const parts = local.split(/[.\-_+]/g).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0] ?? "";
    const b = parts[parts.length - 1]?.[0] ?? "";
    return (a + b).toUpperCase() || local.slice(0, 2).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function defaultProgressFromApproval(a: any): number {
  const s = safeLower(a?.approval_status ?? a?.status ?? "");
  if (s === "approved") return 100;
  if (s === "submitted") return 75;
  if (s === "changes_requested") return 50;
  if (s === "rejected") return 0;
  return 20;
}

function labelForType(type: string) {
  return safeStr(type).trim() || "Artifact";
}

/* ---------------- project resolver ---------------- */

async function resolveProjectByIdentifier(
  supabase: any,
  identifier: string
): Promise<{ proj: any | null; projectUuid: string | null; projectCode: string | null; projectName: string | null }> {
  const raw = safeStr(identifier).trim();
  if (!raw) return { proj: null, projectUuid: null, projectCode: null, projectName: null };

  const { data, error } = await supabase
    .from("projects")
    .select("id,title,project_code")
    .eq("project_code", raw)
    .maybeSingle();

  if (!error && data?.id) {
    return {
      proj: data,
      projectUuid: String(data.id),
      projectCode: safeStr(data.project_code).trim() || null,
      projectName: safeStr(data.title).trim() || null,
    };
  }

  if (looksLikeUuid(raw)) {
    const { data: uuidData, error: uuidError } = await supabase
      .from("projects")
      .select("id,title,project_code")
      .eq("id", raw)
      .maybeSingle();
      
    if (!uuidError && uuidData?.id) {
      return {
        proj: uuidData,
        projectUuid: String(uuidData.id),
        projectCode: safeStr(uuidData.project_code).trim() || null,
        projectName: safeStr(uuidData.title).trim() || null,
      };
    }
  }

  return { proj: null, projectUuid: null, projectCode: null, projectName: null };
}

/* ---------------- current marker ---------------- */

function computeCurrentIdsFallback(items: any[]): Set<string> {
  const bestByType = new Map<string, { id: string; updatedAt: number }>();

  for (const a of items || []) {
    const typeKey = safeStr(a?.type ?? a?.artifact_key ?? a?.artifact_type).trim() || "UNKNOWN";
    const id = safeStr(a?.artifact_id ?? a?.id).trim();
    if (!id) continue;

    const updatedRaw = a?.updated_at ?? a?.created_at ?? null;
    const updatedAt = updatedRaw ? new Date(String(updatedRaw)).getTime() : 0;

    const prev = bestByType.get(typeKey);
    if (!prev || updatedAt >= prev.updatedAt) {
      bestByType.set(typeKey, { id, updatedAt });
    }
  }

  return new Set(Array.from(bestByType.values()).map((x) => x.id));
}

/* ---------------- component ---------------- */

export default async function ArtifactBoardServer({
  projectId,
  mode = "current",
}: {
  projectId: string;
  mode?: "current" | "all";
}) {
  const supabase = await createClient();

  const { proj, projectUuid, projectCode, projectName } = await resolveProjectByIdentifier(supabase, projectId);

  if (!proj?.id || !projectUuid) throw new Error("Project not found");

  const projectHumanId = projectCode ?? "";

  let q = supabase
    .from("v_artifact_board")
    .select("*")
    .eq("project_id", projectUuid)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (mode === "current") {
    q = q.eq("is_current", true);
  }

  const { data, error } = await q;
  if (error) throw error;

  const filtered = (data ?? []).filter((a: any) => {
    const k = normalizeKey(a?.artifact_key ?? a?.type ?? a?.artifact_type);
    return ALLOWED_KEYS.has(k);
  });

  const hasIsCurrentColumn = filtered.some(
    (a: any) => typeof a?.is_current !== "undefined" || typeof a?.isCurrent !== "undefined"
  );
  const currentIdsFallback = hasIsCurrentColumn ? new Set<string>() : computeCurrentIdsFallback(filtered);

  const rows: ArtifactBoardRow[] = filtered.map((a: any) => {
    const key = safeStr(a.artifact_key ?? a.type);
    const title = safeStr(a.title) || labelForType(key);
    const ownerEmail = safeStr(a.owner_email);
    const progress = typeof a.progress_pct === "number" 
      ? Math.max(0, Math.min(100, a.progress_pct)) 
      : defaultProgressFromApproval(a);
    const id = String(a.artifact_id ?? a.id);
    const isCurrentFromView = booly(a.is_current ?? a.isCurrent);
    const isCurrent = hasIsCurrentColumn ? isCurrentFromView : currentIdsFallback.has(id);
    const typeKey = safeStr(a.type ?? a.artifact_key ?? a.artifact_type).trim();

    return {
      id,
      artifactType: labelForType(key),
      title,
      ownerEmail,
      ownerName: ownerEmail || "—",
      ownerInitials: initialsFromEmail(ownerEmail),
      progress,
      status: derivedUiStatus(a),
      phase: derivedPhase(a),
      isBaseline: !!(a.is_baseline ?? a.isBaseline),
      isCurrent,
      typeKey,
      currentLabel: isCurrent ? "Current" : "",
    } as ArtifactBoardRow;
  });

  return (
    <ArtifactBoardClient
      projectHumanId={projectHumanId}
      projectCode={projectCode}
      projectName={projectName}
      projectUuid={projectUuid}
      rows={rows}
    />
  );
}
