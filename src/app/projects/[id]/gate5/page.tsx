// src/app/projects/[id]/gate5/page.tsx
import "server-only";
import React from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { loadGate5Status } from "./gate5-actions";
import Gate5Panel from "@/components/gate5/Gate5Panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normParam(v: any) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s === "undefined" || s === "null") return "";
  return s;
}

export default async function Gate5Page({
  params,
}: {
  params: Promise<{ id?: string }>;
}) {
  const supabase = await createClient();

  // Auth check first
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) redirect("/login");

  const p = await params;
  const projectParam = normParam(p?.id);
  if (!projectParam) notFound();

  // Fetch project — use same broad select as main project page
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, title, finish_date, status, organisation_id")
    .eq("id", projectParam)
    .maybeSingle();

  if (projErr || !project) {
    // Try by project_code as fallback
    const { data: byCode } = await supabase
      .from("projects")
      .select("id, title, finish_date, status, organisation_id")
      .eq("project_code", projectParam)
      .maybeSingle();
    if (!byCode) notFound();
  }

  const resolvedProject = project ?? null;
  if (!resolvedProject) notFound();

  const projectId = String((resolvedProject as any).id);
  const projectTitle = String((resolvedProject as any).title || "Project");

  // Load gate5 data — returns null if tables don't exist yet
  let gate5Data;
  try {
    gate5Data = await loadGate5Status(projectId);
  } catch {
    gate5Data = null;
  }

  // Provide a safe default if gate5 tables don't exist yet
  const safeGate5 = gate5Data ?? {
    checks: [],
    totalChecks: 0,
    passedChecks: 0,
    mandatoryBlocked: 0,
    readinessScore: 0,
    daysToEndDate: null,
    endDate: null,
    riskLevel: "amber" as const,
    canClose: false,
  };

  const scoreColor = safeGate5.canClose
    ? { bg: "#dcfce7", text: "#15803d" }
    : safeGate5.riskLevel === "red"
    ? { bg: "#fee2e2", text: "#b91c1c" }
    : { bg: "#fef3c7", text: "#92400e" };

  return (
    <div style={{ background: "#f6f8fa", minHeight: "100vh", padding: "24px", fontFamily: "'DM Sans', -apple-system, sans-serif" }}>

      {/* Breadcrumb + header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#64748b", marginBottom: 12 }}>
          <a href="/projects" style={{ color: "#64748b", textDecoration: "none" }}>Projects</a>
          <span>/</span>
          <a href={`/projects/${projectId}`} style={{ color: "#64748b", textDecoration: "none" }}>{projectTitle}</a>
          <span>/</span>
          <span style={{ color: "#0f172a", fontWeight: 600 }}>Gate 5</span>
        </div>

        <div style={{
          padding: "20px 24px",
          borderRadius: 12,
          background: "#fff",
          border: "1px solid #e8ecf0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: scoreColor.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: scoreColor.text, fontFamily: "monospace" }}>G5</span>
              </div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
                Gate 5 — Project Closure Readiness
              </h1>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b", maxWidth: 560 }}>
              All activities must be complete before the project can formally close.
              Automated checks update live as your project data changes.
            </p>
          </div>
          <div style={{
            padding: "12px 24px",
            borderRadius: 10,
            background: scoreColor.bg,
            color: scoreColor.text,
            textAlign: "center",
            flexShrink: 0,
          }}>
            <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "monospace", lineHeight: 1 }}>
              {safeGate5.readinessScore}%
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {safeGate5.canClose ? "Ready to close" : safeGate5.riskLevel === "red" ? "Not ready" : "In progress"}
            </div>
          </div>
        </div>
      </div>

      {/* Main panel */}
      <div style={{
        background: "#fff",
        borderRadius: 12,
        border: "1px solid #e8ecf0",
        padding: "24px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}>
        <Gate5Panel projectId={projectId} initialData={safeGate5} />
      </div>
    </div>
  );
}