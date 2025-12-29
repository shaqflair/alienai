// src/components/editors/ProjectCharterEditorForm.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import ProjectCharterEditor from "./ProjectCharterEditor";
import ProjectCharterClassicView from "./ProjectCharterClassicView";
import ProjectCharterSectionEditor from "./ProjectCharterSectionEditor";
import CharterV2DebugPanel from "@/components/editors/CharterV2DebugPanel";

import { PROJECT_CHARTER_TEMPLATE } from "@/components/editors/charter-template";

// ✅ Server actions
import { saveProjectCharterV2 } from "@/app/projects/[id]/artifacts/[artifactId]/charter-v2-actions";
import { migrateProjectCharterToV2 } from "@/app/projects/[id]/artifacts/[artifactId]/migrate-charter-v2-actions";

// ✅ Export readiness (keep for export banner)
import type { CharterV2 } from "@/lib/charter/charter-v2";
import { isCharterExportReady } from "@/lib/charter/export-ready";

// ✅ Completeness helper (ticks + shared truth)
import { getCharterValidation } from "@/lib/charter/charter-validation";

function fmtWhenIso(x: string | null) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return String(x);
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
  return !!x && typeof x === "object" && Number((x as any).version) === 2 && Array.isArray((x as any).sections);
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
              if (tableRows.length === 1) {
                tableRows.push({ type: "data", cells: Array.from({ length: colCount }, () => "") });
              }
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
          }
        }
      }

      if (req.kind === "bullets") {
        const hasBullets = typeof s.bullets === "string";
        const hasAnyTable = !!(s.table || s.columns || s.rows);
        if (!hasBullets && !hasAnyTable) s.bullets = "";
      }

      return s;
    }

    if (req.kind === "table") {
      return { key: req.key, title: req.title, table: buildEmptyTable(req.headers ?? ["", "", "", ""]) };
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

export default function ProjectCharterEditorForm({
  projectId,
  artifactId,
  initialJson,
  readOnly,
  lockLayout = false,
}: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly: boolean;
  lockLayout?: boolean;
}) {
  const router = useRouter();

  const [doc, setDoc] = useState<any>(() => ensureCanonicalCharter(initialJson));
  const [isPending, startTransition] = useTransition();

  const [mounted, setMounted] = useState(false);
  const [lastSavedIso, setLastSavedIso] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("sections");
  const [dirty, setDirty] = useState(false);

  useEffect(() => setMounted(true), []);

  // ✅ STOP wiping local edits after save/revalidate
  const incomingSig = useMemo(() => stableSig(initialJson), [initialJson]);
  const adoptedSigRef = useRef(incomingSig);

  useEffect(() => {
    const sig = incomingSig;
    if (dirty) return;
    if (sig === adoptedSigRef.current) return;
    adoptedSigRef.current = sig;
    setDoc(ensureCanonicalCharter(initialJson));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingSig, dirty]);

  // ✅ Canonical stored v2 shape
  const v2ForSave = useMemo(() => {
    const d = ensureCanonicalCharter(doc);
    return {
      version: 2 as const,
      type: "project_charter" as const,
      meta: d?.meta ?? {},
      sections: Array.isArray(d?.sections) ? d.sections : [],
    };
  }, [doc]);

  // ✅ Export readiness (banner)
  const exportReport = useMemo(() => {
    const v2: CharterV2 = {
      meta: v2ForSave.meta,
      sections: v2ForSave.sections,
      legacy_raw: { version: v2ForSave.version, type: v2ForSave.type },
    };
    return isCharterExportReady(v2);
  }, [v2ForSave]);

  // ✅ Completeness (ticks + shared truth)
  const completeness = useMemo(() => getCharterValidation(v2ForSave), [v2ForSave]);

  const canEdit = !readOnly && !lockLayout;
  const isCanonicalV2 = isV2(doc);
  const sectionReadOnly = readOnly || lockLayout;

  // prevent double numbering in section editor UI
  const sectionsForEditor = useMemo(() => {
    const secs = Array.isArray(doc?.sections) ? doc.sections : [];
    return secs.map((s: any) => ({
      ...s,
      title: stripNumberPrefix(String(s?.title ?? "")),
    }));
  }, [doc?.sections]);

  function markDirty() {
    if (!dirty) setDirty(true);
  }

  function saveNow(reason: "manual" | "autosave" = "manual") {
    if (!canEdit) return;
    startTransition(async () => {
      const res = await saveProjectCharterV2({
        projectId,
        artifactId,
        charterV2: v2ForSave, // canonical already
        clearLegacyContent: true,
      });

      // ✅ If server created a new revision row, jump to it (this is REQUIRED for versioned save)
      const newId = (res as any)?.newArtifactId ? String((res as any).newArtifactId) : "";
      if (newId && newId !== artifactId) {
        // Keep local edits stable; we're moving to the new canonical row
        adoptedSigRef.current = stableSig(v2ForSave);
        setLastSavedIso(new Date().toISOString());
        setDirty(false);

        router.replace(`/projects/${projectId}/artifacts/${newId}`);
        router.refresh();
        return;
      }

      setLastSavedIso(new Date().toISOString());
      setDirty(false);

      // keep signatures aligned to canonical payload
      adoptedSigRef.current = stableSig(v2ForSave);

      void reason;
    });
  }

  // ✅ Auto-save (debounced)
  const autosaveTimerRef = useRef<any>(null);
  const lastAutoSavedSigRef = useRef<string>("");

  useEffect(() => {
    if (!canEdit) return;
    if (!dirty) return;
    if (isPending) return;

    const sig = stableSig(v2ForSave);

    // don't autosave the same payload repeatedly
    if (sig === lastAutoSavedSigRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(() => {
      lastAutoSavedSigRef.current = sig;
      saveNow("autosave");
    }, 900);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, dirty, isPending, v2ForSave]);

  // ✅ Flush autosave when leaving the page
  useEffect(() => {
    if (!canEdit) return;
    const onBeforeUnload = () => {
      if (!dirty) return;
      try {
        saveNow("autosave");
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, dirty]);

  function upgradeToV2Now() {
    if (!canEdit) return;
    startTransition(async () => {
      const migrated = await migrateProjectCharterToV2({ projectId, artifactId });
      if (migrated && typeof migrated === "object") {
        setDoc({
          version: 2,
          type: "project_charter",
          meta: (migrated as any).meta ?? {},
          sections: (migrated as any).sections ?? [],
        });
      } else {
        setDoc((prev: any) => ensureCanonicalCharter(prev));
      }

      setLastSavedIso(new Date().toISOString());
      setDirty(false);
      adoptedSigRef.current = stableSig(v2ForSave);
    });
  }

  return (
    <div className="space-y-3">
      {/* View toggle bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-neutral-600">
          View:
          <span className="ml-2 inline-flex rounded-xl border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("sections")}
              className={`px-3 py-1 text-xs ${viewMode === "sections" ? "bg-black text-white" : "bg-white hover:bg-gray-50"}`}
            >
              Section view
            </button>
            <button
              type="button"
              onClick={() => setViewMode("classic")}
              className={`px-3 py-1 text-xs ${viewMode === "classic" ? "bg-black text-white" : "bg-white hover:bg-gray-50"}`}
            >
              Classic table view
            </button>
          </span>
        </div>

        <div className="text-xs text-neutral-500">
          {viewMode === "classic"
            ? "Classic view is a read-only preview. Edit content in Section view."
            : "Each section becomes a block for exports (PPT/PDF/Word) and AI."}
        </div>
      </div>

      {viewMode === "classic" ? (
        <ProjectCharterClassicView doc={doc} />
      ) : isCanonicalV2 ? (
        <ProjectCharterSectionEditor
          meta={doc?.meta ?? {}}
          onMetaChange={(meta) => {
            markDirty();
            setDoc({ ...doc, meta });
          }}
          sections={sectionsForEditor}
          onChange={(sections) => {
            markDirty();
            setDoc(ensureCanonicalCharter({ ...doc, sections }));
          }}
          readOnly={sectionReadOnly}
          // ✅ pass completeness map for ticks
          completenessByKey={completeness.completenessByKey}
        />
      ) : (
        <ProjectCharterEditor
          initialJson={doc}
          onChange={(next) => {
            markDirty();
            setDoc(next);
          }}
          readOnly={readOnly}
          lockLayout={lockLayout}
        />
      )}

      {/* Export readiness banner */}
      <div
        className={`rounded-xl border px-4 py-3 text-sm ${
          exportReport.ready ? "border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">
            Export readiness:{" "}
            <span className={exportReport.ready ? "text-gray-900" : "text-amber-700"}>{exportReport.score0to100}%</span>
          </div>

          <div className="text-xs text-neutral-600">
            {exportReport.ready ? "✅ Ready to export (PDF/Word/PPT)" : "⚠️ Export will be blocked until minimum content is added"}
          </div>
        </div>

        {!exportReport.ready ? (
          <div className="mt-2 text-xs text-neutral-700">
            <div className="font-semibold mb-1">Missing:</div>
            <ul className="list-disc pl-5 space-y-1">
              {exportReport.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <button
            type="button"
            onClick={() => saveNow("manual")}
            className="px-4 py-2 rounded-xl bg-black text-white text-sm disabled:opacity-60"
            disabled={isPending}
          >
            {isPending ? "Saving…" : dirty ? "Save charter *" : "Save charter"}
          </button>
        ) : null}

        {canEdit ? (
          <button
            type="button"
            onClick={upgradeToV2Now}
            className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-sm hover:bg-gray-50 disabled:opacity-60"
            disabled={isPending}
            title="Converts legacy/empty content_json to v2 { meta, sections } and saves it"
          >
            {isPending ? "Working…" : "Upgrade to v2"}
          </button>
        ) : null}

        <div className="text-xs text-neutral-500">
          {readOnly ? (
            "You can view but not edit."
          ) : lockLayout ? (
            "Layout is locked after submit. (This version is view-only for structure.)"
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span>Autosave: {dirty ? "Pending…" : "Up to date"}</span>

              {mounted ? (
                <span className="whitespace-nowrap">
                  {isPending ? (
                    <span className="text-blue-600">Saving…</span>
                  ) : (
                    <>
                      Last saved: <span className={lastSavedIso ? "text-green-700" : ""}>{fmtWhenIso(lastSavedIso)}</span>
                    </>
                  )}
                </span>
              ) : (
                <span className="whitespace-nowrap">Last saved: —</span>
              )}
            </div>
          )}
        </div>
      </div>

      <CharterV2DebugPanel value={v2ForSave} />
    </div>
  );
}
