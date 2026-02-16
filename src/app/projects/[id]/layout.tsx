// src/app/projects/[id]/layout.tsx
import "server-only";

import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import ArtifactsSidebar from "./artifacts/ArtifactsSidebar";

/* =========================================================
   helpers
========================================================= */

function safeParam(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function normalizeId(raw: string) {
  let v = safeStr(raw).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  return v.trim();
}

function looksLikeProjectCode(input: string) {
  // Accept: UUID, "100011", "00001", "P-00001", "p00001"
  const s = normalizeId(input).toUpperCase();
  if (!s) return false;
  if (looksLikeUuid(s)) return true;

  const m = s.match(/(\d{1,10})/);
  if (!m?.[1]) return false;

  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0;
}

const RESERVED = new Set([
  "artifacts",
  "changes",
  "change",
  "members",
  "approvals",
  "lessons",
  "raid",
  "schedule",
  "wbs",
]);

/* =========================================================
   layout
========================================================= */

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await params;

  const projectId = normalizeId(safeParam(id));

  // ✅ Always bounce invalid/missing IDs back to /projects (avoid NEXT_HTTP_ERROR_FALLBACK;404)
  if (!projectId) redirect("/projects");

  // ✅ Guard: /projects/artifacts, /projects/members etc should not be treated as a project id
  const lower = projectId.toLowerCase();
  if (RESERVED.has(lower)) redirect("/projects");

  // ✅ Guard: prevent 22P02 spam by only allowing uuid or numeric-ish codes
  if (!looksLikeProjectCode(projectId)) redirect("/projects");

  return (
    <div className="flex min-h-[calc(100vh-64px)] overflow-x-hidden">
      <Suspense
        fallback={
          <aside className="w-[320px] shrink-0 border-r border-gray-200 bg-white">
            <div className="p-4 text-sm text-gray-500">Loading sidebar…</div>
          </aside>
        }
      >
        <ArtifactsSidebar projectId={projectId} />
      </Suspense>

      <section className="min-w-0 flex-1 overflow-auto p-6">{children}</section>
    </div>
  );
}
