"use client";
import type { ManagerFilterResult } from "@/app/heatmap/_lib/manager-filter";

export default function ManagerFilterBanner({
  managerFilter,
}: {
  managerFilter: ManagerFilterResult;
}) {
  if (!managerFilter.active) return null;

  return (
    <div style={{
      padding: "10px 16px", borderRadius: "9px",
      background: "rgba(14,116,144,0.08)",
      border: "1.5px solid rgba(14,116,144,0.2)",
      display: "flex", alignItems: "center",
      justifyContent: "space-between", gap: "12px",
      marginBottom: "12px", fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ fontSize: "12px", color: "#0e7490" }}>
        <strong>Manager view:</strong> showing {managerFilter.directReportIds.length} direct report
        {managerFilter.directReportIds.length !== 1 ? "s" : ""} of{" "}
        <strong>{managerFilter.managerName ?? "this manager"}</strong>
      </div>
      <a href="/heatmap" style={{
        fontSize: "11px", fontWeight: 700, color: "#0e7490",
        textDecoration: "none",
        padding: "4px 10px", borderRadius: "6px",
        border: "1.5px solid rgba(14,116,144,0.25)",
        background: "white",
      }}>
        Clear filter
      </a>
    </div>
  );
}
