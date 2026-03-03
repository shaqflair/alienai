import "server-only";

import React from "react";
import { redirect } from "next/navigation";

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

  if (!projectId) redirect("/projects");

  const lower = projectId.toLowerCase();
  if (RESERVED.has(lower)) redirect("/projects");

  if (!looksLikeProjectCode(projectId)) redirect("/projects");

  // ✅ NO MORE RIGHT SIDEBAR
  return (
    <section className="min-h-[calc(100vh-64px)] overflow-auto p-6">
      {children}
    </section>
  );
}