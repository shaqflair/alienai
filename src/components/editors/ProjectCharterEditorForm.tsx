// src/components/editors/ProjectCharterEditorForm.tsx
"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import ProjectCharterEditor from "./ProjectCharterEditor";
import ProjectCharterClassicView from "./ProjectCharterClassicView";
import ProjectCharterSectionEditor from "./ProjectCharterSectionEditor";
import { updateArtifactJson } from "@/app/projects/[id]/artifacts/actions";
import { PROJECT_CHARTER_TEMPLATE } from "@/components/editors/charter-template";

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

/**
 * ✅ Ensures the editor always receives canonical v2 structure
 * Expected (v2): { version:2, type:"project_charter", sections:[{ key,title,table/bullets/... }]}
 *
 * If we receive legacy Tiptap doc/table JSON (type: "doc") or any other shape,
 * we fall back to PROJECT_CHARTER_TEMPLATE so section headers + column headers appear.
 */
function ensureCanonicalCharter(input: any) {
  const x = input ?? null;

  // Canonical v2 (what the new section editor expects)
  if (x && typeof x === "object" && Array.isArray((x as any).sections)) {
    return x;
  }

  // Some apps store under { content: { sections: [...] } }
  if (x && typeof x === "object" && Array.isArray((x as any)?.content?.sections)) {
    return { ...(x as any), sections: (x as any).content.sections };
  }

  // Legacy Tiptap doc/table structure or anything else => seed template
  return PROJECT_CHARTER_TEMPLATE;
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
  const [doc, setDoc] = useState<any>(() => ensureCanonicalCharter(initialJson));
  const [isPending, startTransition] = useTransition();

  // ✅ prevent hydration mismatch by only showing "Last saved" after mount
  const [mounted, setMounted] = useState(false);

  // ✅ stable client state
  const [lastSavedIso, setLastSavedIso] = useState<string | null>(null);

  // View toggle (Option A)
  const [viewMode, setViewMode] = useState<ViewMode>("sections");

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep state in sync with server-provided JSON, but normalize it so tabs/headers show.
  useEffect(() => {
    setDoc(ensureCanonicalCharter(initialJson));
  }, [initialJson]);

  const jsonString = useMemo(() => JSON.stringify(doc ?? {}), [doc]);

  function saveNow() {
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("artifact_id", artifactId);
    fd.set("content_json", jsonString);

    startTransition(async () => {
      await updateArtifactJson(fd);
      setLastSavedIso(new Date().toISOString());
    });
  }

  const canEdit = !readOnly && !lockLayout;

  const isCanonicalV2 = !!(doc && typeof doc === "object" && Array.isArray(doc.sections));
  const sectionReadOnly = readOnly || lockLayout;

  return (
    <div className="space-y-3">
      {/* ✅ View toggle bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-neutral-600">
          View:
          <span className="ml-2 inline-flex rounded-xl border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("sections")}
              className={`px-3 py-1 text-xs ${
                viewMode === "sections" ? "bg-black text-white" : "bg-white hover:bg-gray-50"
              }`}
            >
              Section view
            </button>
            <button
              type="button"
              onClick={() => setViewMode("classic")}
              className={`px-3 py-1 text-xs ${
                viewMode === "classic" ? "bg-black text-white" : "bg-white hover:bg-gray-50"
              }`}
            >
              Classic table view
            </button>
          </span>
        </div>

        <div className="text-xs text-neutral-500">
          {viewMode === "classic"
            ? "Classic view is a read-only preview. Edit content in Section view."
            : "Each tab becomes one slide in exports (PPT/PDF/Word) and AI."}
        </div>
      </div>

      {/* ✅ Render either classic preview OR (v2) section editor OR (legacy) table editor */}
      {viewMode === "classic" ? (
        <ProjectCharterClassicView doc={doc} />
      ) : isCanonicalV2 ? (
        <ProjectCharterSectionEditor
          sections={doc.sections}
          onChange={(sections) => setDoc({ ...doc, sections })}
          readOnly={sectionReadOnly}
        />
      ) : (
        <ProjectCharterEditor
          initialJson={doc}
          onChange={setDoc}
          readOnly={readOnly}
          lockLayout={lockLayout}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <button
            type="button"
            onClick={saveNow}
            className="px-4 py-2 rounded-xl bg-black text-white text-sm disabled:opacity-60"
            disabled={isPending}
          >
            {isPending ? "Saving…" : "Save charter"}
          </button>
        ) : null}

        <div className="text-xs text-neutral-500">
          {readOnly ? (
            "You can view but not edit."
          ) : lockLayout ? (
            "Layout is locked after submit. (This version is view-only for structure.)"
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span>Tip: edit in Section view. Classic view is a stakeholder preview.</span>

              {/* ✅ render only after mount to avoid hydration mismatch */}
              {mounted ? (
                <span className="whitespace-nowrap">
                  {isPending ? (
                    <span className="text-blue-600">Saving…</span>
                  ) : (
                    <>
                      Last saved:{" "}
                      <span className={lastSavedIso ? "text-green-700" : ""}>{fmtWhenIso(lastSavedIso)}</span>
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
    </div>
  );
}
