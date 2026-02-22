// src/components/change/ChangeManagementBoard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";

/**
 * Heavy UI (DnD + drawers + modals) is loaded dynamically
 * so the initial bundle stays small and first paint is instant.
 */
const ChangeBoardDnd = dynamic(() => import("./ChangeBoardDnd"), {
  ssr: false,
  loading: () => <KanbanSkeleton />,
});

/* ─────────────────────── Skeleton ─────────────────────── */

const COLUMNS = [
  { key: "new", title: "Intake", color: "#94a3b8", accent: "#e2e8f0" },
  { key: "analysis", title: "Analysis", color: "#f59e0b", accent: "#fef3c7" },
  { key: "review", title: "Review", color: "#6366f1", accent: "#ede9fe" },
  { key: "in_progress", title: "Implementation", color: "#3b82f6", accent: "#dbeafe" },
  { key: "implemented", title: "Implemented", color: "#10b981", accent: "#d1fae5" },
  { key: "closed", title: "Closed", color: "#64748b", accent: "#f1f5f9" },
];

function KanbanSkeleton() {
  return (
    <div style={{ minHeight: "100vh", background: "#f5f6fa", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @keyframes kb-shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .kb-shimmer {
          background: linear-gradient(90deg, #eceef5 25%, #f4f5fb 50%, #eceef5 75%);
          background-size: 800px 100%;
          animation: kb-shimmer 1.4s ease infinite;
          border-radius: 8px;
        }
        .kb-board-header {
          padding: 20px 28px 16px;
          border-bottom: 1px solid #e8eaf0;
          background: white;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .kb-board-title {
          font-size: 18px;
          font-weight: 700;
          color: #1e2235;
          letter-spacing: -0.02em;
        }
        .kb-board-sub {
          font-size: 13px;
          color: #9ba3ba;
          margin-top: 2px;
        }
        .kb-columns {
          display: flex;
          gap: 14px;
          padding: 20px 28px 28px;
          overflow-x: auto;
          align-items: flex-start;
        }
        .kb-col {
          min-width: 280px;
          width: 280px;
          flex-shrink: 0;
          background: white;
          border-radius: 14px;
          border: 1px solid #e8eaf0;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }
        .kb-col-header {
          padding: 13px 14px 11px;
          border-bottom: 1px solid #f0f1f7;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .kb-col-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .kb-col-title {
          font-size: 12px;
          font-weight: 700;
          color: #1e2235;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          flex: 1;
        }
        .kb-col-count {
          font-size: 11px;
          font-weight: 600;
          color: #9ba3ba;
          background: #f4f5f9;
          padding: 2px 7px;
          border-radius: 20px;
        }
        .kb-col-body {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 420px;
        }
        .kb-card-skel {
          border-radius: 10px;
          height: 88px;
        }
      `}</style>
      <div className="kb-board-header">
        <div>
          <div className="kb-board-title">Change Board</div>
          <div className="kb-board-sub">Loading board…</div>
        </div>
      </div>
      <div className="kb-columns">
        {COLUMNS.map((col) => (
          <div key={col.key} className="kb-col">
            <div className="kb-col-header">
              <div className="kb-col-dot" style={{ background: col.color }} />
              <div className="kb-col-title">{col.title}</div>
              <div className="kb-col-count">—</div>
            </div>
            <div className="kb-col-body">
              {[88, 108, 72].map((h, i) => (
                <div key={i} className="kb-shimmer kb-card-skel" style={{ height: h }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── Helpers ─────────────────────── */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function looksLikePublicId(x: string) {
  const t = String(x || "").trim();
  return /^cr-\d+$/i.test(t) || /^cr\d+$/i.test(t);
}

function normalizePublicId(x: string) {
  const t = String(x || "").trim();
  const m = t.match(/cr[-_\s]*(\d+)/i);
  return m?.[1] ? `cr-${m[1]}` : t.toLowerCase();
}

/* ─────────────────────── Board Shell ─────────────────────── */

export default function ChangeBoard() {
  const params = useParams() as any;
  const searchParams = useSearchParams();

  const routeProjectParam = safeStr(params?.id || params?.projectId).trim();
  const artifactId = safeStr(params?.artifactId).trim() || null;

  // ✅ deep link support:
  // /projects/:id/change?cr=<uuid>
  // /projects/:id/change?publicId=cr-123
  const initialOpen = useMemo(() => {
    const cr = safeStr(searchParams?.get("cr")).trim();
    const publicId = safeStr(searchParams?.get("publicId")).trim();

    return {
      cr: looksLikeUuid(cr) ? cr : "",
      publicId: publicId
        ? looksLikePublicId(publicId)
          ? normalizePublicId(publicId)
          : publicId
        : "",
    };
  }, [searchParams]);

  const [projectHumanId, setProjectHumanId] = useState<string>(routeProjectParam);
  const [projectUuid, setProjectUuid] = useState<string>("");
  const [projectLabel, setProjectLabel] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  // Resolve project_code -> UUID (or accept UUID directly)
  useEffect(() => {
    let cancelled = false;

    async function resolveProject() {
      setErr("");
      setLoading(true);

      if (!routeProjectParam) {
        if (!cancelled) setLoading(false);
        return;
      }

      // ✅ If it's already a UUID, DO NOT call the API.
      if (looksLikeUuid(routeProjectParam)) {
        if (!cancelled) {
          setProjectUuid(routeProjectParam);
          setProjectHumanId(routeProjectParam);
          setProjectLabel("");
          setLoading(false);
        }
        return;
      }

      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(routeProjectParam)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));

        const id = (json?.project?.id ?? json?.data?.project?.id ?? json?.data?.id ?? json?.item?.id ?? json?.project_id ?? json?.id) as string | undefined;
        const code = (json?.project?.project_code ?? json?.project?.code ?? json?.project_code ?? json?.code ?? json?.data?.project_code ?? json?.data?.code ?? json?.data?.project?.project_code ?? json?.data?.project?.code ?? json?.item?.project_code ?? json?.item?.code ?? json?.item?.project?.project_code ?? json?.item?.project?.code) as string | undefined;
        const title = (json?.project?.title ?? json?.project?.name ?? json?.title ?? json?.name ?? json?.data?.title ?? json?.data?.name ?? json?.data?.project?.title ?? json?.data?.project?.name ?? json?.item?.title ?? json?.item?.name ?? json?.item?.project?.title ?? json?.item?.project?.name) as string | undefined;

        const label = (code || title || "").toString().trim();

        if (!cancelled) {
          if (label) setProjectLabel(label);
          if (code) setProjectHumanId(String(code).trim() || routeProjectParam);

          if (id && looksLikeUuid(String(id))) {
            setProjectUuid(String(id));
            setErr("");
          } else {
            setProjectUuid("");
            setErr("Project could not be resolved to a UUID. Check /api/projects/[id] supports project_code.");
          }
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setProjectUuid("");
          setErr("Failed to resolve project. Check /api/projects/[id] route.");
          setLoading(false);
        }
      }
    }

    resolveProject();
    return () => { cancelled = true; };
  }, [routeProjectParam]);

  if (err) {
    return (
      <div style={{
        margin: 24,
        padding: "14px 18px",
        borderRadius: 10,
        border: "1px solid rgba(239,68,68,0.25)",
        background: "rgba(239,68,68,0.06)",
        color: "#dc2626",
        fontSize: 13,
        fontFamily: "system-ui, sans-serif",
      }}>
        {err}
      </div>
    );
  }

  if (loading || !projectUuid) {
    return (
      <div style={{
        margin: 24,
        padding: "14px 18px",
        borderRadius: 10,
        border: "1px solid #e8eaf0",
        background: "#f8f9fc",
        color: "#6b7280",
        fontSize: 13,
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Resolving project…
      </div>
    );
  }

  return (
    <ChangeBoardDnd
      projectUuid={projectUuid}
      projectHumanId={projectHumanId}
      projectLabel={projectLabel}
      artifactId={artifactId}
      // ✅ new props (safe even if DnD ignores them)
      initialOpenChangeId={initialOpen.cr || undefined}
      initialOpenPublicId={initialOpen.publicId || undefined}
    />
  );
}