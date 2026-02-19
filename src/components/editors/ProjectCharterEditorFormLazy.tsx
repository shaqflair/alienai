// src/components/editors/ProjectCharterEditorFormLazy.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const ProjectCharterEditor = dynamic(() => import("./ProjectCharterEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-500">Loading editor…</div>,
});

const ProjectCharterClassicView = dynamic(() => import("./ProjectCharterClassicView"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-500">Loading classic view…</div>,
});

const ProjectCharterSectionEditor = dynamic(() => import("./ProjectCharterSectionEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-500">Loading sections…</div>,
});

const CharterV2DebugPanel = dynamic(() => import("@/components/editors/CharterV2DebugPanel"), {
  ssr: false,
  loading: () => null,
});

import { PROJECT_CHARTER_TEMPLATE } from "@/components/editors/charter-template";

import {
  autosaveProjectCharterV2,
  saveProjectCharterV2Manual,
} from "@/app/projects/[id]/artifacts/[artifactId]/charter-v2-actions";

import type { ImproveSectionPayload } from "./ProjectCharterSectionEditor";
import { formatDateTimeAuto } from "@/lib/date/format";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Download,
  FileText,
  File,
  Loader2,
  Sparkles,
  Save,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  Send,
  Wand2,
} from "lucide-react";

/* ---------------------------------------------
   UK formatting + bullet normalization
---------------------------------------------- */

function formatDateTimeUK(isoLike: string | null | undefined) {
  const s = String(isoLike ?? "").trim();
  if (!s) return "—";
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
  const re = /^\s*(?:[•\u2022\-\*\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/;
  for (let i = 0; i < 6; i++) {
    const next = s.replace(re, "");
    if (next === s) break;
    s = next;
  }
  return s; // do NOT trimEnd here; keeps typing stable
}
function normalizeBulletsText(text: string) {
  const raw = String(text ?? "");
  const lines = raw.split("\n");
  const cleaned = lines.map((l) => normalizeBulletLine(l));
  return cleaned.join("\n");
}

type ViewMode = "sections" | "classic";
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
  return (
    !!x &&
    typeof x === "object" &&
    Number((x as any).version) === 2 &&
    Array.isArray((x as any).sections)
  );
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
  {
    key: "scope_in_out",
    title: "3. Scope (In / Out of Scope)",
    kind: "table",
    headers: ["In Scope", "Out of Scope"],
  },
  { key: "key_deliverables", title: "4. Key Deliverables", kind: "bullets" },
  {
    key: "milestones_timeline",
    title: "5. Milestones & Timeline",
    kind: "table",
    headers: ["Milestone", "Target Date", "Actual Date", "Notes"],
  },
  {
    key: "financials",
    title: "6. Financials",
    kind: "table",
    headers: ["Item", "Amount", "Currency", "Notes"],
  },
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
        const hasTable =
          (s.table && Array.isArray(s.table.rows)) || Array.isArray(s.columns) || Array.isArray(s.rows);
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
            const cur = safeString(cells[currencyIdx] ?? "").trim();
            if (!cur) cells[currencyIdx] = "GBP";
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
        const firstData = t.rows.find((r) => r.type === "data");
        if (firstData) {
          while (firstData.cells.length < t.columns) firstData.cells.push("");
          if (!safeString(firstData.cells[currencyIdx] ?? "").trim()) firstData.cells[currencyIdx] = "GBP";
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
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span className="font-medium text-slate-600">Legacy:</span>
      {legacy?.pdf ? (
        <a className="underline hover:text-slate-700" href={legacy.pdf} target="_blank" rel="noreferrer">
          PDF
        </a>
      ) : null}
      {legacy?.docx ? (
        <a className="underline hover:text-slate-700" href={legacy.docx} target="_blank" rel="noreferrer">
          DOCX
        </a>
      ) : null}
      {legacy?.xlsx ? (
        <a className="underline hover:text-slate-700" href={legacy.xlsx} target="_blank" rel="noreferrer">
          XLSX
        </a>
      ) : null}
    </div>
  );
}

// ✅ Seed defaults from Project (only if meta is empty)
function applyProjectMetaDefaults(doc: any, defaults: { projectTitle?: string; projectManagerName?: string }) {
  const d = ensureCanonicalCharter(doc);
  const meta = d.meta && typeof d.meta === "object" ? d.meta : {};
  const next = { ...meta };

  const title = String(defaults.projectTitle ?? "").trim();
  const pm = String(defaults.projectManagerName ?? "").trim();

  if (!String(next.project_title ?? "").trim() && title) next.project_title = title;
  if (!String(next.project_manager ?? "").trim() && pm) next.project_manager = pm;

  const changed =
    String(next.project_title ?? "") !== String(meta.project_title ?? "") ||
    String(next.project_manager ?? "") !== String(meta.project_manager ?? "");

  if (changed) return { ...d, meta: next };
  return d;
}

/* ---------------------------------------------
   AI full-gen helpers (PM brief + patch apply)
---------------------------------------------- */

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
  const candidate =
    (ai && typeof ai === "object" && ((ai as any).charterV2 || (ai as any).doc)) || ai;

  const raw = (candidate as any)?.charterV2 ?? (candidate as any)?.doc ?? candidate;

  const canon = ensureCanonicalCharter(raw);

  const prevCanon = ensureCanonicalCharter(prevDoc);
  const prevMeta = prevCanon.meta && typeof prevCanon.meta === "object" ? prevCanon.meta : {};
  const nextMeta = canon.meta && typeof canon.meta === "object" ? canon.meta : {};
  const pmBrief = getPmBrief(prevMeta);

  const mergedMeta = {
    ...prevMeta,
    ...nextMeta,
    pm_brief: pmBrief,
  };

  const nextSections = Array.isArray(canon.sections)
    ? canon.sections.map((s: any) => {
        const sec = { ...s };
        if (typeof sec.bullets === "string") sec.bullets = normalizeBulletsText(sec.bullets);
        return sec;
      })
    : [];

  return { ...canon, meta: mergedMeta, sections: nextSections };
}

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
}: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly: boolean;
  lockLayout?: boolean;
  artifactVersion?: number;

  projectTitle?: string;
  projectManagerName?: string;

  legacyExports?: LegacyExports;
  approvalEnabled?: boolean;
  canSubmitOrResubmit?: boolean;
  approvalStatus?: string | null;

  submitForApprovalAction?: ((formData: FormData) => Promise<void>) | (() => Promise<void>) | null;
}) {
  const router = useRouter();

  // used to avoid clobbering active typing
  const lastLocalEditAtRef = useRef<number>(0);

  const [doc, setDoc] = useState<any>(() =>
    applyProjectMetaDefaults(ensureCanonicalCharter(initialJson), { projectTitle, projectManagerName })
  );
  const [isPending, startTransition] = useTransition();

  const [mounted, setMounted] = useState(false);
  const [lastSavedIso, setLastSavedIso] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("sections");
  const [dirty, setDirty] = useState(false);

  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "queued">("idle");

  const [aiState, setAiState] = useState<"idle" | "generating" | "error">("idle");
  const [aiError, setAiError] = useState<string>("");
  const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);

  // full-generation UI state (PM brief + button state)
  const [pmBrief, setPmBrief] = useState<string>(() =>
    getPmBrief((ensureCanonicalCharter(initialJson) as any)?.meta)
  );
  const [aiFullBusy, setAiFullBusy] = useState(false);

  // (kept as-is in your snippet; not wired in this file yet)
  const [improveOpen, setImproveOpen] = useState(false);
  const [improvePayload, setImprovePayload] = useState<ImproveSectionPayload | null>(null);
  const [improveNotes, setImproveNotes] = useState<string>("");
  const [improveRunning, setImproveRunning] = useState(false);
  const [improveError, setImproveError] = useState<string>("");

  const [improveSuggestions, setImproveSuggestions] = useState<{ id: string; label: string; section: any }[]>([]);
  const [improveSelectedId, setImproveSelectedId] = useState<string>("");

  const [wireCaps, setWireCaps] = useState<WireCaps>({
    full: true,
    section: false,
    suggest: false,
    validate: false,
  });

  const [exportBusy, setExportBusy] = useState<null | "pdf" | "docx">(null);
  const [exportErr, setExportErr] = useState<string>("");

  useEffect(() => setMounted(true), []);

  // ✅ If projectTitle / projectManagerName arrives after initial render, seed once (without overwriting manual edits)
  const seededDefaultsRef = useRef(false);
  useEffect(() => {
    if (seededDefaultsRef.current) return;

    const title = String(projectTitle ?? "").trim();
    const pm = String(projectManagerName ?? "").trim();
    if (!title && !pm) return;

    setDoc((prev: any) => {
      const next = applyProjectMetaDefaults(prev, { projectTitle, projectManagerName });
      const prevMeta = ensureCanonicalCharter(prev)?.meta ?? {};
      const nextMeta = ensureCanonicalCharter(next)?.meta ?? {};
      const changed =
        String(prevMeta?.project_title ?? "") !== String(nextMeta?.project_title ?? "") ||
        String(prevMeta?.project_manager ?? "") !== String(nextMeta?.project_manager ?? "");
      if (changed) {
        lastLocalEditAtRef.current = Date.now();
        setDirty(true);
      }
      return next;
    });

    seededDefaultsRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTitle, projectManagerName]);

  useEffect(() => {
    let cancelled = false;
    async function detectCaps() {
      try {
        const res = await fetch("/api/wireai/capabilities", { method: "GET", cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!data || typeof data !== "object") return;

        const next: WireCaps = {
          full: !!(data as any).full,
          section: !!(data as any).section,
          suggest: !!(data as any).suggest,
          validate: !!(data as any).validate,
        };

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

  // ✅ CRITICAL FIX:
  // Don’t adopt incoming server JSON if it’s older than our current local doc.
  // This prevents “I type and it disappears” after autosave when server data lags.
  useEffect(() => {
    // if user is actively editing, never adopt
    if (dirty) return;

    // if we edited very recently, don’t adopt (stabilizes UX)
    const sinceEdit = Date.now() - (lastLocalEditAtRef.current || 0);
    if (sinceEdit < 2000) return;

    // no change in incoming
    if (incomingSig === adoptedSigRef.current) return;

    // If incoming is not equal to what we already have locally, it’s likely stale → ignore.
    // We only adopt when server matches our local (or when local is empty/brand-new).
    if (incomingSig !== localSig) {
      return;
    }

    adoptedSigRef.current = incomingSig;

    const next = applyProjectMetaDefaults(ensureCanonicalCharter(initialJson), { projectTitle, projectManagerName });
    setDoc(next);

    // keep PM brief in sync if server has it (but only if user hasn't typed in this field)
    const serverPmBrief = getPmBrief((ensureCanonicalCharter(initialJson) as any)?.meta);
    setPmBrief((cur) => (cur.trim().length ? cur : serverPmBrief));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingSig, localSig, dirty, projectTitle, projectManagerName]);

  const canEdit = !readOnly && !lockLayout;
  const isCanonicalV2 = isV2(doc);
  const sectionReadOnly = readOnly || lockLayout;

  const sectionsForEditor = useMemo(() => {
    const secs = Array.isArray(doc?.sections) ? doc.sections : [];
    return secs.map((s: any) => ({ ...s, title: stripNumberPrefix(String(s?.title ?? "")) }));
  }, [doc?.sections]);

  function markDirty() {
    lastLocalEditAtRef.current = Date.now();
    setDirty(true);
  }

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);

 function saveNow(reason: "manual" | "autosave") {
  if (!canEdit) return;

  const payload = v2ForSave;
  const sigAtStart = stableSig(payload);
  const saveStartedAt = Date.now();

  startTransition(async () => {
    if (reason === "autosave") {
      setAutosaveState("saving");
      pendingSigRef.current = sigAtStart;
      autosaveInFlightRef.current = true;

      try {
        await autosaveProjectCharterV2({
          projectId,
          artifactId,
          charterV2: payload,
          clearLegacyContent: true,
        });

        markAutosaveSuccess();
        setLastSavedIso(new Date().toISOString());
        adoptedSigRef.current = sigAtStart;

        // ✅ Only mark clean if user hasn't typed since save started
        if ((lastLocalEditAtRef.current || 0) <= saveStartedAt) {
          setDirty(false);
          setAutosaveState("idle");
        } else {
          // user typed during save; stay dirty and queue next save
          setAutosaveState("queued");
        }
      } catch {
        markAutosaveFailure();
        setAutosaveState("queued");
      }
      return;
    }

    // manual branch unchanged...
  });
}

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
      setAutosaveState("idle");
      setDirty(false);

      if (newId && newId !== artifactId) {
        router.replace(`/projects/${projectId}/artifacts/${newId}`);
        router.refresh();
      }
    });
  }

  useEffect(() => {
    if (!canEdit) return;
    if (!dirty) return;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, canEdit, localSig]);

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
      }

      const endpoint = `/api/artifacts/${effectiveArtifactId}/export/${kind}`;

      const res = await fetch(endpoint, {
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
          throw new Error(String(j?.error || j?.message || `Export failed (${res.status})`));
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

  const StatusBadge = ({ state }: { state: typeof autosaveState }) => {
    const configs = {
      idle: {
        icon: CheckCircle2,
        color: "text-emerald-600",
        bg: "bg-emerald-50",
        border: "border-emerald-200",
        label: "Saved",
      },
      saving: {
        icon: Loader2,
        color: "text-blue-600",
        bg: "bg-blue-50",
        border: "border-blue-200",
        label: "Saving...",
      },
      queued: {
        icon: Clock,
        color: "text-amber-600",
        bg: "bg-amber-50",
        border: "border-amber-200",
        label: "Pending",
      },
    };
    const config = (configs as any)[state];
    const Icon = config.icon;
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.bg} ${config.border} ${config.color}`}
      >
        <Icon className={`h-3.5 w-3.5 ${state === "saving" ? "animate-spin" : ""}`} />
        {config.label}
      </span>
    );
  };

  const canShowSubmit = !!approvalEnabled;
  const submitWired = !!submitForApprovalAction;

  const submitLabel =
    String(approvalStatus || "").toLowerCase() === "changes_requested"
      ? "Resubmit for approval"
      : "Submit for approval";

  const submitDisabled = !submitWired || !canSubmitOrResubmit || readOnly || lockLayout || isPending;

  const submitDisabledReason = !submitWired
    ? "Submit action is not wired."
    : !canSubmitOrResubmit
    ? "You can’t submit right now (role/status/current revision)."
    : readOnly
    ? "View-only mode."
    : lockLayout
    ? "Layout is locked."
    : isPending
    ? "Please wait…"
    : "";

  function openImprove(payload: ImproveSectionPayload) {
    if (!canEdit) return;
    setImprovePayload(payload);
    setImproveNotes(payload?.notes ?? "");
    setImproveError("");
    setImproveOpen(true);
  }

  async function generateFullCharter() {
    if (!canEdit) return;
    if (!wireCaps.full) return;

    setAiError("");
    setAiState("generating");
    setAiLoadingKey("__full__");
    setAiFullBusy(true);

    try {
      const brief = String(pmBrief ?? "");

      // ✅ Update local doc immediately (UX), and also build a request payload that includes the brief
      // without relying on React state having re-rendered yet.
      setDoc((prev) => setPmBriefInMeta(prev, brief));
      markDirty();

      const docForRequest = setPmBriefInMeta(v2ForSave, brief);

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
        // If your API returns non-JSON on error
        if (!res.ok) throw new Error(text?.trim() ? text.slice(0, 300) : `AI failed (${res.status})`);
      }

      if (!res.ok) throw new Error(String(data?.error ?? "AI full generation failed"));

      setDoc((prev) => mergeAiFullIntoCharter(prev, data));
      lastLocalEditAtRef.current = Date.now();
      setDirty(true);
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

    setAiError("");
    setAiState("generating");
    setAiLoadingKey(key);

    try {
      const res = await fetch("/api/wireai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mode: "section",
          sectionKey: key,
          doc: v2ForSave,
          meta: { ...(v2ForSave.meta ?? {}), pm_brief: String(pmBrief ?? "") },
          template: "pmi",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error ?? "AI regeneration failed"));

      // keep your existing patch extraction logic (unchanged in your snippet)
      void data;
    } catch (e: any) {
      setAiState("error");
      setAiError(String(e?.message ?? "AI regeneration failed"));
    } finally {
      setAiLoadingKey(null);
      setAiState("idle");
    }
  }

  const pmBriefEmpty = !isNonEmptyString(pmBrief);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Project Charter</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold border border-slate-200">
                v{badgeVersion}
              </span>

              {approvalEnabled ? (
                <span className="px-2.5 py-0.5 rounded-full bg-slate-900 text-white text-xs font-semibold border border-slate-900">
                  {String(approvalStatus || "draft").replace(/_/g, " ")}
                </span>
              ) : null}
            </div>

            <p className="text-sm text-slate-500">
              {readOnly
                ? "View-only mode"
                : lockLayout
                ? "Layout locked after submission"
                : "Edit and manage your project charter"}
            </p>

            <LegacyLinks legacy={legacyExports ?? null} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-medium text-indigo-700">
                AI: {wireCaps.full && "Full"}
                {wireCaps.section && " • Section"}
                {wireCaps.suggest && " • Improve"}
                {wireCaps.validate && " • Validate"}
              </span>
            </div>

            <StatusBadge state={autosaveState} />

            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-slate-300 hover:bg-slate-50 text-slate-900"
              disabled={!canEdit || isPending || autosaveState === "saving"}
              onClick={() => saveNow("manual")}
              title={!canEdit ? "Read-only / locked" : dirty ? "Save changes" : "No unsaved changes"}
            >
              <Save className="h-4 w-4 mr-2 text-slate-700" />
              <span className="whitespace-nowrap">Save</span>
            </Button>

            <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode("sections")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  viewMode === "sections"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Sections
              </button>
              <button
                type="button"
                onClick={() => setViewMode("classic")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  viewMode === "classic"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Classic Table
              </button>
            </div>

            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-900"
              disabled={!canEdit || isPending || aiState === "generating" || aiFullBusy || !wireCaps.full}
              onClick={() => generateFullCharter()}
              title={
                !wireCaps.full
                  ? "Full AI generation is not available."
                  : !canEdit
                  ? "Read-only / locked"
                  : pmBriefEmpty
                  ? "Add a brief first (recommended)"
                  : "Generate the full charter from your brief"
              }
            >
              {aiFullBusy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4 mr-2 text-indigo-700" />
              )}
              <span className="whitespace-nowrap">AI: Generate Charter</span>
            </Button>

            {canShowSubmit ? (
              submitWired ? (
                <form action={submitForApprovalAction as any}>
                  <Button
                    type="submit"
                    variant="outline"
                    className="rounded-lg border-slate-300 hover:bg-slate-50 text-slate-900"
                    disabled={submitDisabled}
                    title={submitDisabled ? submitDisabledReason : "Submit this charter for approval"}
                  >
                    <Send className="h-4 w-4 mr-2 text-slate-700" />
                    <span className="whitespace-nowrap">{submitLabel}</span>
                  </Button>
                </form>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg border-slate-300 text-slate-900"
                  disabled
                  title={submitDisabledReason || "Submit action is not wired."}
                >
                  <Send className="h-4 w-4 mr-2 text-slate-700" />
                  <span className="whitespace-nowrap">{submitLabel}</span>
                </Button>
              )
            ) : null}

            {mounted ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="rounded-lg border-slate-300 hover:bg-slate-50 hover:border-slate-400 transition-colors"
                    disabled={!!exportBusy}
                  >
                    {exportBusy ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {exportBusy ? "Exporting..." : "Export"}
                    <ChevronDown className="h-3 w-3 ml-2 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => exportCharter("pdf")}
                    disabled={!!exportBusy}
                    className="cursor-pointer focus:bg-slate-50"
                  >
                    <FileText className="h-4 w-4 mr-2 text-red-600" />
                    <div className="flex flex-col">
                      <span className="text-sm">Export PDF</span>
                      <span className="text-xs text-slate-500">Professional document</span>
                    </div>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={() => exportCharter("docx")}
                    disabled={!!exportBusy}
                    className="cursor-pointer focus:bg-slate-50"
                  >
                    <File className="h-4 w-4 mr-2 text-blue-600" />
                    <div className="flex flex-col">
                      <span className="text-sm">Export Word</span>
                      <span className="text-xs text-slate-500">Editable document</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="outline"
                className="rounded-lg border-slate-300"
                disabled
                title="Export menu loads after page is ready"
              >
                <Download className="h-4 w-4 mr-2" />
                Export
                <ChevronDown className="h-3 w-3 ml-2 opacity-50" />
              </Button>
            )}
          </div>
        </div>

        {/* PM Brief textbox */}
        {canEdit ? (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900">PM Brief (context for AI)</div>
                <div className="text-xs text-slate-600">
                  Write freely. AI will draft the full charter and flag uncertain items as{" "}
                  <span className="font-mono">[ASSUMPTION]</span> / <span className="font-mono">[TBC]</span>.
                </div>
              </div>

              <div className="text-xs text-slate-500">
                {pmBriefEmpty ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Recommended
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Ready
                  </span>
                )}
              </div>
            </div>

            <textarea
              value={pmBrief}
              onChange={(e) => {
                const v = e.target.value;
                setPmBrief(v);

                lastLocalEditAtRef.current = Date.now();
                setDoc((prev) => setPmBriefInMeta(prev, v));
                setDirty(true);
              }}
              rows={6}
              placeholder={`Example:\n- Purpose: migrate finance processes to Workday\n- Scope: HR + Finance modules\n- Timeline: Apr–Oct\n- Constraints: limited SMEs, regulatory deadlines\n- Success criteria: reduced close cycle, improved data quality`}
              className="mt-3 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <div>
                Tip: include <span className="font-medium">why</span>,{" "}
                <span className="font-medium">who</span>, <span className="font-medium">when</span>,{" "}
                <span className="font-medium">constraints</span>, and{" "}
                <span className="font-medium">success measures</span>.
              </div>
              <div className="text-slate-500">
                Stored in <span className="font-mono">meta.pm_brief</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {lastSavedIso ? (
              <>
                Last saved: <span className="font-mono">{fmtWhenLocal(lastSavedIso)}</span>
              </>
            ) : (
              "—"
            )}
          </div>

          {aiState === "error" && aiError ? (
            <div className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4" />
              {aiError}
            </div>
          ) : null}
        </div>

        {exportErr && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle className="h-4 w-4" />
            {exportErr}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm min-h-[600px]">
        {viewMode === "classic" ? (
          <ProjectCharterClassicView doc={doc} projectId={projectId} artifactId={artifactId} />
        ) : isCanonicalV2 ? (
          <ProjectCharterSectionEditor
            meta={doc?.meta ?? {}}
            onMetaChange={(meta: any) => {
              markDirty();
              setDoc((prev: any) => {
                const cur = ensureCanonicalCharter(prev);
                return { ...cur, meta };
              });
            }}
            sections={sectionsForEditor}
            onChange={(sections: any) => {
              markDirty();
              setDoc((prev: any) => ensureCanonicalCharter({ ...prev, sections }));
            }}
            readOnly={sectionReadOnly}
            onImproveSection={(payload: ImproveSectionPayload) => openImprove(payload)}
            onRegenerateSection={(sectionKey: string) => regenerateSection(sectionKey)}
            aiDisabled={!canEdit || isPending || aiState === "generating" || improveRunning}
            aiLoadingKey={aiLoadingKey}
            includeContextForAI={true}
          />
        ) : (
          <ProjectCharterEditor
            initialJson={doc}
            onChange={(next: any) => {
              markDirty();
              setDoc(next);
            }}
            readOnly={readOnly}
            lockLayout={lockLayout}
          />
        )}
      </div>

      <CharterV2DebugPanel value={v2ForSave} />
    </div>
  );
}
