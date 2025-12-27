// src/components/editors/ProjectCharterEditorClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import ProjectCharterEditor from "./ProjectCharterEditor";

type SaveState = "saved" | "dirty" | "saving" | "error";

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
  const [doc, setDoc] = useState<any>(initialJson);
  const [state, setState] = useState<SaveState>("saved");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const lastSavedRef = useRef<number>(Date.now());
  const debounceRef = useRef<any>(null);

  // Mark dirty when doc changes
  const onChange = (next: any) => {
    setDoc(next);
    if (state !== "dirty") setState("dirty");
  };

  const doSave = (payload: any) => {
    if (readOnly) return;

    setState("saving");
    setErr(null);

    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("artifact_id", artifactId);
    fd.set("content_json", JSON.stringify(payload ?? null));

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
    if (readOnly) return { text: "Read-only", cls: "bg-gray-50 border-gray-200 text-gray-700" };
    if (state === "saving" || isPending) return { text: "Saving…", cls: "bg-blue-50 border-blue-200 text-blue-800" };
    if (state === "dirty") return { text: "Unsaved changes", cls: "bg-amber-50 border-amber-200 text-amber-800" };
    if (state === "error") return { text: "Save failed", cls: "bg-red-50 border-red-200 text-red-800" };
    return { text: "Saved", cls: "bg-green-50 border-green-200 text-green-800" };
  }, [state, isPending, readOnly]);

  return (
    <section className="border rounded-2xl bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${badge.cls}`}>
            {badge.text}
          </div>
          <div className="text-xs text-gray-500">
            Last saved:{" "}
            {new Date(lastSavedRef.current).toISOString().replace("T", " ").replace("Z", " UTC")}
          </div>
        </div>

        {!readOnly ? (
          <button
            type="button"
            onClick={() => doSave(doc)}
            className="rounded-xl bg-black text-white text-sm px-4 py-2"
            disabled={state === "saving" || isPending}
          >
            Save charter
          </button>
        ) : null}
      </div>

      {err ? <div className="text-sm text-red-600">Error: {err}</div> : null}

      <ProjectCharterEditor initialJson={doc} onChange={onChange} readOnly={readOnly} />

      {!readOnly ? (
        <div className="text-xs text-gray-500">
          Tip: edits auto-save after you pause typing. Toolbar lets you add rows/columns + merge cells.
        </div>
      ) : null}
    </section>
  );
}
