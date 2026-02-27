// src/app/api/executive/digest/pdf/route.ts — v2
// ✅ FIX: Normalise digest sections to support BOTH shapes:
//    - digest.sections.pending_approvals (new)
//    - digest.sections.sla_breaches (legacy/alt)
// ✅ FIX: Guard against missing digest / failed fetch
// ✅ Keeps output as PDF-ready HTML

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ss = (x: any) => (typeof x === "string" ? x : x == null ? "" : String(x));
const sn = (x: any) => {
  const n = Number(x);
  return isFinite(n) ? n : 0;
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function ragColor(status: string) {
  const s = ss(status).toLowerCase();
  if (s === "overdue" || s === "breached" || s === "overdue_undecided" || s === "high") return "#e11d48";
  if (s === "warn" || s === "at_risk" || s === "medium") return "#d97706";
  return "#059669";
}

function ragLabel(status: string) {
  const s = ss(status).toLowerCase();
  if (s === "overdue" || s === "breached" || s === "overdue_undecided") return "BREACHED";
  if (s === "warn" || s === "at_risk") return "AT RISK";
  if (s === "high") return "HIGH RISK";
  if (s === "medium") return "MEDIUM RISK";
  return "OK";
}

function normalisePending(digest: any) {
  const sections = digest?.sections ?? {};
  // Prefer pending_approvals, else fall back to sla_breaches, else empty
  const base =
    sections?.pending_approvals ??
    sections?.sla_breaches ??
    { total: 0, breached: 0, at_risk: 0, items: [] };

  // Ensure shape
  return {
    total: Number(base?.total ?? 0),
    breached: Number(base?.breached ?? 0),
    at_risk: Number(base?.at_risk ?? 0),
    items: Array.isArray(base?.items) ? base.items : [],
  };
}

function buildHtml(digest: any, days: number): string {
  const sum = digest?.summary ?? {};
  const genDate = fmtDate(digest?.generated_at);
  const windowLabel = `Last ${days} day${days !== 1 ? "s" : ""}`;

  const pending = normalisePending(digest);
  const pmPerf = Array.isArray(digest?.sections?.pm_performance) ? digest.sections.pm_performance : [];
  const decisions = digest?.sections?.decisions ?? { total: 0, approved: 0, rejected: 0, approval_rate: null, recent: [] };

  const sectionHeader = (title: string, count?: number) => `
    <div style="display:flex;align-items:center;gap:10px;margin:28px 0 12px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">
      <div style="font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:0.1em;">${title}</div>
      ${count !== undefined ? `<div style="background:#6366f1;color:white;border-radius:20px;padding:1px 8px;font-size:10px;font-weight:700;">${count}</div>` : ""}
    </div>`;

  const statCard = (label: string, value: string | number, color: string) => `
    <div style="background:#f8faff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;text-align:center;flex:1;">
      <div style="font-size:22px;font-weight:800;color:${color};font-family:monospace;line-height:1;">${value}</div>
      <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-top:4px;">${label}</div>
    </div>`;

  const tr = (cells: string[], header = false) => `
    <tr style="background:${header ? "#f1f5f9" : "white"};">
      ${cells
        .map(
          (c) =>
            `<td style="padding:7px 10px;font-size:${header ? "9px" : "11px"};font-weight:${
              header ? "700" : "400"
            };color:${header ? "#64748b" : "#374151"};border-bottom:1px solid #f1f5f9;">${c}</td>`
        )
        .join("")}
    </tr>`;

  const badge = (text: string, color: string) =>
    `<span style="display:inline-block;border-radius:20px;padding:2px 8px;font-size:9px;font-weight:700;background:${color}18;border:1px solid ${color}44;color:${color};">${text}</span>`;

  const pendingRows =
    pending.items.length > 0
      ? pending.items
          .slice(0, 40)
          .map((r: any) =>
            tr([
              `${ss(r?.project_title) || "—"} ${r?.project_code ? `<span style="color:#4338ca;font-weight:700;font-family:monospace;font-size:10px;margin-left:6px;">${ss(r.project_code)}</span>` : ""}`,
              ss(r?.approver_label) || "—",
              badge(ragLabel(ss(r?.sla_status)), ragColor(ss(r?.sla_status))),
            ])
          )
          .join("")
      : tr([`<span style="color:#10b981;font-weight:700;">✓ No pending approvals</span>`, "—", "—"]);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 40px; color: #374151; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div style="border-bottom:3px solid #6366f1; padding-bottom:20px; margin-bottom:28px;">
    <h1 style="font-size:26px; color:#0f172a;">Portfolio Governance Report</h1>
    <div style="color:#64748b;">${windowLabel} · Generated ${genDate}</div>
    <div style="color:#64748b; margin-top:6px;">
      Projects: <b>${Number(sum?.active_projects ?? 0)}</b> active
      ${sum?.total_projects != null ? ` of <b>${Number(sum.total_projects)}</b> total` : ""}
    </div>
  </div>

  <div style="display:flex; gap:10px; margin-bottom:28px;">
    ${statCard("Pending", Number(sum?.pending_total ?? pending.total), "#6366f1")}
    ${statCard("Breached", Number(sum?.breached_total ?? pending.breached), "#e11d48")}
    ${statCard("Decisions", Number(sum?.decisions_total ?? decisions?.total ?? 0), "#0f172a")}
    ${statCard("High Risk", Number(sum?.at_risk_projects ?? 0), "#e11d48")}
  </div>

  ${sectionHeader("Pending Approvals (incl. Breaches)", pending.total)}
  <table>
    ${tr(["Project", "Approver", "Status"], true)}
    ${pendingRows}
  </table>

  ${sectionHeader("PM Performance")}
  <table>
    ${tr(["PM", "Projects", "Approval Rate", "Overdue"], true)}
    ${
      pmPerf.length
        ? pmPerf
            .slice(0, 50)
            .map((pm: any) =>
              tr([
                ss(pm?.full_name) || "—",
                String(pm?.projects_managed ?? 0),
                pm?.approval_rate != null ? `${pm.approval_rate}%` : "N/A",
                String(pm?.overdue ?? 0),
              ])
            )
            .join("")
        : tr([`<span style="color:#94a3b8;">No PM data</span>`, "—", "—", "—"])
    }
  </table>

  <div style="margin-top:40px; font-size:10px; color:#94a3b8;">Generated by Aliena AI · Confidential</div>
</body>
</html>`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(sn(url.searchParams.get("days") ?? "7"), 1), 90);

    const supabase = await createClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) return new NextResponse("Unauthorized", { status: 401 });

    const digestResp = await fetch(`${url.origin}/api/executive/digest?days=${days}`, {
      headers: { Cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });

    const json = await digestResp.json().catch(() => null);

    if (!json?.ok || !json?.digest) {
      return new NextResponse("Digest unavailable", { status: 502 });
    }

    const html = buildHtml(json.digest, days);
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return new NextResponse(e?.message ?? String(e), { status: 500 });
  }
}