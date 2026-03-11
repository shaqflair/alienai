/**
 * src/app/api/artifacts/weekly-report/export/word/route.ts
 *
 * Exports a WeeklyReportV1 artifact as a polished .docx file.
 * Uses html-to-docx (already in serverExternalPackages).
 *
 * GET /api/artifacts/weekly-report/export/word
 *     ?projectId=<uuid>&artifactId=<uuid>&includeDraft=1
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────────────────── */

type Rag = "green" | "amber" | "red";

interface WeeklyReportV1 {
  version: 1;
  project?: {
    id?: string | null;
    code?: string | null;
    name?: string | null;
    managerName?: string | null;
    managerEmail?: string | null;
  };
  period: { from: string; to: string };
  summary: { rag: Rag; headline: string; narrative: string };
  delivered: Array<{ text: string }>;
  milestones?: Array<{ name: string; due?: string | null; status?: string | null; critical?: boolean }>;
  changes?: Array<{ title: string; status?: string | null }>;
  raid?: Array<{ title: string; type?: string | null; status?: string | null; due?: string | null; owner?: string | null }>;
  planNextWeek: Array<{ text: string }>;
  resourceSummary?: Array<{ text: string }>;
  keyDecisions?: Array<{ text: string; link?: string | null }>;
  blockers?: Array<{ text: string; link?: string | null }>;
  metrics?: Record<string, number>;
  meta?: { generated_at?: string; sources?: any };
}

/* ─────────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────────── */

function safeStr(x: any): string {
  return String(x ?? "").trim();
}

function fmtDate(iso: string | null | undefined): string {
  const v = safeStr(iso);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const RAG_CFG: Record<Rag, { bg: string; border: string; text: string; label: string }> = {
  green: { bg: "#DCFCE7", border: "#16A34A", text: "#15803D", label: "GREEN — ON TRACK" },
  amber: { bg: "#FEF3C7", border: "#D97706", text: "#B45309", label: "AMBER — AT RISK"  },
  red:   { bg: "#FEE2E2", border: "#DC2626", text: "#B91C1C", label: "RED — CRITICAL"   },
};

/* ─────────────────────────────────────────────────────────────────────────
   HTML BUILDER
───────────────────────────────────────────────────────────────────────── */

function buildHtml(model: WeeklyReportV1): string {
  const rag      = (model?.summary?.rag ?? "green") as Rag;
  const ragCfg   = RAG_CFG[rag] ?? RAG_CFG.green;
  const projName = escHtml(safeStr(model?.project?.name) || "Project");
  const projCode = escHtml(safeStr(model?.project?.code));
  const pmName   = escHtml(safeStr(model?.project?.managerName));
  const title    = projCode ? `${projName} (${projCode})` : projName;
  const period   = `${fmtDate(model?.period?.from)} — ${fmtDate(model?.period?.to)}`;
  const today    = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const delivered     = model?.delivered      ?? [];
  const planNextWeek  = model?.planNextWeek   ?? [];
  const resourceSummary = model?.resourceSummary ?? [];
  const keyDecisions  = model?.keyDecisions   ?? [];
  const blockers      = model?.blockers       ?? [];
  const milestones    = model?.milestones     ?? [];

  function bullets(items: Array<{ text: string; link?: string | null }>, empty: string): string {
    if (!items.length) return `<p style="color:#94A3B8;font-style:italic;font-size:11pt;">${empty}</p>`;
    return `<ul>${items.map(it => `<li><span style="font-size:11pt;">${escHtml(safeStr(it.text))}</span></li>`).join("")}</ul>`;
  }

  function milestoneRows(): string {
    if (!milestones.length) return `<tr><td colspan="3" style="color:#94A3B8;font-style:italic;padding:6pt 8pt;font-size:10pt;">No milestones recorded</td></tr>`;
    return milestones.map(m => {
      const statusColor = m.status === "done" ? "#16A34A" : m.status === "at_risk" ? "#D97706" : "#64748B";
      const statusLabel = m.status === "done" ? "Done" : m.status === "at_risk" ? "At Risk" : safeStr(m.status) || "In Progress";
      return `<tr>
        <td style="padding:6pt 8pt;font-size:10pt;border-bottom:1pt solid #E2E8F0;">${escHtml(safeStr(m.name))}${m.critical ? " <span style='color:#DC2626;font-size:9pt;'>★ Critical</span>" : ""}</td>
        <td style="padding:6pt 8pt;font-size:10pt;border-bottom:1pt solid #E2E8F0;color:#64748B;">${fmtDate(m.due) || "—"}</td>
        <td style="padding:6pt 8pt;font-size:10pt;border-bottom:1pt solid #E2E8F0;color:${statusColor};font-weight:bold;">${statusLabel}</td>
      </tr>`;
    }).join("");
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  body        { font-family: Arial, sans-serif; font-size: 11pt; color: #0F172A; margin: 0; padding: 0; }
  h1          { font-size: 22pt; font-weight: bold; color: #0F172A; margin: 0 0 4pt 0; }
  h2          { font-size: 12pt; font-weight: bold; color: #5B4FF0; text-transform: uppercase; letter-spacing: 0.05em; margin: 24pt 0 4pt 0; }
  h3          { font-size: 13pt; font-weight: bold; color: #0F172A; margin: 4pt 0 8pt 0; }
  p           { font-size: 11pt; margin: 0 0 8pt 0; line-height: 1.5; }
  ul          { margin: 4pt 0 8pt 18pt; padding: 0; }
  li          { margin: 3pt 0; line-height: 1.5; }
  table       { width: 100%; border-collapse: collapse; }
  .meta       { font-size: 11pt; color: #475569; margin: 0 0 16pt 0; }
  .rule       { border: none; border-top: 1pt solid #E2E8F0; margin: 16pt 0; }
  .rag-badge  { padding: 10pt 14pt; border-left: 4pt solid ${ragCfg.border}; background: ${ragCfg.bg}; margin: 0 0 16pt 0; }
  .rag-label  { font-size: 12pt; font-weight: bold; color: ${ragCfg.text}; }
  .col-header { font-size: 10pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 4pt; border-bottom: 2pt solid; margin-bottom: 8pt; }
  .col-green  { color: #16A34A; border-color: #16A34A; }
  .col-blue   { color: #3B82F6; border-color: #3B82F6; }
  .col-violet { color: #7C3AED; border-color: #7C3AED; }
  .col-amber  { color: #D97706; border-color: #D97706; }
  .col-red    { color: #DC2626; border-color: #DC2626; }
  .two-col    { width: 100%; border-collapse: collapse; }
  .two-col td { width: 50%; vertical-align: top; padding: 0; }
  .two-col td:first-child { padding-right: 20pt; border-right: 1pt solid #E2E8F0; }
  .two-col td:last-child  { padding-left: 20pt; }
  .three-col  { width: 100%; border-collapse: collapse; }
  .three-col td { width: 33.3%; vertical-align: top; padding: 0; }
  .three-col td:not(:last-child) { padding-right: 16pt; border-right: 1pt solid #E2E8F0; }
  .three-col td:not(:first-child) { padding-left: 16pt; }
  .ms-table   { width: 100%; border-collapse: collapse; margin-top: 8pt; }
  .ms-table th { font-size: 10pt; font-weight: bold; text-align: left; padding: 6pt 8pt; background: #F8FAFC; border-bottom: 2pt solid #E2E8F0; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
  .ms-table td { vertical-align: top; }
  .muted      { font-size: 10pt; color: #94A3B8; font-style: italic; }
  .footer-note { font-size: 9pt; color: #94A3B8; margin-top: 24pt; padding-top: 8pt; border-top: 1pt solid #E2E8F0; }
</style>
</head>
<body>

<!-- TITLE BLOCK -->
<h1>${title}</h1>
<p class="meta">Weekly Report &nbsp;&middot;&nbsp; ${period}${pmName ? ` &nbsp;&middot;&nbsp; PM: ${pmName}` : ""}</p>
<hr class="rule"/>

<!-- RAG BADGE -->
<div class="rag-badge">
  <span class="rag-label">&#9679;&nbsp; ${ragCfg.label}</span>
</div>

<!-- EXECUTIVE SUMMARY -->
<h2>1. Executive Summary</h2>
<h3>${escHtml(safeStr(model?.summary?.headline))}</h3>
<p>${escHtml(safeStr(model?.summary?.narrative))}</p>
<hr class="rule"/>

<!-- DELIVERY: COMPLETED + NEXT PERIOD -->
<h2>2 – 3. Delivery</h2>
<table class="two-col">
  <tr>
    <td>
      <div class="col-header col-green">Completed This Period</div>
      ${bullets(delivered, "No items delivered this period")}
    </td>
    <td>
      <div class="col-header col-blue">Next Period Focus</div>
      ${bullets(planNextWeek, "No items planned")}
    </td>
  </tr>
</table>
<hr class="rule"/>

<!-- RESOURCES / DECISIONS / BLOCKERS -->
<h2>4 – 6. Resources, Decisions &amp; Blockers</h2>
<table class="three-col">
  <tr>
    <td>
      <div class="col-header col-violet">Resources</div>
      ${bullets(resourceSummary, "No resource notes")}
    </td>
    <td>
      <div class="col-header col-amber">Key Decisions</div>
      ${bullets(keyDecisions, "No decisions recorded")}
    </td>
    <td>
      <div class="col-header col-red">Blockers</div>
      ${bullets(blockers, "No blockers")}
    </td>
  </tr>
</table>
${milestones.length ? `
<hr class="rule"/>
<h2>Milestones</h2>
<table class="ms-table">
  <thead>
    <tr>
      <th>Milestone</th>
      <th>Due Date</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>${milestoneRows()}</tbody>
</table>
` : ""}

<p class="footer-note">Generated ${today} &nbsp;&middot;&nbsp; Weekly delivery report &nbsp;&middot;&nbsp; ${period}</p>

</body>
</html>`;
}

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE HANDLER
───────────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId  = searchParams.get("projectId")  ?? "";
  const artifactId = searchParams.get("artifactId") ?? "";

  if (!projectId || !artifactId) {
    return NextResponse.json({ error: "Missing projectId or artifactId" }, { status: 400 });
  }

  /* ── Auth ── */
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* ── Fetch artifact ── */
  const { data: artifact, error } = await supabase
    .from("artifacts")
    .select("content_json, project_id")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  /* ── Parse JSON ── */
  let model: WeeklyReportV1;
  try {
    model = typeof artifact.content_json === "string"
      ? JSON.parse(artifact.content_json)
      : artifact.content_json;
  } catch {
    return NextResponse.json({ error: "Invalid artifact JSON" }, { status: 422 });
  }

  /* ── Build HTML → DOCX ── */
  try {
    const htmlToDocx = (await import("html-to-docx")).default;

    const html = buildHtml(model);

    const buffer = await htmlToDocx(html, null, {
      orientation: "portrait",
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      font: "Arial",
      fontSize: 22,
      table: { row: { cantSplit: true } },
      header: true,
      footer: true,
    }) as Buffer;

    const projCode = safeStr(model?.project?.code) || "Project";
    const from     = safeStr(model?.period?.from);
    const to       = safeStr(model?.period?.to);
    const filename = `Weekly Report - ${projCode} - ${from}_to_${to}.docx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control":       "no-store",
      },
    });
  } catch (e: any) {
    console.error("[weekly-report/export/word] Error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Word export failed" },
      { status: 500 },
    );
  }
}