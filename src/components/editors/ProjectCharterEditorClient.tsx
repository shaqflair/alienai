// src/components/editors/ProjectCharterEditorClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import ProjectCharterEditor from "./ProjectCharterEditor";

type SaveState = "saved" | "dirty" | "saving" | "error";

// ✅ Bullet normalization to prevent "• •" duplicates
function normalizeBulletLine(line: string) {
  let s = String(line ?? "");
  const re = /^\s*(?:[•\u2022\-\*\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/;
  for (let i = 0; i < 6; i++) {
    const next = s.replace(re, "");
    if (next === s) break;
    s = next;
  }
  return s.trimEnd();
}

function normalizeBulletsText(text: string) {
  const raw = String(text ?? "");
  const lines = raw.split("\n");
  const cleaned = lines.map((l) => normalizeBulletLine(l).trim());
  return cleaned.join("\n").trimEnd();
}

// ✅ Process document to ensure bullets are visible and clean
function processDocForBullets(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;
  
  // Handle v2 structure with sections
  if (Array.isArray(doc.sections)) {
    return {
      ...doc,
      sections: doc.sections.map((section: any) => {
        if (section?.bullets && typeof section.bullets === "string") {
          return {
            ...section,
            bullets: normalizeBulletsText(section.bullets),
          };
        }
        return section;
      }),
    };
  }
  
  // Handle legacy content structure
  if (doc.content && Array.isArray(doc.content.sections)) {
    return {
      ...doc,
      content: {
        ...doc.content,
        sections: doc.content.sections.map((section: any) => {
          if (section?.bullets && typeof section.bullets === "string") {
            return {
              ...section,
              bullets: normalizeBulletsText(section.bullets),
            };
          }
          return section;
        }),
      },
    };
  }
  
  return doc;
}

export default function ProjectCharterEditorClient({
  projectId,
  artifactId,
  readOnly,
  initialJson,
  saveAction,
}: {
  projectId: string;
  artifactId: string;
  readOnly: boolean;
  initialJson: any;
  saveAction: (formData: FormData) => Promise<void>;
}) {
  // ✅ Process initial data to clean bullets
  const [doc, setDoc] = useState<any>(() => processDocForBullets(initialJson));
  const [state, setState] = useState<SaveState>("saved");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const lastSavedRef = useRef<number>(Date.now());
  const debounceRef = useRef<any>(null);

  // Mark dirty when doc changes - process bullets on change
  const onChange = (next: any) => {
    const processed = processDocForBullets(next);
    setDoc(processed);
    if (state !== "dirty") setState("dirty");
  };

  const doSave = (payload: any) => {
    if (readOnly) return;

    setState("saving");
    setErr(null);

    // ✅ Ensure bullets are normalized before saving
    const processedPayload = processDocForBullets(payload);

    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("artifact_id", artifactId);
    fd.set("content_json", JSON.stringify(processedPayload ?? null));

    startTransition(async () => {
      try {
        await saveAction(fd);
        lastSavedRef.current = Date.now();
        setState("saved");
      } catch (e: any) {
        setState("error");
        setErr(String(e?.message ?? e));
      }
    });
  };

  // Debounced autosave
  useEffect(() => {
    if (readOnly) return;
    if (state !== "dirty") return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(doc), 1200);

    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, state, readOnly]);

  // Optional: warn user if they try to close tab with unsaved edits
  useEffect(() => {
    if (readOnly) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (state === "dirty" || state === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state, readOnly]);

  const badge = useMemo(() => {
    if (readOnly) return { text: "Read-only", cls: "bg-slate-50 border-slate-200 text-slate-700" };
    if (state === "saving" || isPending) return { text: "Saving…", cls: "bg-blue-50 border-blue-200 text-blue-700" };
    if (state === "dirty") return { text: "Unsaved changes", cls: "bg-amber-50 border-amber-200 text-amber-700" };
    if (state === "error") return { text: "Save failed", cls: "bg-red-50 border-red-200 text-red-700" };
    return { text: "Saved", cls: "bg-emerald-50 border-emerald-200 text-emerald-700" };
  }, [state, isPending, readOnly]);

  // ✅ Count bullet sections for visibility indicator
  const bulletSectionCount = useMemo(() => {
    if (!doc) return 0;
    const sections = doc.sections || doc.content?.sections || [];
    return sections.filter((s: any) => s?.bullets !== undefined).length;
  }, [doc]);

  return (
    <section className="border border-slate-200 rounded-2xl bg-white p-6 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${badge.cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${state === "saved" ? "bg-emerald-500" : state === "dirty" ? "bg-amber-500" : state === "saving" ? "bg-blue-500 animate-pulse" : "bg-red-500"}`} />
            {badge.text}
          </div>
          
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>Last saved: {new Date(lastSavedRef.current).toISOString().replace("T", " ").replace("Z", " UTC")}</span>
            {bulletSectionCount > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {bulletSectionCount} bullet sections
              </span>
            )}
          </div>
        </div>

        {!readOnly ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => doSave(doc)}
              className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm px-4 py-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={state === "saving" || isPending}
            >
              {state === "saving" ? "Saving…" : "Save charter"}
            </button>
          </div>
        ) : null}
      </div>

      {err ? (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {err}
        </div>
      ) : null}

      <div className="min-h-[400px]">
        <ProjectCharterEditor 
          initialJson={doc} 
          onChange={onChange} 
          readOnly={readOnly}
        />
      </div>

      {!readOnly ? (
        <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-3 border border-slate-200">
          <svg className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="space-y-1">
            <p><strong>Tip:</strong> Edits auto-save after you pause typing. Toolbar lets you add rows/columns + merge cells.</p>
            <p className="text-slate-400">Bullet points (•) are automatically formatted for Key Deliverables, Risks, Issues, Assumptions, and Dependencies sections.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}