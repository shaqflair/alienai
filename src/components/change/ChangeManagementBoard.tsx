// src/components/change/ChangeManagementBoard.tsx
"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

/**
 * ? Heavy UI (DnD + drawers + modals) is loaded dynamically
 * so the initial bundle stays small and first paint is instant.
 */
const ChangeBoardDnd = dynamic(() => import("./ChangeBoardDnd"), {
  ssr: false,
  loading: () => (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-gray-900">Change Board</div>
          <div className="text-sm text-gray-500">Loading board…</div>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-3">
        {["Intake", "Analysis", "Review", "Implementation", "Implemented", "Closed"].map((t) => (
          <div key={t} className="min-w-[320px] w-[320px]">
            <div className="rounded-2xl border-2 border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                <div className="font-semibold truncate">{t}</div>
                <div className="text-xs text-gray-500">—</div>
              </div>
              <div className="p-3 min-h-[420px] space-y-3">
                <div className="h-24 rounded-xl border border-gray-200 bg-gray-50 animate-pulse" />
                <div className="h-24 rounded-xl border border-gray-200 bg-gray-50 animate-pulse" />
                <div className="h-24 rounded-xl border border-gray-200 bg-gray-50 animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
});

/* ---------------- helpers ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

export default function ChangeBoard() {
  const params = useParams() as any;

  const routeProjectParam = safeStr(params?.id || params?.projectId).trim();
  const artifactId = safeStr(params?.artifactId).trim() || null;

  const [projectHumanId, setProjectHumanId] = useState<string>(routeProjectParam);
  const [projectUuid, setProjectUuid] = useState<string>("");
  const [projectLabel, setProjectLabel] = useState<string>("");
  const [err, setErr] = useState<string>("");

  // ? Resolve project_code -> UUID (or accept UUID directly)
  useEffect(() => {
    let cancelled = false;

    async function resolveProject() {
      setErr("");
      if (!routeProjectParam) return;

      if (looksLikeUuid(routeProjectParam)) {
        if (!cancelled) {
          setProjectUuid(routeProjectParam);
          setProjectHumanId(routeProjectParam);
        }
      }

      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(routeProjectParam)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));

        const id =
          (json?.project?.id ??
            json?.data?.project?.id ??
            json?.data?.id ??
            json?.item?.id ??
            json?.project_id ??
            json?.id) as string | undefined;

        const code =
          (json?.project?.project_code ??
            json?.project?.code ??
            json?.project_code ??
            json?.code ??
            json?.data?.project_code ??
            json?.data?.code ??
            json?.data?.project?.project_code ??
            json?.data?.project?.code ??
            json?.item?.project_code ??
            json?.item?.code ??
            json?.item?.project?.project_code ??
            json?.item?.project?.code) as string | undefined;

        const title =
          (json?.project?.title ??
            json?.project?.name ??
            json?.title ??
            json?.name ??
            json?.data?.title ??
            json?.data?.name ??
            json?.data?.project?.title ??
            json?.data?.project?.name ??
            json?.item?.title ??
            json?.item?.name ??
            json?.item?.project?.title ??
            json?.item?.project?.name) as string | undefined;

        const label = (code || title || "").toString().trim();

        if (!cancelled) {
          if (label) setProjectLabel(label);
          if (code) setProjectHumanId(String(code).trim() || routeProjectParam);

          if (id && looksLikeUuid(String(id))) {
            setProjectUuid(String(id));
          } else if (looksLikeUuid(routeProjectParam)) {
            setProjectUuid(routeProjectParam);
          } else {
            setProjectUuid("");
            setErr("Project could not be resolved to a UUID. Check /api/projects/[id] supports project_code.");
          }
        }
      } catch {
        if (!cancelled) {
          if (looksLikeUuid(routeProjectParam)) {
            setProjectUuid(routeProjectParam);
          } else {
            setProjectUuid("");
            setErr("Failed to resolve project. Check /api/projects/[id] route.");
          }
        }
      }
    }

    resolveProject();

    return () => {
      cancelled = true;
    };
  }, [routeProjectParam]);

  if (err) {
    return <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm">{err}</div>;
  }

  return (
    <ChangeBoardDnd
      projectUuid={projectUuid}
      projectHumanId={projectHumanId}
      projectLabel={projectLabel}
      artifactId={artifactId}
    />
  );
}
