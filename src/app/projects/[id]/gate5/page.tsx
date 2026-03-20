// src/app/projects/[id]/gate5/page.tsx
import "server-only";
import React from "react";
import { notFound } from "next/navigation";
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
  const p = await params;
  const projectParam = normParam(p?.id);
  if (!projectParam) notFound();

  const supabase = await createClient();

  // Resolve human ID → UUID if needed
  const { data: project } = await supabase
    .from("projects")
    .select("id, title, finish_date, end_date, target_end_date")
    .or(`id.eq.${projectParam},project_code.eq.${projectParam},human_id.eq.${projectParam}`)
    .maybeSingle();

  if (!project) notFound();
  const projectId = String((project as any).id);

  const gate5Data = await loadGate5Status(projectId);

  return (
    <div className="w-full" style={{ background: "#f6f8fa", minHeight: "100vh", padding: "24px" }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#64748b", marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>
          <span>Projects</span>
          <span>/</span>
          <span style={{ color: "#0f172a", fontWeight: 500 }}>{(project as any).title || "Project"}</span>
          <span>/</span>
          <span style={{ color: "#0f172a", fontWeight: 500 }}>Gate 5</span>
        </div>
        <div
          style={{
            padding: "16px 20px",
            borderRadius: 12,
            background: "#fff",
            border: "1px solid #e8ecf0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#0f172a", fontFamily: "'DM Sans', sans-serif" }}>
              Gate 5 — Project Closure
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b", fontFamily: "'DM Sans', sans-serif" }}>
              All activities must be complete before the project can formally close.
              Automated checks update live as your project data changes.
            </p>
          </div>
          <div
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              fontSize: 28,
              fontWeight: 600,
              background: gate5Data.canClose ? "#dcfce7" : gate5Data.riskLevel === "red" ? "#fee2e2" : "#fef3c7",
              color: gate5Data.canClose ? "#15803d" : gate5Data.riskLevel === "red" ? "#b91c1c" : "#92400e",
              fontFamily: "'DM Mono', monospace",
              flexShrink: 0,
            }}
          >
            {gate5Data.readinessScore}%
          </div>
        </div>
      </div>

      {/* Main panel */}
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e8ecf0",
          padding: "24px",
        }}
      >
        <Gate5Panel projectId={projectId} initialData={gate5Data} />
      </div>
    </div>
  );
}