// src/components/editors/ProjectCharterEditorFormLazy.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

/**
 * NOTE:
 * This file is a Client Component.
 * Keep heavy internals lazy-loaded to protect compile/bundle time.
 * (The SSR fix for Server Actions must be done in ArtifactDetailClientHost:
 *  ProjectCharterEditorForm must NOT be ssr:false.)
 */

// ? Editor internals: load on-demand (big compile + bundle win)
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

// ? Debug panel is heavy; keep lazy.
const CharterV2DebugPanel = dynamic(() => import("@/components/editors/CharterV2DebugPanel"), {
  ssr: false,
  loading: () => null,
});

import { PROJECT_CHARTER_TEMPLATE } from "@/components/editors/charter-template";

// ? Server actions (split autosave vs manual)
import {
  autosaveProjectCharterV2,
  saveProjectCharterV2Manual,
} from "@/app/projects/[id]/artifacts/[artifactId]/charter-v2-actions";
import { migrateProjectCharterToV2 } from "@/app/projects/[id]/artifacts/[artifactId]/migrate-charter-v2-actions";

// ? types from section editor (new contract)
import type { ImproveSectionPayload } from "./ProjectCharterSectionEditor";

// ? Local timezone date/time (consistent across app)
import { formatDateTimeAuto } from "@/lib/date/format";

// UI
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
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  Wand2,
  Shield,
  Send,
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

// Strip leading bullet markers to avoid "• •" double bullets
function normalizeBulletLine(line: string) {
  let s = String(line ?? "");
  const re = /^\s*(?:[•\u2022\-\*\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/;
  for (let i = 0; i < 6; i++) {
    const next = s.replace(re, "");
    if (next === s) break;
    s = next;
  }
  return s; // ? do NOT trimEnd here (keeps caret/newline behavior stable)
}

// ? IMPORTANT: do NOT trimEnd the whole text while typing.
function normalizeBulletsText(text: string) {
  const raw = String(text ?? "");
  const lines = raw.split("\n");
  const cleaned = lines.map((l) => normalizeBulletLine(l));
  return cleaned.join("\n");
}

function looksIsoDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function looksIsoDateTime(v: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
}
function toUKDateOnly(iso: string) {
  const s = String(iso || "").trim();
  if (!s) return "";
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
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

// --- Required section layout (your spec) ---
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
        } else {
          const requiredHeaders = req.headers ?? [];
          if (requiredHeaders.length) {
            if (!s.table) {
              const cols = Array.isArray(s.columns) ? s.columns : [];
              const rows = Array.isArray(s.rows) ? s.rows : [];
              const colCount = Math.max(1, requiredHeaders.length, cols.length || rows[0]?.length || 2);
              const headerCells =
                cols.length > 0 ? cols : Array.from({ length: colCount }, (_, i) => requiredHeaders[i] ?? "");
              const tableRows: RowObj[] = [
                { type: "header", cells: headerCells.slice(0, colCount).map((x) => safeString(x)) },
                ...rows.map((r) => ({
                  type: "data",
                  cells: (r ?? []).slice(0, colCount).map((x) => safeString(x)),
                })),
              ];
              if (tableRows.length === 1)
                tableRows.push({ type: "data", cells: Array.from({ length: colCount }, () => "") });
              s.table = { columns: colCount, rows: tableRows };
              s.columns = undefined;
              s.rows = undefined;
            }

            const t = s.table!;
            if (!t.rows?.length || t.rows[0].type !== "header") {
              t.rows = [{ type: "header", cells: requiredHeaders.map((h) => safeString(h)) }, ...(t.rows ?? [])];
              t.columns = Math.max(t.columns || 1, requiredHeaders.length);
            } else {
              const header = t.rows[0];
              const allBlank = (header.cells ?? []).every((c) => !safeString(c).trim());
              if (allBlank) {
                header.cells = requiredHeaders.map((h) => safeString(h));
                t.columns = Math.max(t.columns || 1, requiredHeaders.length);
              }
            }

            const hasData = (t.rows ?? []).some((r) => r.type === "data");
            if (!hasData) {
              t.rows.push({
                type: "data",
                cells: Array.from({ length: t.columns || requiredHeaders.length || 2 }, () => ""),
              });
            }

            // ? Default currency to GBP for Financials table
            if (req.key === "financials") {
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

function safeFilenameBase(x: string) {
  const s = String(x || "project_charter").trim() || "project_charter";
  return s.replace(/[^a-z0-9]+/gi, "_");
}

/* ---------------- approval + legacy exports ---------------- */

type LegacyExports = { pdf?: string; docx?: string; xlsx?: string };

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

export default function ProjectCharterEditorFormLazy({
  projectId,
  artifactId,
  initialJson,
  readOnly,
  lockLayout = false,
  artifactVersion,

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

  legacyExports?: LegacyExports;
  approvalEnabled?: boolean;
  canSubmitOrResubmit?: boolean;
  approvalStatus?: string | null;

  submitForApprovalAction?: ((formData: FormData) => Promise<void>) | (() => Promise<void>) | null;
}) {
  const router = useRouter();

  const [doc, setDoc] = useState<any>(() => ensureCanonicalCharter(initialJson));
  const [isPending, startTransition] = useTransition();

  const [mounted, setMounted] = useState(false);
  const [lastSavedIso, setLastSavedIso] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("sections");
  const [dirty, setDirty] = useState(false);

  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "queued">("idle");

  // ? AI state (global + per-section)
  const [aiState, setAiState] = useState<"idle" | "generating" | "error">("idle");
  const [aiError, setAiError] = useState<string>("");
  const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);

  // ? Improve modal state
  const [improveOpen, setImproveOpen] = useState(false);
  const [improvePayload, setImprovePayload] = useState<ImproveSectionPayload | null>(null);
  const [improveNotes, setImproveNotes] = useState<string>("");
  const [improveRunning, setImproveRunning] = useState(false);
  const [improveError, setImproveError] = useState<string>("");

  const [improveSuggestions, setImproveSuggestions] = useState<{ id: string; label: string; section: any }[]>([]);
  const [improveSelectedId, setImproveSelectedId] = useState<string>("");

  // ? wireAI route capabilities (auto-detect; falls back to full-only)
  const [wireCaps, setWireCaps] = useState<WireCaps>({
    full: true,
    section: false,
    suggest: false,
    validate: false,
  });

  // ? export dropdown busy state
  const [exportBusy, setExportBusy] = useState<null | "pdf" | "docx">(null);
  const [exportErr, setExportErr] = useState<string>("");

  const improveSelectedSection = useMemo(() => {
    return improveSuggestions.find((s) => s.id === improveSelectedId)?.section ?? null;
  }, [improveSuggestions, improveSelectedId]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    async function detectCaps() {
      try {
        const res = await fetch("/api/wireai/capabilities", { method: "GET" });
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

  useEffect(() => {
    if (dirty) return;
    if (incomingSig === adoptedSigRef.current) return;
    adoptedSigRef.current = incomingSig;
    setDoc(ensureCanonicalCharter(initialJson));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingSig, dirty]);

  const v2ForSave = useMemo(() => {
    const d = ensureCanonicalCharter(doc);
    return {
      version: 2 as const,
      type: "project_charter" as const,
      meta: d?.meta ?? {},
      sections: Array.isArray(d?.sections) ? d.sections : [],
    };
  }, [doc]);

  const canEdit = !readOnly && !lockLayout;
  const isCanonicalV2 = isV2(doc);
  const sectionReadOnly = readOnly || lockLayout;

  const sectionsForEditor = useMemo(() => {
    const secs = Array.isArray(doc?.sections) ? doc.sections : [];
    return secs.map((s: any) => ({ ...s, title: stripNumberPrefix(String(s?.title ?? "")) }));
  }, [doc?.sections]);

  function markDirty() {
    if (!dirty) setDirty(true);
  }

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSigRef = useRef<string>("");
  const autosaveInFlightRef = useRef(false);
  const pendingSigRef = useRef<string>("");

  function markAutosaveSuccess() {
    const sig = pendingSigRef.current;
    if (sig) lastSavedSigRef.current = sig;
    pendingSigRef.current = "";
    autosaveInFlightRef.current = false;
  }

  function markAutosaveFailure() {
    pendingSigRef.current = "";
    autosaveInFlightRef.current = false;
  }

  function saveNow(reason: "manual" | "autosave") {
    if (!canEdit) return;

    const payload = v2ForSave;
    const sigAtStart = stableSig(payload);

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

          const sigNow = stableSig(payload);
          if (sigNow === sigAtStart) {
            setDirty(false);
            setAutosaveState("idle");
          } else {
            setDirty(true);
            setAutosaveState("queued");
          }
        } catch {
          markAutosaveFailure();
          setAutosaveState("queued");
        }
        return;
      }

      const res = await saveProjectCharterV2Manual({
        mode: "manual",
        projectId,
        artifactId,
        charterV2: payload,
        clearLegacyContent: true,
      });

      const newId = (res as any)?.newArtifactId ? String((res as any).newArtifactId) : "";
      const sigNow = stableSig(payload);

      adoptedSigRef.current = sigAtStart;
      setLastSavedIso(new Date().toISOString());
      setAutosaveState("idle");

      if (sigNow === sigAtStart) setDirty(false);
      else setDirty(true);

      if (newId && newId !== artifactId) {
        router.replace(`/projects/${projectId}/artifacts/${newId}`);
        router.refresh();
      }
    });
  }

  // ? Autosave debounce (fix: actually runs)
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
  }, [dirty, canEdit, v2ForSave]);

  // ? Generate entire charter modal (kept; used by your UI elsewhere)
  const [entireOpen, setEntireOpen] = useState(false);
  const [entirePrompt, setEntirePrompt] = useState<string>("");
  const [entireRunning, setEntireRunning] = useState(false);
  const [entireError, setEntireError] = useState<string>("");

  function tryParseJson(text: string) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  type WireSection = {
    key: string;
    title: string;
    bullets?: string;
    table?: { columns: number; rows: RowObj[] };
  };
  type WirePatch =
    | { kind: "replace_section"; key: string; section: WireSection }
    | { kind: "suggestions"; key: string; suggestions: { id: string; label: string; section: WireSection }[] }
    | { kind: "replace_all"; doc: any };

  function extractPatch(data: any): WirePatch | null {
    if (data?.patch && typeof data.patch === "object" && typeof data.patch.kind === "string")
      return data.patch as WirePatch;
    const t = typeof data?.text === "string" ? data.text : "";
    if (!t.trim()) return null;
    const parsed = tryParseJson(t);
    if (parsed?.kind) return parsed as WirePatch;
    if (parsed?.version === 2 && Array.isArray(parsed?.sections)) return { kind: "replace_all", doc: parsed } as WirePatch;
    return null;
  }

  async function generateEntireCharter() {
    if (!canEdit) return;

    const prompt = entirePrompt.trim();
    if (!prompt) {
      setAiState("error");
      setAiError("Please enter a high-level prompt (e.g., scope, budget, team size, timeline).");
      return;
    }

    setAiState("generating");
    setAiError("");
    setEntireError("");
    setEntireRunning(true);

    try {
      const res = await fetch("/api/wireai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full", prompt, meta: v2ForSave.meta, doc: v2ForSave, template: "pmi" }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error ?? "AI generation failed"));

      const patch = extractPatch(data);
      if (!patch) throw new Error("AI returned no patch");

      if (patch.kind === "replace_all") {
        const nextDoc = ensureCanonicalCharter(patch.doc);
        markDirty();
        setDoc(nextDoc);
      } else if (patch.kind === "replace_section") {
        const current = ensureCanonicalCharter(doc);
        const next = ensureCanonicalCharter({
          ...current,
          sections: (current.sections || []).map((s: any) => (String(s?.key) === patch.key ? patch.section : s)),
        });
        markDirty();
        setDoc(next);
      } else if (patch.kind === "suggestions") {
        const pick =
          patch.suggestions.find((x) => x.id === "detailed")?.section ?? patch.suggestions[0]?.section ?? null;
        if (pick) {
          const current = ensureCanonicalCharter(doc);
          const next = ensureCanonicalCharter({
            ...current,
            sections: (current.sections || []).map((s: any) => (String(s?.key) === patch.key ? pick : s)),
          });
          markDirty();
          setDoc(next);
        }
      }

      setAiState("idle");
      setEntireRunning(false);
      setEntireOpen(false);
    } catch (e: any) {
      setAiState("error");
      const msg = e?.message ?? "AI generation failed";
      setAiError(msg);
      setEntireError(msg);
      setEntireRunning(false);
    }
  }

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

  /* =========================================================
     ? SUBMIT BUTTON FIX
  ========================================================= */

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

  /* =========================================================
     ? AI handlers (fix: no more blank improve/regenerate)
  ========================================================= */

  function openImprove(payload: ImproveSectionPayload) {
    if (!canEdit) return;
    setImprovePayload(payload);
    setImproveNotes(payload?.notes ?? "");
    setImproveError("");
    setImproveOpen(true);
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
        body: JSON.stringify({
          mode: "section",
          sectionKey: key,
          doc: v2ForSave,
          meta: v2ForSave.meta,
          template: "pmi",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error ?? "AI regeneration failed"));

      const patch = extractPatch(data);
      if (!patch) throw new Error("AI returned no patch");

      if (patch.kind === "replace_section") {
        const current = ensureCanonicalCharter(doc);
        const next = ensureCanonicalCharter({
          ...current,
          sections: (current.sections || []).map((s: any) => (String(s?.key) === patch.key ? patch.section : s)),
        });
        markDirty();
        setDoc(next);
      } else if (patch.kind === "suggestions") {
        const pick = patch.suggestions?.[0]?.section ?? null;
        if (pick) {
          const current = ensureCanonicalCharter(doc);
          const next = ensureCanonicalCharter({
            ...current,
            sections: (current.sections || []).map((s: any) => (String(s?.key) === patch.key ? pick : s)),
          });
          markDirty();
          setDoc(next);
        }
      } else if (patch.kind === "replace_all") {
        const nextDoc = ensureCanonicalCharter(patch.doc);
        markDirty();
        setDoc(nextDoc);
      }
    } catch (e: any) {
      setAiState("error");
      setAiError(String(e?.message ?? "AI regeneration failed"));
    } finally {
      setAiLoadingKey(null);
      setAiState("idle");
    }
  }

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
              {readOnly ? "View-only mode" : lockLayout ? "Layout locked after submission" : "Edit and manage your project charter"}
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

            {/* ? Manual Save (explicit) */}
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
                  viewMode === "sections" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Sections
              </button>
              <button
                type="button"
                onClick={() => setViewMode("classic")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  viewMode === "classic" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Classic Table
              </button>
            </div>

            {/* ? Submit for approval (ALWAYS visible when approvals enabled) */}
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

            {/* ? Export dropdown (Radix) MUST be client-only to avoid hydration mismatch */}
            {mounted ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="rounded-lg border-slate-300 hover:bg-slate-50 hover:border-slate-400 transition-colors"
                    disabled={!!exportBusy}
                  >
                    {exportBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
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
              <Button variant="outline" className="rounded-lg border-slate-300" disabled title="Export menu loads after page is ready">
                <Download className="h-4 w-4 mr-2" />
                Export
                <ChevronDown className="h-3 w-3 ml-2 opacity-50" />
              </Button>
            )}
          </div>
        </div>

        {/* Save/Ai hints */}
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

      {/* Main Content */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm min-h-[600px]">
        {viewMode === "classic" ? (
          <ProjectCharterClassicView doc={doc} projectId={projectId} artifactId={artifactId} />
        ) : isCanonicalV2 ? (
          <ProjectCharterSectionEditor
            meta={doc?.meta ?? {}}
            onMetaChange={(meta: any) => {
              markDirty();
              setDoc({ ...doc, meta });
            }}
            sections={sectionsForEditor}
            onChange={(sections: any) => {
              markDirty();
              setDoc(ensureCanonicalCharter({ ...doc, sections }));
            }}
            readOnly={sectionReadOnly}
            onImproveSection={(payload: ImproveSectionPayload) => openImprove(payload)}
            onRegenerateSection={(sectionKey: string) => regenerateSection(sectionKey)}
            aiDisabled={!canEdit || isPending || aiState === "generating" || improveRunning || entireRunning}
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

      {/* ? Keep debug panel mounted, but it’s now dynamically loaded */}
      <CharterV2DebugPanel value={v2ForSave} />
    </div>
  );
}
