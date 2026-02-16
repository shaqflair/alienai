// src/app/projects/[id]/artifacts/page.tsx
import "server-only";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import ArtifactBoardClient, {
  type ArtifactBoardRow,
  type Phase,
  type UiStatus,
} from "@/components/artifacts/ArtifactBoardClient";

/* =========================================================
   helpers
========================================================= */

function safeParam(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
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

function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}

function isInvalidInputSyntaxError(err: any) {
  return String(err?.code || "").trim() === "22P02";
}

function shapeErr(err: any) {
  if (!err) return { kind: "empty", raw: err };
  if (err instanceof Error)
    return { kind: "Error", name: err.name, message: err.message, stack: err.stack };
  return {
    kind: typeof err,
    code: err?.code,
    message: err?.message,
    details: err?.details,
    hint: err?.hint,
    status: err?.status,
    raw: err,
  };
}

function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();

  // allow "P-100011" / "PRJ-100011" / etc -> "100011"
  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];

  return v;
}

function extractDigitsAsNumber(input: string): number | null {
  const s = normalizeProjectIdentifier(input);
  const m = String(s).match(/^\d+$/);
  if (!m) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * Deterministic resolver:
 * - UUID → use directly (no projects lookup needed)
 * - else → digits → projects.project_code = <number>
 * - else → optional fallbacks to slug/reference columns (best-effort + tolerant)
 */
async function resolveProject(supabase: any, identifier: string): Promise<{
  projectUuid: string | null;
  project: any | null;
  projectHumanId: string;
}> {
  const raw = safeStr(identifier).trim();
  if (!raw || raw === "undefined" || raw === "null") {
    return { projectUuid: null, project: null, projectHumanId: "" };
  }

  // UUID fast path
  if (looksLikeUuid(raw)) {
    return { projectUuid: raw, project: null, projectHumanId: raw };
  }

  // Primary human-id path: project_code (numeric)
  const codeNum = extractDigitsAsNumber(raw);
  if (codeNum != null) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,title,name,project_code,client_name,organisation_id,finish_date,end_date")
      .eq("project_code", codeNum)
      .maybeSingle();

    if (error) {
      // 22P02 shouldn't happen here (numeric), but tolerate anyway
      if (isInvalidInputSyntaxError(error)) {
        return { projectUuid: null, project: null, projectHumanId: "" };
      }
      throw error;
    }

    if (data?.id) {
      const human = safeStr(data.project_code).trim()
        ? `P-${String(Number(data.project_code)).padStart(5, "0")}`
        : normalizeProjectIdentifier(raw);

      return { projectUuid: String(data.id), project: data, projectHumanId: human };
    }
  }

  // Optional fallbacks (only if those columns exist)
  const fallbacks = ["slug", "reference", "ref", "code", "human_id"] as const;

  for (const col of fallbacks) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,title,name,project_code,client_name,organisation_id,finish_date,end_date")
      .eq(col, raw)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      if (isInvalidInputSyntaxError(error)) continue;
      throw error;
    }

    if (data?.id) {
      const human = safeStr(data.project_code).trim()
        ? `P-${String(Number(data.project_code)).padStart(5, "0")}`
        : normalizeProjectIdentifier(raw);

      return { projectUuid: String(data.id), project: data, projectHumanId: human };
    }
  }

  return { projectUuid: null, project: null, projectHumanId: "" };
}

/* =========================================================
   mapping helpers
========================================================= */

function canonType(x: any) {
  const raw = safeStr(x).trim().toLowerCase();
  if (!raw) return "";

  const t = raw
    .replace(/\s+/g, " ")
    .replace(/[\/]+/g, " / ")
    .replace(/[_-]+/g, "_")
    .trim();

  if (t === "status_dashboard" || t === "status dashboard") return "PROJECT_CLOSURE_REPORT";

  if (t === "project_charter" || t === "project charter" || t === "charter" || t === "projectcharter" || t === "pid")
    return "PROJECT_CHARTER";

  if (t === "stakeholder_register" || t === "stakeholder register" || t === "stakeholders" || t === "stakeholder")
    return "STAKEHOLDER_REGISTER";

  if (t === "wbs" || t === "work breakdown structure" || t === "work_breakdown_structure") return "WBS";

  if (
    t === "schedule" ||
    t === "roadmap" ||
    t === "gantt" ||
    t === "schedule / roadmap" ||
    t === "schedule_roadmap" ||
    t === "schedule_road_map"
  )
    return "SCHEDULE";

  if (
    t === "change_requests" ||
    t === "change requests" ||
    t === "change_request" ||
    t === "change request" ||
    t === "change_log" ||
    t === "change log" ||
    t === "kanban"
  )
    return "CHANGE_REQUESTS";

  if (t === "raid" || t === "raid_log" || t === "raid log" || t === "raid_register" || t === "raid register") return "RAID";

  if (
    t === "lessons_learned" ||
    t === "lessons learned" ||
    t === "lesson learned" ||
    t === "lessons" ||
    t === "lesson" ||
    t === "retrospective" ||
    t === "retro"
  )
    return "LESSONS_LEARNED";

  if (
    t === "project_closure_report" ||
    t === "project closure report" ||
    t === "closure_report" ||
    t === "closure report" ||
    t === "project_closeout" ||
    t === "closeout" ||
    t === "close_out"
  )
    return "PROJECT_CLOSURE_REPORT";

  return raw.toUpperCase().replace(/\s+/g, "_");
}

function phaseForCanonType(typeKey: string): Phase {
  switch (typeKey) {
    case "PROJECT_CHARTER":
      return "Initiating";
    case "STAKEHOLDER_REGISTER":
    case "WBS":
    case "SCHEDULE":
      return "Planning";
    case "RAID":
    case "CHANGE_REQUESTS":
      return "Monitoring & Controlling";
    case "LESSONS_LEARNED":
    case "PROJECT_CLOSURE_REPORT":
      return "Closing";
    default:
      return "Planning";
  }
}

function uiStatusFromArtifact(a: any): UiStatus {
  const approval = safeLower(a?.approval_status);
  if (approval === "approved" || a?.is_baseline) return "Approved";
  if (approval === "submitted" || approval === "review" || approval === "in_review") return "In review";
  if (approval === "rejected") return "Blocked";
  if (a?.is_locked) return "In review";
  return "Draft";
}

function progressFromArtifact(a: any) {
  const approval = safeLower(a?.approval_status);
  if (a?.is_baseline) return 100;
  if (approval === "approved") return 95;
  if (approval === "submitted" || approval === "review" || approval === "in_review") return 70;
  if (approval === "changes_requested") return 45;
  if (approval === "rejected") return 0;
  if (a?.is_locked) return 70;
  return 20;
}

function fmtUkDateOnly(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  } catch {
    return iso;
  }
}

const PHASE_ORDER: Phase[] = ["Initiating", "Planning", "Executing", "Monitoring & Controlling", "Closing"];
const TYPE_ORDER = [
  "PROJECT_CHARTER",
  "STAKEHOLDER_REGISTER",
  "WBS",
  "SCHEDULE",
  "CHANGE_REQUESTS",
  "RAID",
  "LESSONS_LEARNED",
  "PROJECT_CLOSURE_REPORT",
];

function typeRank(t: string) {
  const i = TYPE_ORDER.indexOf(t);
  return i === -1 ? 999 : i;
}
function phaseRank(p: Phase) {
  const i = PHASE_ORDER.indexOf(p);
  return i === -1 ? 999 : i;
}
function safeDateSortKey(x: any): number {
  const s = safeStr(x ?? "").trim();
  if (!s) return 0;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

type ArtifactBoardRowWithActions = ArtifactBoardRow & {
  canDeleteDraft?: boolean;
  canClone?: boolean;
  approvalStatus?: string;
  isLocked?: boolean;
  deletedAt?: string | null;
};

function canDeleteDraftFromArtifact(a: any): boolean {
  const approval = safeLower(a?.approval_status);
  const isDraft = approval === "" || approval === "draft" || approval === "new";
  const locked = Boolean(a?.is_locked);
  const baseline = Boolean(a?.is_baseline);
  return isDraft && !locked && !baseline;
}

/* =========================================================
   page
========================================================= */

export default async function ArtifactsPage({
  params,
}: {
  params: Promise<{ id?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { id } = await params;
  const projectIdentifier = safeParam(id);

  if (!projectIdentifier || projectIdentifier === "undefined" || projectIdentifier === "null") notFound();

  let resolved: { projectUuid: string | null; project: any | null; projectHumanId: string };
  try {
    resolved = await resolveProject(supabase, projectIdentifier);
  } catch (e) {
    console.error("[ArtifactsPage] resolveProject error:", shapeErr(e), { projectIdentifier });
    notFound();
  }

  if (!resolved?.projectUuid) notFound();
  const projectUuid = String(resolved.projectUuid);

  // ✅ membership gate first (real access check)
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem) notFound();

  const role = safeLower((mem as any)?.role);
  const canEditProject = role === "owner" || role === "editor";

  // ✅ best-effort project meta if UUID path didn’t fetch it
  let project = resolved.project ?? null;
  if (!project) {
    const { data: p, error: pErr } = await supabase
      .from("projects")
      .select("id,title,name,project_code,client_name,organisation_id,finish_date,end_date")
      .eq("id", projectUuid)
      .maybeSingle();
    if (!pErr && p?.id) project = p;
  }

  const projectHumanId =
    safeStr(resolved.projectHumanId).trim() || normalizeProjectIdentifier(projectIdentifier);

  const projectName = safeStr((project as any)?.title ?? (project as any)?.name ?? "").trim() || "Project";
  const projectCodeRaw = safeStr((project as any)?.project_code ?? "").trim();
  const projectCode = projectCodeRaw
    ? `P-${String(Number(projectCodeRaw)).padStart(5, "0")}`
    : projectHumanId;

  const projectFinishDateIso = safeStr((project as any)?.finish_date ?? (project as any)?.end_date ?? "").trim();
  const dueDisplay = projectFinishDateIso ? fmtUkDateOnly(projectFinishDateIso) : "—";

  // artifacts
  const { data: artifacts, error: artErr } = await supabase
    .from("artifacts")
    .select(
      [
        "id",
        "project_id",
        "user_id",
        "type",
        "title",
        "updated_at",
        "created_at",
        "is_current",
        "is_baseline",
        "approval_status",
        "is_locked",
        "deleted_at",
      ].join(", ")
    )
    .eq("project_id", projectUuid)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (artErr) throw artErr;

  const arts = (artifacts ?? []) as any[];

  // owners
  const userIds = Array.from(new Set(arts.map((a) => safeStr(a?.user_id).trim()).filter(Boolean)));
  const ownerMap: Record<string, { name?: string; email?: string }> = {};

  if (userIds.length) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);

    if (!profErr) {
      for (const p of (profs ?? []) as any[]) {
        const uid = safeStr(p?.user_id).trim();
        if (!uid) continue;
        ownerMap[uid] = {
          name: safeStr(p?.full_name).trim() || undefined,
          email: safeStr(p?.email).trim() || undefined,
        };
      }
    }
  }

  // group by type
  const byType = new Map<string, any[]>();
  for (const a of arts) {
    const t = canonType(a?.type);
    if (!t) continue;
    const arr = byType.get(t) ?? [];
    arr.push(a);
    byType.set(t, arr);
  }

  const picked: any[] = [];

  for (const [, list] of byType.entries()) {
    const sorted = [...list].sort((a, b) => {
      const ad = safeDateSortKey(a?.updated_at) || safeDateSortKey(a?.created_at);
      const bd = safeDateSortKey(b?.updated_at) || safeDateSortKey(b?.created_at);
      return bd - ad;
    });

    const current = sorted.find((x) => !!x?.is_current);
    const drafts = sorted.filter((x) => safeLower(x?.approval_status) === "draft" && !x?.is_baseline);

    const seen = new Set<string>();
    const pushOnce = (x: any) => {
      const id = safeStr(x?.id).trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      picked.push(x);
    };

    if (current) pushOnce(current);
    else if (sorted[0]) pushOnce(sorted[0]);

    for (const d of drafts.slice(0, 2)) pushOnce(d);
  }

  const rows: ArtifactBoardRowWithActions[] = picked
    .filter((a) => safeStr(a?.id).trim())
    .map((a) => {
      const id = safeStr(a.id).trim();
      const t = canonType(a?.type) || safeStr(a?.type).trim() || "—";
      const owner = ownerMap[safeStr(a?.user_id).trim()] ?? {};

      const approvalStatus = safeLower(a?.approval_status) || "";
      const isLocked = Boolean(a?.is_locked);

      return {
        id,
        artifactType: t,
        title: safeStr(a?.title).trim() || t,
        ownerEmail: owner.email ?? "",
        ownerName: owner.name ?? undefined,
        progress: progressFromArtifact(a),
        status: uiStatusFromArtifact(a),
        phase: phaseForCanonType(t),
        due: dueDisplay,
        isBaseline: !!a?.is_baseline,

        canDeleteDraft: canEditProject && canDeleteDraftFromArtifact(a),
        canClone: canEditProject,
        approvalStatus,
        isLocked,
        deletedAt: (a as any)?.deleted_at ?? null,
      };
    })
    .sort((a, b) => {
      const pr = phaseRank(a.phase) - phaseRank(b.phase);
      if (pr !== 0) return pr;

      const tr = typeRank(a.artifactType) - typeRank(b.artifactType);
      if (tr !== 0) return tr;

      return a.title.localeCompare(b.title);
    });

  return (
    <ArtifactBoardClient
      projectHumanId={projectHumanId}
      projectUuid={projectUuid}
      projectName={projectName}
      projectCode={projectCode}
      rows={rows}
    />
  );
}
