// src/app/projects/[id]/artifacts/[artifactId]/_lib/artifact-detail-utils.ts
import "server-only";

import { PROJECT_CHARTER_TEMPLATE } from "@/components/editors/charter-template";

/* =========================================================
   Tiny Primitives & Validation
========================================================= */

export function safeParam(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

export function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

/* =========================================================
   Database Error Parsing
========================================================= */

export function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = String(col || "").toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}

export function isInvalidInputSyntaxError(err: any) {
  return String(err?.code || "").trim() === "22P02";
}

/* =========================================================
   Project Identification Logic
========================================================= */

export function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();

  // allow "P-100011" → "100011"
  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];

  return v;
}

export const HUMAN_COL_CANDIDATES = [
  "project_human_id",
  "human_id",
  "project_code",
  "code",
  "slug",
  "reference",
  "ref",
] as const;

export const PROJECT_META_SELECT =
  "id, organisation_id, project_code, title, name, client_name, start_date, finish_date";

/* =========================================================
   Status & UI Helpers
========================================================= */

export function derivedStatus(a: any) {
  const s = String(a?.approval_status ?? "").toLowerCase();

  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "changes_requested") return "changes_requested";
  if (s === "submitted") return "submitted";

  // legacy fallbacks
  if (a?.approved_by) return "approved";
  if (a?.rejected_by) return "rejected";
  if (a?.is_locked) return "submitted";

  return "draft";
}

export function statusPill(status: string) {
  const s = String(status ?? "").toLowerCase();
  const baseCls = "bg-gray-100 border-gray-200 text-gray-900";

  if (s === "approved") return { label: "✅ Approved", cls: baseCls };
  if (s === "rejected") return { label: "⛔ Rejected (Final)", cls: baseCls };
  if (s === "changes_requested") return { label: "🛠 Changes requested (CR)", cls: baseCls };
  if (s === "submitted") return { label: "🟡 Submitted", cls: baseCls };
  return { label: "📝 Draft", cls: baseCls };
}

/* =========================================================
   Artifact Type Detection (Fuzzy Matching)
========================================================= */

function normType(type: any) {
  return String(type ?? "").toLowerCase().trim();
}

export function isProjectCharterType(type: any) {
  const t = normType(type);
  return ["project_charter", "project charter", "charter", "projectcharter", "pid"].includes(t);
}

export function isStakeholderRegisterType(type: any) {
  const t = normType(type);
  return ["stakeholder_register", "stakeholder register", "stakeholders", "stakeholder"].includes(t);
}

export function isWbsType(type: any) {
  const t = normType(type);
  return ["wbs", "work breakdown structure", "work_breakdown_structure"].includes(t);
}

export function isScheduleType(type: any) {
  const t = normType(type);
  return ["schedule", "roadmap", "schedule / roadmap", "schedule_roadmap", "schedule_road_map", "gantt"].includes(t);
}

export function isChangeRequestsType(type: any) {
  const t = normType(type);
  return [
    "change_requests",
    "change requests",
    "change_request",
    "change request",
    "change_log",
    "change log",
    "kanban",
  ].includes(t);
}

export function isRAIDType(type: any) {
  const t = normType(type);
  return ["raid", "raid_log", "raid log", "raid_register", "raid register"].includes(t);
}

export function isLessonsLearnedType(type: any) {
  const t = normType(type);
  return ["lessons_learned", "lessons learned", "lesson learned", "lessons", "lesson", "retrospective", "retro"].includes(
    t
  );
}

export function isProjectClosureReportType(type: any) {
  const t = normType(type);
  return [
    "project_closure_report",
    "project closure report",
    "closure_report",
    "closure report",
    "project_closeout",
    "closeout",
    "close_out",
    "status_dashboard",
    "status dashboard",
  ].includes(t);
}

/**
 * ✅ Weekly Report
 */
export function isWeeklyReportType(type: any) {
  const t = normType(type);
  return [
    "weekly_report",
    "weekly report",
    "weekly",
    "weekly_status",
    "weekly status",
    "weekly_update",
    "weekly update",
    "delivery_report",
    "delivery report",
    "status_report",
    "status report",
  ].includes(t);
}

export function displayType(type: any) {
  const t = normType(type);

  // legacy aliases -> canonical keys
  if (t === "status_dashboard" || t === "status dashboard") return "project_closure_report";

  // weekly aliases -> canonical key
  if (
    t === "weekly" ||
    t === "weekly status" ||
    t === "weekly_status" ||
    t === "weekly update" ||
    t === "weekly_update" ||
    t === "delivery report" ||
    t === "delivery_report" ||
    t === "status report" ||
    t === "status_report"
  ) {
    return "weekly_report";
  }

  return String(type ?? "—");
}

/* =========================================================
   Content Parsing & Normalization
========================================================= */

export function safeJsonDoc(x: any) {
  if (!x || typeof x !== "object") return null;
  if ((x as any).type !== "doc" || !Array.isArray((x as any).content)) return null;
  return x;
}

export function forceProjectTitleIntoCharter(raw: any, projectTitle: string, clientName?: string) {
  const title = String(projectTitle ?? "").trim();
  const client = String(clientName ?? "").trim();

  if (raw && typeof raw === "object") {
    const next = structuredClone(raw) as any;
    next.meta = next.meta && typeof next.meta === "object" ? next.meta : {};
    next.meta.project_title = title;
    if (client && !next.meta.customer_account) next.meta.customer_account = client;
    return next;
  }

  return {
    version: 2,
    type: "project_charter",
    meta: { project_title: title, customer_account: client || "" },
    sections: [],
  };
}

export function ensureCharterV2Stored(raw: any) {
  if (raw && typeof raw === "object" && Number((raw as any).version) === 2 && Array.isArray((raw as any).sections)) {
    return raw;
  }

  if (raw && typeof raw === "object" && Array.isArray((raw as any).sections)) {
    return {
      version: 2,
      type: "project_charter",
      meta: (raw as any).meta ?? {},
      sections: (raw as any).sections ?? [],
    };
  }

  return raw;
}

export function getCharterInitialRaw(artifact: any) {
  const cj = artifact?.content_json;

  if (cj && typeof cj === "object") return cj;
  if (typeof cj === "string") {
    try {
      return JSON.parse(cj);
    } catch {}
  }

  const legacy = artifact?.content;
  if (legacy && typeof legacy === "object") return legacy;
  if (typeof legacy === "string") {
    const s = legacy.trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return JSON.parse(s);
      } catch {}
    }
  }

  const tiptap = safeJsonDoc(cj);
  if (tiptap) return tiptap;

  return PROJECT_CHARTER_TEMPLATE;
}

export function getTypedInitialJson(artifact: any) {
  const cj = artifact?.content_json;

  if (cj && typeof cj === "object") return cj;
  if (typeof cj === "string") {
    try {
      return JSON.parse(cj);
    } catch {}
  }

  const legacy = artifact?.content;
  if (legacy && typeof legacy === "object") return legacy;
  if (typeof legacy === "string") {
    const s = legacy.trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return JSON.parse(s);
      } catch {}
    }
  }

  // If it's tiptap doc stored as string or object, accept it too
  const tiptap = safeJsonDoc(cj);
  if (tiptap) return tiptap;

  return null;
}
