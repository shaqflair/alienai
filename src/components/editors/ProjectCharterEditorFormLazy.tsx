// src/components/editors/ProjectCharterEditorFormLazy.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import { PROJECT_CHARTER_TEMPLATE } from "@/components/editors/charter-template";
import {
  autosaveProjectCharterV2,
  saveProjectCharterV2Manual,
} from "@/app/projects/[id]/artifacts/[artifactId]/charter-v2-actions";

import type { ImproveSectionPayload } from "./ProjectCharterSectionEditor";
import { formatDateTimeAuto } from "@/lib/date/format";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  AlertCircle,
  CheckCheck,
  ChevronDown,
  CornerDownLeft,
  Download,
  Eye,
  File,
  FileLock2,
  FileText,
  Loader2,
  Lock,
  MessageSquare,
  Save,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";

const DEV = process.env.NODE_ENV === "development";

const ProjectCharterEditor = dynamic(() => import("./ProjectCharterEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-[#8a7d68]">Loading editor...</div>,
});

const ProjectCharterSectionEditor = dynamic(() => import("./ProjectCharterSectionEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-[#8a7d68]">Loading sections...</div>,
});

const CharterV2DebugPanel = DEV
  ? dynamic(() => import("@/components/editors/CharterV2DebugPanel"), { ssr: false, loading: () => null })
  : ((() => null) as any);

/* ---------------------------------------------
   Approver comment types
---------------------------------------------- */

export type SectionComment = {
  id: string;
  sectionKey: string;
  sectionTitle: string;
  text: string;
  createdAt: string;
};

/* ---------------------------------------------
   UK formatting + bullet normalization
---------------------------------------------- */

function formatDateTimeUK(isoLike: string | null | undefined) {
  const s = String(isoLike ?? "").trim();
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return formatDateTimeAuto(s);
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return formatDateTimeAuto(s);
  }
}

function fmtWhenLocal(x: string | null) {
  return formatDateTimeUK(x ?? undefined);
}

function normalizeBulletLine(line: string) {
  let s = String(line ?? "");
  const re = /^\s*(?:[-\*\u2022\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/;
  for (let i = 0; i < 6; i++) {
    const next = s.replace(re, "");
    if (next === s) break;
    s = next;
  }
  return s;
}

function normalizeBulletsText(text: string) {
  const raw = String(text ?? "");
  const lines = raw.split("\n");
  const cleaned = lines.map((l) => normalizeBulletLine(l));
  return cleaned.join("\n");
}

type RowObj = { type: "header" | "data"; cells: string[] };

type V2Section = {
  key: string;
  title: string;
  bullets?: string;
  table?: { columns: number; rows: RowObj[] };
  columns?: string[];
  rows?: string[][];
};

function safeString(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isV2(x: any) {
  return !!x && typeof x === "object" && Number((x as any).version) === 2 && Array.isArray((x as any).sections);
}

function clone<T>(x: T): T {
  try {
    return structuredClone(x);
  } catch {
    return JSON.parse(JSON.stringify(x));
  }
}

const REQUIRED_SECTIONS: Array<{
  key: string;
  title: string;
  kind: "bullets" | "table";
  headers?: string[];
}> = [
  { key: "business_case", title: "1. Business Case", kind: "bullets" },
  { key: "objectives", title: "2. Objectives", kind: "bullets" },
  { key: "scope_in_out", title: "3. Scope (In / Out of Scope)", kind: "table", headers: ["In Scope", "Out of Scope"] },
  { key: "key_deliverables", title: "4. Key Deliverables", kind: "bullets" },
  {
    key: "milestones_timeline",
    title: "5. Milestones & Timeline",
    kind: "table",
    headers: ["Milestone", "Target Date", "Actual Date", "Notes"],
  },
  { key: "financials", title: "6. Financials", kind: "table", headers: ["Item", "Amount", "Currency", "Notes"] },
  { key: "risks", title: "7. Risks", kind: "bullets" },
  { key: "issues", title: "8. Issues", kind: "bullets" },
  { key: "assumptions", title: "9. Assumptions", kind: "bullets" },
  { key: "dependencies", title: "10. Dependencies", kind: "bullets" },
  {
    key: "project_team",
    title: "11. Project Team",
    kind: "table",
    headers: ["Role", "Name", "Organisation", "Responsibilities / Notes"],
  },
  {
    key: "stakeholders",
    title: "12. Stakeholders",
    kind: "table",
    headers: ["Stakeholder", "Role/Interest", "Influence", "Engagement / Notes"],
  },
  {
    key: "approval_committee",
    title: "13. Approval / Review Committee",
    kind: "table",
    headers: ["Role", "Name", "Date", "Decision/Notes"],
  },
];

function buildEmptyTable(headers: string[]): { columns: number; rows: RowObj[] } {
  const cols = Math.max(1, headers.length);
  return {
    columns: cols,
    rows: [
      { type: "header", cells: headers.map((h) => safeString(h)) },
      { type: "data", cells: Array.from({ length: cols }, () => "") },
      { type: "data", cells: Array.from({ length: cols }, () => "") },
    ],
  };
}

function stripNumberPrefix(title: string) {
  return String(title ?? "").replace(/^\s*\d+\.\s*/, "").trim();
}

function ensureCanonicalCharter(input: any) {
  let base: any;

  if (isV2(input)) {
    base = clone(input);
  } else if (input && typeof input === "object" && Array.isArray((input as any)?.content?.sections)) {
    base = {
      version: 2,
      type: "project_charter",
      meta: (input as any)?.meta ?? {},
      sections: (input as any).content.sections,
    };
  } else {
    base = isV2(PROJECT_CHARTER_TEMPLATE)
      ? clone(PROJECT_CHARTER_TEMPLATE)
      : { version: 2, type: "project_charter", meta: {}, sections: [] as V2Section[] };
  }

  base.version = 2;
  base.type = base.type || "project_charter";
  base.meta = base.meta && typeof base.meta === "object" ? base.meta : {};
  base.sections = Array.isArray(base.sections) ? base.sections : [];

  const byKey = new Map<string, V2Section>();
  for (const s of base.sections as V2Section[]) {
    const k = safeString((s as any)?.key || "").toLowerCase().trim();
    if (!k) continue;
    byKey.set(k, s);
  }

  const nextSections: V2Section[] = REQUIRED_SECTIONS.map((req) => {
    const existing = byKey.get(req.key.toLowerCase());
    if (existing) {
      const s = clone(existing);
      s.key = req.key;
      s.title = req.title;

      if (req.kind === "table") {
        const hasTable = (s.table && Array.isArray(s.table.rows)) || Array.isArray(s.columns) || Array.isArray(s.rows);
        if (!hasTable) {
          s.table = buildEmptyTable(req.headers ?? ["", "", "", ""]);
          s.bullets = undefined;
          s.columns = undefined;
          s.rows = undefined;
        }

        if (req.key === "financials" && s.table) {
          const t = s.table;
          const currencyIdx = 2;
          for (const r of t.rows ?? []) {
            if (r.type !== "data") continue;
            const cells = Array.isArray(r.cells) ? r.cells : [];
            while (cells.length < (t.columns || 4)) cells.push("");
            if (!safeString(cells[currencyIdx] ?? "").trim()) cells[currencyIdx] = "GBP";
            r.cells = cells;
          }
        }
      }

      if (req.kind === "bullets") {
        const hasBullets = typeof s.bullets === "string";
        const hasAnyTable = !!(s.table || s.columns || s.rows);
        if (!hasBullets && !hasAnyTable) s.bullets = "";
        if (typeof s.bullets === "string") s.bullets = normalizeBulletsText(s.bullets);
      }

      return s;
    }

    if (req.kind === "table") {
      const t = buildEmptyTable(req.headers ?? ["", "", "", ""]);
      if (req.key === "financials") {
        const currencyIdx = 2;
        for (const r of t.rows) {
          if (r.type !== "data") continue;
          while (r.cells.length < t.columns) r.cells.push("");
          if (!safeString(r.cells[currencyIdx] ?? "").trim()) r.cells[currencyIdx] = "GBP";
        }
      }
      return { key: req.key, title: req.title, table: t };
    }

    return { key: req.key, title: req.title, bullets: "" };
  });

  base.sections = nextSections;
  return base;
}

function stableSig(x: any) {
  try {
    return JSON.stringify(x ?? {});
  } catch {
    return String(x ?? "");
  }
}

type WireCaps = { full: boolean; section: boolean; suggest: boolean; validate: boolean };
type LegacyExports = { pdf?: string; docx?: string; xlsx?: string };

function safeFilenameBase(x: string) {
  const s = String(x || "project_charter").trim() || "project_charter";
  return s.replace(/[^a-z0-9]+/gi, "_");
}

function LegacyLinks({ legacy }: { legacy?: LegacyExports | null }) {
  const hasAny = !!(legacy?.pdf || legacy?.docx || legacy?.xlsx);
  if (!hasAny) return null;
  return (
    <div className="flex items-center gap-3 text-xs" style={{ color: "#8a7d68" }}>
      <span className="font-semibold uppercase tracking-wider text-[10px]" style={{ color: "#6b5c3e" }}>Legacy:</span>
      {legacy?.pdf && <a className="hover:underline font-medium" style={{ color: "#b8975a" }} href={legacy.pdf} target="_blank" rel="noreferrer">PDF</a>}
      {legacy?.docx && <a className="hover:underline font-medium" style={{ color: "#b8975a" }} href={legacy.docx} target="_blank" rel="noreferrer">DOCX</a>}
      {legacy?.xlsx && <a className="hover:underline font-medium" style={{ color: "#b8975a" }} href={legacy.xlsx} target="_blank" rel="noreferrer">XLSX</a>}
    </div>
  );
}

function applyProjectMetaDefaults(doc: any, defaults: { projectTitle?: string; projectManagerName?: string }) {
  const d = ensureCanonicalCharter(doc);
  const meta = d.meta && typeof d.meta === "object" ? d.meta : {};
  const next = { ...meta };
  const title = String(defaults.projectTitle ?? "").trim();
  const pm = String(defaults.projectManagerName ?? "").trim();
  if (!String((next as any).project_title ?? "").trim() && title) (next as any).project_title = title;
  if (!String((next as any).project_manager ?? "").trim() && pm) (next as any).project_manager = pm;
  const changed =
    String((next as any).project_title ?? "") !== String((meta as any).project_title ?? "") ||
    String((next as any).project_manager ?? "") !== String((meta as any).project_manager ?? "");
  return changed ? { ...d, meta: next } : d;
}

function getPmBrief(meta: any) {
  const v = meta && typeof meta === "object" ? (meta as any).pm_brief : "";
  return typeof v === "string" ? v : "";
}

function setPmBriefInMeta(prevDoc: any, brief: string) {
  const cur = ensureCanonicalCharter(prevDoc);
  const meta = cur?.meta && typeof cur.meta === "object" ? cur.meta : {};
  return { ...cur, meta: { ...meta, pm_brief: String(brief ?? "") } };
}

function isNonEmptyString(x: any) {
  return typeof x === "string" && x.trim().length > 0;
}

function mergeAiFullIntoCharter(prevDoc: any, ai: any) {
  const candidate = (ai && typeof ai === "object" && ((ai as any).charterV2 || (ai as any).doc)) || ai;
  const raw = (candidate as any)?.charterV2 ?? (candidate as any)?.doc ?? candidate;
  const canon = ensureCanonicalCharter(raw);
  const prevCanon = ensureCanonicalCharter(prevDoc);
  const prevMeta = prevCanon.meta && typeof prevCanon.meta === "object" ? prevCanon.meta : {};
  const nextMeta = canon.meta && typeof canon.meta === "object" ? canon.meta : {};
  const pmBrief = getPmBrief(prevMeta);
  const mergedMeta = { ...prevMeta, ...nextMeta, pm_brief: pmBrief };
  const nextSections = Array.isArray(canon.sections)
    ? canon.sections.map((s: any) => {
        const sec = { ...s };
        if (typeof sec.bullets === "string") sec.bullets = normalizeBulletsText(sec.bullets);
        return sec;
      })
    : [];
  return { ...canon, meta: mergedMeta, sections: nextSections };
}

function extractPatchFromAny(ai: any): any | null {
  if (!ai || typeof ai !== "object") return null;
  if ((ai as any).patch && typeof (ai as any).patch === "object" && (ai as any).patch.kind) return (ai as any).patch;
  if ((ai as any).kind) return ai;
  return null;
}

function applyReplaceSection(prevDoc: any, sectionKey: string, incomingSection: any) {
  const key = String(sectionKey || "").trim();
  if (!key) return ensureCanonicalCharter(prevDoc);
  const prev = ensureCanonicalCharter(prevDoc);
  const incoming = incomingSection && typeof incomingSection === "object" ? { ...incomingSection } : { key };
  incoming.key = key;
  if (typeof incoming.bullets === "string") incoming.bullets = normalizeBulletsText(incoming.bullets);
  const next = {
    ...prev,
    sections: (prev.sections || []).map((s: any) => (String(s?.key ?? "").trim() === key ? { ...s, ...incoming } : s)),
  };
  return ensureCanonicalCharter(next);
}

function applyAiResultToDoc(prevDoc: any, sectionKey: string, data: any) {
  const patch = extractPatchFromAny(data);
  if (patch?.kind === "replace_all") {
    const rawDoc = patch.doc ?? (data as any)?.charterV2 ?? (data as any)?.doc ?? data;
    return ensureCanonicalCharter(rawDoc);
  }
  if (patch?.kind === "replace_section") {
    const k = String(patch.key || (data as any)?.sectionKey || sectionKey || "").trim();
    const sec = patch.section ?? (data as any)?.section ?? (data as any)?.sections?.[0] ?? null;
    if (!k || !sec) return ensureCanonicalCharter(prevDoc);
    return applyReplaceSection(prevDoc, k, sec);
  }
  const k2 = String((data as any)?.sectionKey || sectionKey || "").trim();
  const sec2 = (data as any)?.section ?? (Array.isArray((data as any)?.sections) ? (data as any).sections[0] : null);
  if (k2 && sec2) return applyReplaceSection(prevDoc, k2, sec2);
  const candidate = (data && typeof data === "object" && ((data as any).charterV2 || (data as any).doc)) || data;
  const raw = (candidate as any)?.charterV2 ?? (candidate as any)?.doc ?? candidate;
  if (raw?.section && typeof raw.section === "object") return applyReplaceSection(prevDoc, k2 || sectionKey, raw.section);
  if (Array.isArray(raw?.sections)) {
    const keyLower = String(sectionKey || "").trim().toLowerCase();
    const found = raw.sections.find((s: any) => String(s?.key ?? "").toLowerCase().trim() === keyLower);
    if (found) return applyReplaceSection(prevDoc, sectionKey, found);
    if (raw.sections.length === 1) return applyReplaceSection(prevDoc, sectionKey, raw.sections[0]);
  }
  return ensureCanonicalCharter(prevDoc);
}

function coerceWireCaps(payload: any): WireCaps | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload.capabilities && typeof payload.capabilities === "object" ? payload.capabilities : payload;
  if (!root || typeof root !== "object") return null;
  const full = (root as any).full;
  const section = (root as any).section;
  const suggest = (root as any).suggest;
  const validate = (root as any).validate;
  if (typeof full !== "boolean" && typeof section !== "boolean" && typeof suggest !== "boolean" && typeof validate !== "boolean") return null;
  return {
    full: typeof full === "boolean" ? full : true,
    section: typeof section === "boolean" ? section : true,
    suggest: typeof suggest === "boolean" ? suggest : true,
    validate: typeof validate === "boolean" ? validate : true,
  };
}

function getReviewStateMeta({
  readOnly,
  lockLayout,
  approvalStatus,
  isApproverMode,
}: {
  readOnly?: boolean;
  lockLayout?: boolean;
  approvalStatus?: string | null;
  isApproverMode?: boolean;
}) {
  const status = String(approvalStatus ?? "").trim().toLowerCase();

  if (isApproverMode) {
    return {
      tone: "blue" as const,
      title: "Review access enabled",
      body: "The charter remains fully readable for governance review. Add section comments and request changes without visually degrading the document.",
      icon: Eye,
      chip: "Approver review",
    };
  }

  if (status === "approved") {
    return {
      tone: "emerald" as const,
      title: "Approved and baselined",
      body: "This charter is locked for editing and preserved as a readable official document for audit, reporting, and executive review.",
      icon: ShieldCheck,
      chip: "Baselined",
    };
  }

  if (status === "rejected") {
    return {
      tone: "rose" as const,
      title: "Rejected — read-only",
      body: "The current revision remains visible for traceability, but editing is disabled until a new revision is created.",
      icon: FileLock2,
      chip: "Rejected",
    };
  }

  if (readOnly || lockLayout) {
    return {
      tone: "slate" as const,
      title: lockLayout ? "Layout locked" : "Read-only document mode",
      body: "Readability is preserved. Controls are limited, but the document remains fully visible and suitable for review.",
      icon: Lock,
      chip: lockLayout ? "Locked" : "Read-only",
    };
  }

  return {
    tone: "amber" as const,
    title: "Editing enabled",
    body: "This is the working charter surface. Changes autosave and can be prepared for formal approval.",
    icon: Sparkles,
    chip: "Drafting",
  };
}

function getReviewToneStyles(tone: "emerald" | "blue" | "slate" | "rose" | "amber") {
  switch (tone) {
    case "emerald":
      return {
        card: { background: "linear-gradient(135deg, rgba(236,253,245,0.95) 0%, rgba(240,253,244,0.88) 100%)", border: "1px solid rgba(16,185,129,0.22)" },
        icon: { background: "rgba(16,185,129,0.12)", color: "#047857" },
        chip: { background: "#ffffff", color: "#065f46", border: "1px solid rgba(16,185,129,0.22)" },
        title: "#065f46",
        body: "#047857",
      };
    case "blue":
      return {
        card: { background: "linear-gradient(135deg, rgba(239,246,255,0.95) 0%, rgba(237,245,255,0.88) 100%)", border: "1px solid rgba(59,130,246,0.20)" },
        icon: { background: "rgba(59,130,246,0.12)", color: "#1d4ed8" },
        chip: { background: "#ffffff", color: "#1e40af", border: "1px solid rgba(59,130,246,0.22)" },
        title: "#1e3a8a",
        body: "#1d4ed8",
      };
    case "rose":
      return {
        card: { background: "linear-gradient(135deg, rgba(254,242,242,0.95) 0%, rgba(255,245,245,0.88) 100%)", border: "1px solid rgba(244,63,94,0.20)" },
        icon: { background: "rgba(244,63,94,0.12)", color: "#be123c" },
        chip: { background: "#ffffff", color: "#9f1239", border: "1px solid rgba(244,63,94,0.22)" },
        title: "#881337",
        body: "#9f1239",
      };
    case "amber":
      return {
        card: { background: "linear-gradient(135deg, rgba(255,251,235,0.95) 0%, rgba(254,249,228,0.88) 100%)", border: "1px solid rgba(217,119,6,0.20)" },
        icon: { background: "rgba(217,119,6,0.12)", color: "#b45309" },
        chip: { background: "#ffffff", color: "#92400e", border: "1px solid rgba(217,119,6,0.22)" },
        title: "#78350f",
        body: "#92400e",
      };
    default:
      return {
        card: { background: "linear-gradient(135deg, rgba(248,250,252,0.95) 0%, rgba(241,245,249,0.88) 100%)", border: "1px solid rgba(148,163,184,0.22)" },
        icon: { background: "rgba(148,163,184,0.14)", color: "#475569" },
        chip: { background: "#ffffff", color: "#334155", border: "1px solid rgba(148,163,184,0.22)" },
        title: "#0f172a",
        body: "#475569",
      };
  }
}

/* ---------------------------------------------
   Approver Comments Panel
---------------------------------------------- */

function ApproverCommentsPanel({
  comments,
  onDelete,
  onRequestChanges,
  requestChangesLoading,
}: {
  comments: SectionComment[];
  onDelete: (id: string) => void;
  onRequestChanges: (comments: SectionComment[]) => void;
  requestChangesLoading: boolean;
}) {
  const [panelOpen, setPanelOpen] = useState(false);

  if (comments.length === 0 && !panelOpen) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
        style={{
          background: "linear-gradient(135deg, #eff6ff 0%, #f8fbff 100%)",
          border: "1px dashed rgba(59,130,246,0.35)",
          fontFamily: "'DM Sans', sans-serif",
          color: "#1d4ed8",
        }}
      >
        <MessageSquare className="h-4 w-4 shrink-0" />
        <span>Use <strong>"Add Comment"</strong> on any section below to leave governance feedback for the submitter.</span>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: "1px solid rgba(59,130,246,0.18)",
        background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
        boxShadow: "0 8px 32px rgba(30,64,175,0.06)",
      }}
    >
      <button
        type="button"
        className="w-full flex items-center justify-between px-5 py-4"
        onClick={() => setPanelOpen((v) => !v)}
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #dbeafe, #bfdbfe)", border: "1px solid #93c5fd" }}
          >
            <MessageSquare className="h-4 w-4" style={{ color: "#1d4ed8" }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: "#0f172a" }}>
            Review Comments
          </span>
          {comments.length > 0 && (
            <span
              className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-[11px] font-bold"
              style={{ background: "#2563eb", color: "white" }}
            >
              {comments.length}
            </span>
          )}
        </div>
        <ChevronDown
          className="h-4 w-4 transition-transform"
          style={{ color: "#64748b", transform: panelOpen ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {panelOpen && (
        <div className="px-5 pb-5 space-y-4">
          <div className="h-px" style={{ background: "linear-gradient(90deg, transparent, #cbd5e1, transparent)" }} />

          {comments.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: "#64748b", fontFamily: "'DM Sans', sans-serif" }}>
              No comments yet. Add comments to sections below.
            </p>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: "#f8fbff", border: "1px solid #dbeafe" }}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[10px] font-bold uppercase tracking-wider mb-1"
                      style={{ color: "#1d4ed8", fontFamily: "'DM Sans', sans-serif" }}
                    >
                      {c.sectionTitle}
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: "#334155", fontFamily: "'DM Sans', sans-serif" }}>
                      {c.text}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    className="shrink-0 rounded-lg p-1.5 transition-all"
                    style={{ color: "#94a3b8" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.color = "#dc2626";
                      (e.currentTarget as HTMLElement).style.background = "#fee2e2";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.color = "#94a3b8";
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                    title="Remove comment"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: "linear-gradient(135deg, #eff6ff, #f8fbff)", border: "1px solid #93c5fd" }}
          >
            <p className="text-xs leading-relaxed" style={{ color: "#1e40af", fontFamily: "'DM Sans', sans-serif" }}>
              {comments.length > 0
                ? `${comments.length} comment${comments.length > 1 ? "s" : ""} will be sent to the submitter alongside your request for changes.`
                : "Add comments to sections above, then request changes. The submitter will see your feedback."}
            </p>
            <button
              type="button"
              disabled={comments.length === 0 || requestChangesLoading}
              onClick={() => onRequestChanges(comments)}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: comments.length > 0 ? "linear-gradient(135deg, #2563eb, #1d4ed8)" : "#dbeafe",
                color: comments.length > 0 ? "white" : "#93c5fd",
                border: "none",
                cursor: comments.length > 0 ? "pointer" : "not-allowed",
                opacity: requestChangesLoading ? 0.7 : 1,
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {requestChangesLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CornerDownLeft className="h-4 w-4" />
              )}
              {requestChangesLoading ? "Sending..." : "Request Changes with Comments"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------
   Approver Banner
---------------------------------------------- */

function ApproverBanner({ commentCount }: { commentCount: number }) {
  return (
    <div
      className="flex items-start gap-3 px-5 py-4 rounded-xl"
      style={{
        background: "linear-gradient(135deg, rgba(30,58,138,0.05) 0%, rgba(59,130,246,0.04) 100%)",
        border: "1px solid rgba(59,130,246,0.2)",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <Shield className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#1d4ed8" }} />
      <div className="flex-1">
        <p className="text-sm font-semibold" style={{ color: "#1e3a8a" }}>
          Approver Review Mode
        </p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "#3b5998" }}>
          The document is fully visible below. Use <strong>"Add Comment"</strong> on any section to leave inline feedback,
          then use the <strong>"Request Changes"</strong> panel to send your comments back to the submitter.
          {commentCount > 0 && (
            <span className="ml-1 font-semibold" style={{ color: "#1d4ed8" }}>
              {commentCount} comment{commentCount > 1 ? "s" : ""} added so far.
            </span>
          )}
        </p>
      </div>
      {commentCount > 0 && (
        <span
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{ background: "#dbeafe", color: "#1e40af", border: "1px solid #bfdbfe" }}
        >
          <CheckCheck className="h-3 w-3" />
          {commentCount} note{commentCount > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------
   Main component
---------------------------------------------- */

export default function ProjectCharterEditorFormLazy({
  projectId,
  artifactId,
  initialJson,
  readOnly,
  lockLayout = false,
  artifactVersion,
  projectTitle,
  projectManagerName,
  legacyExports,
  approvalEnabled = false,
  canSubmitOrResubmit = false,
  approvalStatus = null,
  submitForApprovalAction = null,
  isApprover = false,
  onRequestChangesWithComments = null,
}: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly?: boolean;
  lockLayout?: boolean;
  artifactVersion?: number;
  projectTitle?: string;
  projectManagerName?: string;
  legacyExports?: LegacyExports;
  approvalEnabled?: boolean;
  canSubmitOrResubmit?: boolean;
  approvalStatus?: string | null;
  submitForApprovalAction?: ((formData: FormData) => Promise<void>) | (() => Promise<void>) | null;
  isApprover?: boolean;
  onRequestChangesWithComments?: ((comments: SectionComment[]) => Promise<void>) | null;
}) {
  const router = useRouter();
  const lastLocalEditAtRef = useRef<number>(0);

  const [doc, setDoc] = useState<any>(() =>
    applyProjectMetaDefaults(ensureCanonicalCharter(initialJson), { projectTitle, projectManagerName })
  );
  const [isPending, startTransition] = useTransition();

  const [mounted, setMounted] = useState(false);
  const [lastSavedIso, setLastSavedIso] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "queued">("idle");
  const [autosaveError, setAutosaveError] = useState<string>("");
  const failedSigRef = useRef<string | null>(null);

  const [aiState, setAiState] = useState<"idle" | "generating" | "error">("idle");
  const [aiError, setAiError] = useState<string>("");
  const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);

  const [pmBrief, setPmBrief] = useState<string>(() => getPmBrief((ensureCanonicalCharter(initialJson) as any)?.meta));
  const [aiFullBusy, setAiFullBusy] = useState(false);

  const [wireCaps, setWireCaps] = useState<WireCaps>({ full: true, section: true, suggest: true, validate: true });

  const [exportBusy, setExportBusy] = useState<null | "pdf" | "docx">(null);
  const [exportErr, setExportErr] = useState<string>("");

  const [approverComments, setApproverComments] = useState<SectionComment[]>([]);
  const [requestChangesLoading, setRequestChangesLoading] = useState(false);

  const approvalStatusLower = String(approvalStatus || "").toLowerCase().trim();
  const isApproverMode =
    isApprover &&
    readOnly &&
    (
      approvalStatusLower === "submitted" ||
      approvalStatusLower === "pending" ||
      approvalStatusLower === "under_review" ||
      approvalStatusLower === "pending_approval" ||
      approvalStatusLower === "in_review" ||
      approvalStatusLower === "awaiting_approval" ||
      approvalStatusLower === "submitted_for_approval"
    );

  function addApproverComment(sectionKey: string, sectionTitle: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const comment: SectionComment = {
      id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sectionKey,
      sectionTitle,
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    setApproverComments((prev) => [...prev, comment]);
  }

  function deleteApproverComment(id: string) {
    setApproverComments((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleRequestChangesWithComments(comments: SectionComment[]) {
    if (!onRequestChangesWithComments) return;
    setRequestChangesLoading(true);
    try {
      await onRequestChangesWithComments(comments);
    } finally {
      setRequestChangesLoading(false);
    }
  }

  const commentCountBySection = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of approverComments) {
      map[c.sectionKey] = (map[c.sectionKey] || 0) + 1;
    }
    return map;
  }, [approverComments]);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);
  const pendingSigRef = useRef<string | null>(null);

  function markDirty() {
    lastLocalEditAtRef.current = Date.now();
    setDirty(true);
    setAutosaveError("");
    failedSigRef.current = null;
  }

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const title = String(projectTitle ?? "").trim();
    const pm = String(projectManagerName ?? "").trim();
    if (!title && !pm) return;
    setDoc((prev: any) => {
      const next = applyProjectMetaDefaults(prev, { projectTitle, projectManagerName });
      const prevMeta = ensureCanonicalCharter(prev)?.meta ?? {};
      const nextMeta = ensureCanonicalCharter(next)?.meta ?? {};
      const changed =
        String((prevMeta as any)?.project_title ?? "") !== String((nextMeta as any)?.project_title ?? "") ||
        String((prevMeta as any)?.project_manager ?? "") !== String((nextMeta as any)?.project_manager ?? "");
      if (changed) {
        lastLocalEditAtRef.current = Date.now();
        setDirty(true);
      }
      return next;
    });
  }, [projectTitle, projectManagerName]);

  useEffect(() => {
    let cancelled = false;
    async function detectCaps() {
      try {
        const res = await fetch("/api/wireai/capabilities", { method: "GET", cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const next = coerceWireCaps(data);
        if (!next) return;
        if (!cancelled) setWireCaps(next);
      } catch {}
    }
    void detectCaps();
    return () => {
      cancelled = true;
    };
  }, []);

  const incomingSig = useMemo(() => stableSig(initialJson), [initialJson]);
  const adoptedSigRef = useRef(incomingSig);

  const v2ForSave = useMemo(() => {
    const d = ensureCanonicalCharter(doc);
    return {
      version: 2 as const,
      type: "project_charter" as const,
      meta: d?.meta ?? {},
      sections: Array.isArray(d?.sections) ? d.sections : [],
    };
  }, [doc]);

  const localSig = useMemo(() => stableSig(v2ForSave), [v2ForSave]);

  useEffect(() => {
    if (dirty) return;
    const sinceEdit = Date.now() - (lastLocalEditAtRef.current || 0);
    if (sinceEdit < 2000) return;
    if (incomingSig === adoptedSigRef.current) return;
    if (incomingSig !== localSig) return;
    adoptedSigRef.current = incomingSig;
    const next = applyProjectMetaDefaults(ensureCanonicalCharter(initialJson), { projectTitle, projectManagerName });
    setDoc(next);
    const serverPmBrief = getPmBrief((ensureCanonicalCharter(initialJson) as any)?.meta);
    setPmBrief((cur) => (cur.trim().length ? cur : serverPmBrief));
  }, [incomingSig, localSig, dirty, projectTitle, projectManagerName, initialJson]);

  const canEdit = !readOnly && !lockLayout;
  const isCanonicalV2 = isV2(doc);
  const sectionReadOnly = readOnly || lockLayout;

  const sectionsForEditor = useMemo(() => {
    const secs = Array.isArray(doc?.sections) ? doc.sections : [];
    return secs.map((s: any) => ({ ...s, title: stripNumberPrefix(String(s?.title ?? "")) }));
  }, [doc?.sections]);

  function saveNow(reason: "manual" | "autosave") {
    if (!canEdit) return;
    const payload = v2ForSave;
    const sigAtStart = stableSig(payload);
    const saveStartedAt = Date.now();

    startTransition(() => {
      void (async () => {
        if (reason === "autosave") {
          setAutosaveState("saving");
          pendingSigRef.current = sigAtStart;
          autosaveInFlightRef.current = true;
          try {
            await autosaveProjectCharterV2({ projectId, artifactId, charterV2: payload, clearLegacyContent: true });
            autosaveInFlightRef.current = false;
            pendingSigRef.current = null;
            setAutosaveError("");
            failedSigRef.current = null;
            setLastSavedIso(new Date().toISOString());
            adoptedSigRef.current = sigAtStart;
            if ((lastLocalEditAtRef.current || 0) <= saveStartedAt) {
              setDirty(false);
              setAutosaveState("idle");
            } else {
              setAutosaveState("queued");
            }
          } catch (e: any) {
            autosaveInFlightRef.current = false;
            failedSigRef.current = sigAtStart;
            setAutosaveError(String(e?.message ?? "Autosave failed"));
            setAutosaveState("idle");
          }
          return;
        }
        try {
          const res = await saveProjectCharterV2Manual({
            mode: "manual",
            projectId,
            artifactId,
            charterV2: payload,
            clearLegacyContent: true,
          });
          const newId = (res as any)?.newArtifactId ? String((res as any).newArtifactId) : "";
          adoptedSigRef.current = sigAtStart;
          setLastSavedIso(new Date().toISOString());
          setAutosaveError("");
          failedSigRef.current = null;
          setAutosaveState("idle");
          setDirty(false);
          if (newId && newId !== artifactId) {
            router.replace(`/projects/${projectId}/artifacts/${newId}`);
            router.refresh();
          }
        } catch (e: any) {
          setAutosaveError(String(e?.message ?? "Save failed"));
          setAutosaveState("idle");
        }
      })();
    });
  }

  useEffect(() => {
    if (!canEdit || !dirty) return;
    if (autosaveError && failedSigRef.current && failedSigRef.current === localSig) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      if (autosaveInFlightRef.current) {
        setAutosaveState("queued");
        return;
      }
      saveNow("autosave");
    }, 900);
    setAutosaveState((s) => (s === "idle" ? "queued" : s));
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [dirty, canEdit, localSig, autosaveError]);

  const badgeVersion = Number(artifactVersion ?? 1);

  async function exportCharter(kind: "pdf" | "docx") {
    setExportErr("");
    setExportBusy(kind);
    let effectiveArtifactId = artifactId;
    try {
      if (canEdit && dirty && !isPending) {
        const res = await saveProjectCharterV2Manual({
          mode: "manual",
          projectId,
          artifactId,
          charterV2: v2ForSave,
          clearLegacyContent: true,
        });
        const newId = (res as any)?.newArtifactId ? String((res as any).newArtifactId) : "";
        if (newId && newId !== artifactId) {
          effectiveArtifactId = newId;
          router.replace(`/projects/${projectId}/artifacts/${newId}`);
          router.refresh();
        }
        setLastSavedIso(new Date().toISOString());
        setDirty(false);
        setAutosaveState("idle");
        setAutosaveError("");
        failedSigRef.current = null;
      }
      const res = await fetch(`/api/artifacts/${effectiveArtifactId}/export/${kind}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept:
            kind === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        body: JSON.stringify({ projectId, content_json: v2ForSave }),
        cache: "no-store",
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        try {
          const j = JSON.parse(raw);
          throw new Error(String((j as any)?.error || (j as any)?.message || `Export failed (${res.status})`));
        } catch {
          throw new Error(raw?.trim() ? raw.slice(0, 300) : `Export failed (${res.status}). Check server logs.`);
        }
      }
      const blob = await res.blob();
      const disp = res.headers.get("content-disposition") || "";
      const m = disp.match(/filename="?([^"]+)"?/i);
      const fallback = `${safeFilenameBase("project_charter")}_${projectId.slice(0, 8)}.${kind}`;
      const filename = m?.[1] || fallback;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setExportErr(String(e?.message ?? e ?? "Export failed"));
    } finally {
      setExportBusy(null);
    }
  }

  const StatusDot = ({ state }: { state: typeof autosaveState }) => {
    const configs = {
      idle: { color: "#64748b", bg: "#e2e8f0", label: "Saved", pulse: false },
      saving: { color: "#2563eb", bg: "#dbeafe", label: "Saving...", pulse: true },
      queued: { color: "#b45309", bg: "#fde68a", label: "Pending", pulse: true },
    };
    const c = (configs as any)[state];
    return (
      <span className="inline-flex items-center gap-2 text-xs font-medium" style={{ color: c.color }}>
        <span className="relative flex h-2 w-2">
          {c.pulse && (
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ backgroundColor: c.color }}
            />
          )}
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: c.color }} />
        </span>
        {c.label}
      </span>
    );
  };

  const showSubmitAction =
    approvalEnabled &&
    canSubmitOrResubmit &&
    (approvalStatusLower === "draft" || approvalStatusLower === "changes_requested");

  const submitWired = !!submitForApprovalAction && showSubmitAction;
  const submitLabel =
    approvalStatusLower === "changes_requested" ? "Resubmit for approval" : "Submit for approval";
  const submitDisabled =
    !submitWired || !showSubmitAction || readOnly || lockLayout || isPending;
  const submitDisabledReason =
    !showSubmitAction
      ? "Submit is only available in Draft or Changes Requested status."
      : !submitWired
        ? "Submit action is not wired."
        : readOnly
          ? "View-only mode."
          : lockLayout
            ? "Layout is locked."
            : isPending
              ? "Please wait..."
              : "";

  async function generateFullCharter() {
    if (!canEdit) return;
    if (wireCaps.full === false) setAiError("AI generation appears disabled. Trying anyway...");
    else setAiError("");
    setAiState("generating");
    setAiLoadingKey("__full__");
    setAiFullBusy(true);
    try {
      const brief = String(pmBrief ?? "");
      setDoc((prev: any) => setPmBriefInMeta(prev, brief));
      markDirty();
      const docForRequest = setPmBriefInMeta(v2ForSave, brief);
      const systemPrompt = [
        "Act as a senior programme manager and PMO governance expert.",
        "Generate a complete, executive-ready Project Charter using best-practice (PRINCE2/PMBOK hybrid).",
        "Be concise, structured, and realistic for enterprise delivery.",
        "Flag assumptions clearly and avoid generic filler.",
        "Ensure objectives are measurable and aligned to business value.",
        "Write Business Case and Objectives as clear prose (short paragraphs), not a table.",
        "Write Risks, Issues, Assumptions, Dependencies as bullet points (one per line).",
      ].join("\n");
      const res = await fetch("/api/wireai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mode: "full",
          doc: docForRequest,
          meta: { ...((docForRequest as any).meta ?? {}), pm_brief: brief },
          template: "pmi",
          instructions: [
            systemPrompt,
            "Populate ALL sections of the Project Charter.",
            "For any uncertain item, prefix with [ASSUMPTION] or [TBC].",
            "Use concise, executive-friendly bullets.",
            "Keep tables structured and complete where possible.",
          ],
        }),
      });
      const text = await res.text().catch(() => "");
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        if (!res.ok) throw new Error(text?.trim() ? text.slice(0, 300) : `AI failed (${res.status})`);
      }
      if (!res.ok) throw new Error(String(data?.error ?? "AI full generation failed"));
      setDoc((prev: any) => mergeAiFullIntoCharter(prev, data));
      lastLocalEditAtRef.current = Date.now();
      setDirty(true);
      setAiError("");
    } catch (e: any) {
      setAiState("error");
      setAiError(String(e?.message ?? "AI full generation failed"));
    } finally {
      setAiLoadingKey(null);
      setAiState("idle");
      setAiFullBusy(false);
    }
  }

  async function regenerateSection(sectionKey: string) {
    if (!canEdit) return;
    const key = String(sectionKey || "").trim();
    if (!key) return;
    if (wireCaps.section === false) setAiError("Section regeneration appears disabled. Trying anyway...");
    else setAiError("");
    setAiState("generating");
    setAiLoadingKey(key);
    try {
      const docForRequest = setPmBriefInMeta(v2ForSave, String(pmBrief ?? ""));
      const res = await fetch("/api/wireai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mode: "section",
          sectionKey: key,
          doc: docForRequest,
          meta: { ...(docForRequest.meta ?? {}), pm_brief: String(pmBrief ?? "") },
          template: "pmi",
        }),
      });
      const rawText = await res.text().catch(() => "");
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        if (!res.ok) throw new Error(rawText?.trim() ? rawText.slice(0, 300) : `AI regeneration failed (${res.status})`);
      }
      if (!res.ok) throw new Error(String(data?.error ?? "AI regeneration failed"));
      setDoc((prev: any) => applyAiResultToDoc(prev, key, data));
      lastLocalEditAtRef.current = Date.now();
      setDirty(true);
      setAiError("");
    } catch (e: any) {
      setAiState("error");
      setAiError(String(e?.message ?? "AI regeneration failed"));
    } finally {
      setAiLoadingKey(null);
      setAiState("idle");
    }
  }

  async function improveSection(payload: ImproveSectionPayload) {
    if (!canEdit) return;
    if (wireCaps.suggest === false && wireCaps.section === false) setAiError("Improve appears disabled. Trying anyway...");
    else setAiError("");
    const key = String(payload?.sectionKey ?? "").trim();
    if (!key) return;
    setAiState("generating");
    setAiLoadingKey(key);
    try {
      const docForRequest = setPmBriefInMeta(v2ForSave, String(pmBrief ?? ""));
      const res = await fetch("/api/wireai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mode: "section",
          sectionKey: key,
          doc: docForRequest,
          meta: { ...(docForRequest.meta ?? {}), pm_brief: String(pmBrief ?? "") },
          template: "pmi",
          instructions: [
            "Improve the section content while keeping it realistic and executive-ready.",
            "Do not invent facts. If uncertain, mark [TBC] or [ASSUMPTION].",
            "Keep format consistent with the section type (table vs bullets/prose).",
          ],
        }),
      });
      const rawText = await res.text().catch(() => "");
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        if (!res.ok) throw new Error(rawText?.trim() ? rawText.slice(0, 300) : `AI improve failed (${res.status})`);
      }
      if (!res.ok) throw new Error(String(data?.error ?? "AI improve failed"));
      setDoc((prev: any) => applyAiResultToDoc(prev, key, data));
      lastLocalEditAtRef.current = Date.now();
      setDirty(true);
      setAiError("");
    } catch (e: any) {
      setAiState("error");
      setAiError(String(e?.message ?? "AI improve failed"));
    } finally {
      setAiLoadingKey(null);
      setAiState("idle");
    }
  }

  const pmBriefEmpty = !isNonEmptyString(pmBrief);
  const reviewMeta = getReviewStateMeta({ readOnly, lockLayout, approvalStatus, isApproverMode });
  const reviewTone = getReviewToneStyles(reviewMeta.tone);
  const ReviewIcon = reviewMeta.icon;

  return (
    <div
      className="max-w-7xl mx-auto px-4 py-6 space-y-6"
      style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap');

        .charter-parchment-header { background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); }
        .charter-parchment-body { background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); }
        .charter-gold-border { background: linear-gradient(90deg, #1e293b 0%, #475569 24%, #0f172a 55%, #64748b 100%); }

        .charter-btn {
          font-family: 'DM Sans', system-ui, sans-serif;
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 16px; border-radius: 12px;
          font-size: 13px; font-weight: 500;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #0f172a;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .charter-btn:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
        .charter-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        .charter-btn-primary {
          font-family: 'DM Sans', system-ui, sans-serif;
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 16px; border-radius: 12px;
          font-size: 13px; font-weight: 600;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          color: white; border: none; cursor: pointer;
          transition: all 0.2s ease;
        }
        .charter-btn-primary:hover:not(:disabled) { opacity: 0.96; transform: translateY(-1px); box-shadow: 0 10px 24px rgba(15,23,42,0.18); }
        .charter-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }

        .charter-btn-ai {
          font-family: 'DM Sans', system-ui, sans-serif;
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 16px; border-radius: 12px;
          font-size: 13px; font-weight: 600;
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%);
          background-size: 200% 200%;
          animation: goldenShimmer 3s ease infinite;
          color: white; border: none; cursor: pointer;
          transition: all 0.2s ease;
        }
        .charter-btn-ai:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(37,99,235,0.22); }
        .charter-btn-ai:disabled { opacity: 0.45; background: #94a3b8; animation: none; cursor: not-allowed; transform: none; }

        @keyframes goldenShimmer {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        .charter-brief-area {
          font-family: 'DM Sans', system-ui, sans-serif;
          width: 100%; border-radius: 14px;
          border: 1px solid #cbd5e1;
          background: rgba(255,255,255,0.98);
          padding: 12px 16px;
          font-size: 13px; color: #0f172a;
          line-height: 1.7; resize: vertical;
          transition: all 0.2s ease;
          outline: none;
        }
        .charter-brief-area::placeholder { color: #94a3b8; }
        .charter-brief-area:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.10); }

        .charter-error-bar {
          background: linear-gradient(135deg, rgba(254,242,242,0.96) 0%, rgba(255,247,247,0.92) 100%);
          border: 1px solid rgba(220,38,38,0.18);
          border-radius: 14px; padding: 12px 16px;
          font-family: 'DM Sans', system-ui, sans-serif;
          font-size: 13px; color: #991b1b;
          display: flex; align-items: center; gap: 10px;
        }

        .charter-readable-surface {
          position: relative;
          isolation: isolate;
        }

        .charter-readable-surface,
        .charter-readable-surface * {
          filter: none !important;
          backdrop-filter: none !important;
        }

        .charter-readable-surface > [style*="opacity"],
        .charter-readable-surface [style*="opacity"] {
          opacity: 1 !important;
        }

        .charter-readable-surface [class*="blur"],
        .charter-readable-surface [style*="blur"] {
          filter: none !important;
          backdrop-filter: none !important;
        }

        .charter-readable-surface [class*="pointer-events-none"] {
          pointer-events: auto !important;
        }

        .charter-readable-surface .charter-lock-mask,
        .charter-readable-surface .read-only-overlay,
        .charter-readable-surface [data-readonly-overlay="true"] {
          display: none !important;
        }

        .charter-readable-surface-readonly input:disabled,
        .charter-readable-surface-readonly textarea:disabled,
        .charter-readable-surface-readonly button:disabled,
        .charter-readable-surface-readonly select:disabled {
          opacity: 1 !important;
        }
      `}</style>

      <div className="charter-gold-border h-1.5 w-full rounded-t-2xl" />

      {isApproverMode && <ApproverBanner commentCount={approverComments.length} />}

      <div
        className="rounded-2xl overflow-hidden shadow-sm"
        style={{
          background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
          border: "1px solid #e2e8f0",
          boxShadow: "0 10px 30px rgba(15,23,42,0.05)",
        }}
      >
        <div className="px-8 pt-8 pb-6 border-b border-[#e2e8f0]">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-px w-8 bg-[#cbd5e1]" />
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.3em]"
                    style={{ color: "#64748b", fontFamily: "'DM Sans', sans-serif" }}
                  >
                    Official Document
                  </span>
                  <div className="h-px w-8 bg-[#cbd5e1]" />
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                  <h1
                    className="text-[26px] font-bold uppercase tracking-[0.06em]"
                    style={{ color: "#0f172a", letterSpacing: "0.06em" }}
                  >
                    Project Charter
                  </h1>

                  <span
                    className="px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border"
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      background: "#f8fafc",
                      color: "#334155",
                      borderColor: "#cbd5e1",
                    }}
                  >
                    v{badgeVersion}
                  </span>

                  {approvalEnabled && (
                    <span
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase"
                      style={{ background: "linear-gradient(135deg, #0f172a, #334155)", color: "#e2e8f0" }}
                    >
                      <Shield className="h-3 w-3" />
                      {String(approvalStatus || "draft").replace(/_/g, " ")}
                    </span>
                  )}

                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold"
                    style={reviewTone.chip}
                  >
                    <ReviewIcon className="h-3 w-3" />
                    {reviewMeta.chip}
                  </span>
                </div>

                <p className="text-sm" style={{ color: "#64748b", fontFamily: "'DM Sans', sans-serif" }}>
                  {isApproverMode
                    ? "Approver review — full document visible. Add comments to sections below."
                    : readOnly
                      ? "Readable document mode — locked for editing, preserved for governance."
                      : lockLayout
                        ? "Layout locked after submission"
                        : "Edit and manage your project charter"}
                </p>

                <LegacyLinks legacy={legacyExports ?? null} />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {!isApproverMode && <StatusDot state={autosaveState} />}

                {!isApproverMode && (
                  <button
                    type="button"
                    className="charter-btn"
                    disabled={!canEdit || isPending || autosaveState === "saving"}
                    onClick={() => saveNow("manual")}
                    title={!canEdit ? "Read-only / locked" : dirty ? "Save changes" : "No unsaved changes"}
                  >
                    <Save className="h-4 w-4" style={{ color: "#64748b" }} />
                    Save
                  </button>
                )}

                {approvalEnabled && showSubmitAction && (
                  submitWired ? (
                    <form action={submitForApprovalAction as any}>
                      <button
                        type="submit"
                        className="charter-btn-primary"
                        disabled={submitDisabled}
                        title={submitDisabled ? submitDisabledReason : undefined}
                      >
                        <Send className="h-4 w-4" />
                        {submitLabel}
                      </button>
                    </form>
                  ) : (
                    <button type="button" className="charter-btn-primary" disabled title={submitDisabledReason}>
                      <Send className="h-4 w-4" />
                      {submitLabel}
                    </button>
                  )
                )}

                {mounted ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="charter-btn" disabled={!!exportBusy}>
                        {exportBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" style={{ color: "#64748b" }} />
                        )}
                        {exportBusy ? "Exporting..." : "Export"}
                        <ChevronDown className="h-3 w-3 opacity-50" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-52 rounded-xl p-1.5"
                      style={{ background: "#ffffff", border: "1px solid #cbd5e1" }}
                    >
                      <DropdownMenuItem
                        onClick={() => exportCharter("pdf")}
                        disabled={!!exportBusy}
                        className="cursor-pointer rounded-lg px-3 py-2.5"
                      >
                        <FileText className="h-4 w-4 mr-3" style={{ color: "#2563eb" }} />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium" style={{ color: "#0f172a", fontFamily: "'DM Sans', sans-serif" }}>
                            Export PDF
                          </span>
                          <span className="text-[11px]" style={{ color: "#64748b", fontFamily: "'DM Sans', sans-serif" }}>
                            Board-ready document
                          </span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => exportCharter("docx")}
                        disabled={!!exportBusy}
                        className="cursor-pointer rounded-lg px-3 py-2.5"
                      >
                        <File className="h-4 w-4 mr-3" style={{ color: "#2563eb" }} />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium" style={{ color: "#0f172a", fontFamily: "'DM Sans', sans-serif" }}>
                            Export Word
                          </span>
                          <span className="text-[11px]" style={{ color: "#64748b", fontFamily: "'DM Sans', sans-serif" }}>
                            Editable document
                          </span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <button className="charter-btn" disabled>
                    <Download className="h-4 w-4" />
                    Export
                    <ChevronDown className="h-3 w-3 opacity-40" />
                  </button>
                )}
              </div>
            </div>

            <div
              className="rounded-2xl px-4 py-4"
              style={reviewTone.card}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-2xl shrink-0"
                  style={reviewTone.icon}
                >
                  <ReviewIcon className="h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <div
                    className="text-sm font-semibold"
                    style={{ color: reviewTone.title, fontFamily: "'DM Sans', sans-serif" }}
                  >
                    {reviewMeta.title}
                  </div>
                  <div
                    className="mt-1 text-sm leading-relaxed"
                    style={{ color: reviewTone.body, fontFamily: "'DM Sans', sans-serif" }}
                  >
                    {reviewMeta.body}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {autosaveError && (
          <div className="px-8 py-4 border-b border-[#e2e8f0]">
            <div className="charter-error-bar">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span><span className="font-semibold">Autosave failed:</span> {autosaveError}</span>
              <button
                type="button"
                className="charter-btn ml-auto"
                style={{ padding: "4px 12px", fontSize: "12px" }}
                disabled={!canEdit || isPending}
                onClick={() => {
                  setAutosaveError("");
                  failedSigRef.current = null;
                  saveNow("autosave");
                }}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {canEdit && (
          <div className="px-8 py-6 border-b border-[#e2e8f0]">
            <div
              className="rounded-2xl p-5"
              style={{
                background: "linear-gradient(135deg, rgba(239,246,255,0.75) 0%, rgba(248,250,252,0.95) 100%)",
                border: "1px solid #cbd5e1",
              }}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="h-4 w-4" style={{ color: "#2563eb" }} />
                    <span className="text-sm font-semibold" style={{ color: "#0f172a", fontFamily: "'DM Sans', sans-serif" }}>
                      PM Brief
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "#64748b", fontFamily: "'DM Sans', sans-serif" }}>
                    Provide context for AI generation — be specific about scope, constraints, assumptions, and goals.
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {pmBriefEmpty ? (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border"
                      style={{ background: "#fff7ed", borderColor: "#fdba74", color: "#9a3412", fontFamily: "'DM Sans', sans-serif" }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                      Recommended
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border"
                      style={{ background: "#eff6ff", borderColor: "#93c5fd", color: "#1d4ed8", fontFamily: "'DM Sans', sans-serif" }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      Ready
                    </span>
                  )}

                  <button
                    type="button"
                    className="charter-btn-ai"
                    disabled={!canEdit || isPending || aiState === "generating" || aiFullBusy}
                    onClick={() => generateFullCharter()}
                    title={pmBriefEmpty ? "Add a brief first (recommended)" : "Generate the full charter from your brief"}
                  >
                    {aiFullBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    Generate
                  </button>
                </div>
              </div>

              <textarea
                value={pmBrief}
                onChange={(e) => {
                  const v = e.target.value;
                  setPmBrief(v);
                  lastLocalEditAtRef.current = Date.now();
                  setDoc((prev: any) => setPmBriefInMeta(prev, v));
                  setDirty(true);
                }}
                rows={5}
                placeholder={[
                  "Act as a senior programme manager and PMO governance expert.",
                  "Generate a complete, executive-ready Project Charter using best-practice (PRINCE2/PMBOK hybrid).",
                  "Be concise, structured, and realistic for enterprise delivery.",
                  "Flag assumptions clearly and avoid generic filler.",
                  "Ensure objectives are measurable and aligned to business value.",
                ].join("\n")}
                className="charter-brief-area"
              />
            </div>
          </div>
        )}

        <div className="px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-medium" style={{ color: "#64748b", fontFamily: "'DM Mono', monospace" }}>
            {lastSavedIso ? <>Last saved {fmtWhenLocal(lastSavedIso)}</> : "—"}
          </div>
          {aiState === "error" && aiError && (
            <div
              className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 border"
              style={{ background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b", fontFamily: "'DM Sans', sans-serif" }}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {aiError}
            </div>
          )}
        </div>

        {exportErr && (
          <div className="px-8 pb-4">
            <div className="charter-error-bar">
              <AlertCircle className="h-4 w-4" />
              {exportErr}
            </div>
          </div>
        )}
      </div>

      {isApproverMode && (
        <ApproverCommentsPanel
          comments={approverComments}
          onDelete={deleteApproverComment}
          onRequestChanges={handleRequestChangesWithComments}
          requestChangesLoading={requestChangesLoading}
        />
      )}

      <div
        className={`
          charter-readable-surface
          ${sectionReadOnly ? "charter-readable-surface-readonly" : ""}
          rounded-2xl overflow-hidden shadow-sm
        `}
        style={{
          background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
          border: isApproverMode
            ? "1px solid rgba(59,130,246,0.20)"
            : sectionReadOnly
              ? "1px solid rgba(148,163,184,0.22)"
              : "1px solid #e2e8f0",
          minHeight: 600,
          boxShadow: sectionReadOnly
            ? "0 10px 30px rgba(15,23,42,0.04)"
            : "0 12px 32px rgba(15,23,42,0.06)",
          opacity: 1,
          filter: "none",
          backdropFilter: "none",
        }}
      >
        {isCanonicalV2 ? (
          <ProjectCharterSectionEditor
            meta={doc?.meta ?? {}}
            onMetaChange={(meta: any) => {
              markDirty();
              setDoc((prev: any) => {
                const cur = ensureCanonicalCharter(prev);
                return applyProjectMetaDefaults({ ...cur, meta }, { projectTitle, projectManagerName });
              });
            }}
            sections={sectionsForEditor}
            onChange={(sections: any) => {
              markDirty();
              setDoc((prev: any) =>
                applyProjectMetaDefaults(
                  ensureCanonicalCharter({ ...prev, sections }),
                  { projectTitle, projectManagerName }
                )
              );
            }}
            readOnly={sectionReadOnly}
            onImproveSection={(payload: ImproveSectionPayload) => improveSection(payload)}
            onRegenerateSection={(sectionKey: string) => regenerateSection(sectionKey)}
            aiDisabled={!canEdit || isPending || aiState === "generating"}
            aiLoadingKey={aiLoadingKey}
            approverMode={isApproverMode}
            approverCommentsBySection={commentCountBySection}
            onAddApproverComment={addApproverComment}
          />
        ) : (
          <ProjectCharterEditor
            initialJson={doc}
            onChange={(next: any) => {
              markDirty();
              setDoc(applyProjectMetaDefaults(next, { projectTitle, projectManagerName }));
            }}
            readOnly={readOnly}
            lockLayout={lockLayout}
          />
        )}
      </div>

      <div className="charter-gold-border h-1 w-full rounded-b-2xl" />

      {DEV ? <CharterV2DebugPanel value={v2ForSave} /> : null}
    </div>
  );
}