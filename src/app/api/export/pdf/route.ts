import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

type RowObj = { type: "header" | "data"; cells: string[] };
type CharterSection = {
  key: string;
  title: string;
  bullets?: string;
  table?: { columns: number; rows: RowObj[] };
  columns?: string[];
  rows?: string[][];
};

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function safeString(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function formatUkDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function isV2Charter(doc: any) {
  return !!doc && typeof doc === "object" && Number(doc.version) === 2 && Array.isArray(doc.sections);
}

function normalizeSections(doc: any): CharterSection[] {
  const sections: any[] = Array.isArray(doc?.sections) ? doc.sections : [];
  return sections.map((s) => ({
    key: safeString(s?.key),
    title: safeString(s?.title),
    bullets: typeof s?.bullets === "string" ? s.bullets : undefined,
    table: s?.table && Array.isArray(s.table.rows) ? s.table : undefined,
    columns: Array.isArray(s?.columns) ? s.columns : undefined,
    rows: Array.isArray(s?.rows) ? s.rows : undefined,
  }));
}

function tableFromLegacy(sec: CharterSection): { columns: number; rows: RowObj[] } | null {
  if (sec.table?.rows?.length) return sec.table;

  const cols = Array.isArray(sec.columns) ? sec.columns.map((c) => safeString(c)) : [];
  const rows = Array.isArray(sec.rows) ? sec.rows : [];
  const colCount = Math.max(1, cols.length || rows[0]?.length || 1);

  if (!cols.length && !rows.length) return null;

  const headerCells =
    cols.length > 0 ? cols.slice(0, colCount) : Array.from({ length: colCount }, () => "");

  const outRows: RowObj[] = [{ type: "header", cells: headerCells }];
  for (const r of rows) {
    outRows.push({ type: "data", cells: (r ?? []).slice(0, colCount).map((x) => safeString(x)) });
  }
  if (outRows.length === 1) outRows.push({ type: "data", cells: Array.from({ length: colCount }, () => "") });

  return { columns: colCount, rows: outRows };
}

function bulletsToList(bullets?: string) {
  const items = String(bullets || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!items.length) return `<div class="muted">No content yet.</div>`;

  return `<ul class="bullets">${items.map((it) => `<li>${escapeHtml(it)}</li>`).join("")}</ul>`;
}

function escapeHtml(s: string) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderCharterHtml(args: {
  doc: any;
  meta: {
    projectName: string;
    projectCode?: string | null;
    organisationName?: string | null;
    generatedIso: string;
    pmName?: string | null;
    logoUrl?: string | null;
    title?: string | null;
  };
}) {
  const { doc, meta } = args;
  const sections = normalizeSections(doc);

  const generated = formatUkDateTime(meta.generatedIso);
  const orgName = safeString(meta.organisationName || "");
  const projectName = safeString(meta.projectName || "");
  const projectCode = safeString(meta.projectCode || "");
  const pmName = safeString(meta.pmName || "");
  const title = safeString(meta.title || "Project Charter");
  const logoUrl = safeString(meta.logoUrl || "");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root{
      --bg:#F8FAFC;
      --card:#FFFFFF;
      --text:#0F172A;
      --muted:#64748B;
      --border:#E2E8F0;
      --soft:#F1F5F9;
      --accent:#2563EB;
    }
    *{box-sizing:border-box;}
    html,body{height:100%;}
    body{
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      color:var(--text);
      background:var(--bg);
    }
    .page{ padding: 28px 34px; }
    .header{ display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:14px; }
    .h1{ font-size:34px; font-weight:800; letter-spacing:-0.02em; margin:0 0 6px 0; line-height:1.05; }
    .sub{ margin:0; color:var(--muted); font-size:13px; display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center; }
    .pill{ display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid var(--border); background:var(--card); border-radius:999px; font-size:12px; color:#0F172A; }
    .logoWrap img{ max-width:140px; max-height:56px; object-fit:contain; }
    .grid{ display:flex; flex-direction:column; gap:12px; margin-top:10px; }
    .section{ background:var(--card); border:1px solid var(--border); border-radius:14px; overflow:hidden; page-break-inside:avoid; }
    .section-head{ padding:12px 14px; background:linear-gradient(180deg, #FFFFFF, var(--soft)); border-bottom:1px solid var(--border); }
    .section-title{ margin:0; font-size:14px; font-weight:800; }
    .section-body{ padding:12px 14px 14px 14px; font-size:12.5px; }
    .muted{ color:var(--muted); font-size:12px; }
    .bullets{ margin:0; padding-left:18px; display:flex; flex-direction:column; gap:6px; }
    table{ width:100%; border-collapse:separate; border-spacing:0; border:1px solid var(--border); border-radius:12px; table-layout:fixed; background:#fff; overflow:hidden; }
    thead th{ background:var(--soft); border-bottom:1px solid var(--border); text-align:left; font-size:11px; padding:9px 10px; font-weight:700; }
    tbody td{ border-bottom:1px solid var(--border); padding:9px 10px; font-size:11.5px; vertical-align:top; word-wrap:break-word; }
    tbody tr:last-child td{ border-bottom:none; }
    @page { margin: 18mm 14mm; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-left">
        <h1 class="h1">${escapeHtml(projectName || title)}</h1>
        <p class="sub">
          <span class="pill"><strong>Document</strong>&nbsp;${escapeHtml(title)}</span>
          <span class="pill"><strong>Organisation</strong>&nbsp;${escapeHtml(orgName || "—")}</span>
          <span class="pill"><strong>Project ID</strong>&nbsp;${escapeHtml(projectCode || "—")}</span>
          <span class="pill"><strong>Generated</strong>&nbsp;${escapeHtml(generated)}</span>
          <span class="pill"><strong>PM</strong>&nbsp;${escapeHtml(pmName || "—")}</span>
        </p>
      </div>
      <div class="logoWrap">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Logo" />` : ""}</div>
    </div>
    <div class="grid">
      ${sections.map((sec) => `
        <section class="section">
          <div class="section-head"><h2 class="section-title">${escapeHtml(sec.title || sec.key || "Section")}</h2></div>
          <div class="section-body">${tableFromLegacy(sec) ? renderTableHtml(tableFromLegacy(sec)!) : bulletsToList(sec.bullets)}</div>
        </section>`).join("")}
    </div>
  </div>
</body>
</html>`;
}

function renderTableHtml(table: { columns: number; rows: RowObj[] }) {
  const header = table.rows.find((r) => r.type === "header")?.cells ?? [];
  const data = table.rows.filter((r) => r.type === "data");
  const colCount = Math.max(1, table.columns || header.length || (data[0]?.cells?.length ?? 1));
  return `
    <table>
      <thead><tr>${Array.from({ length: colCount }, (_, i) => `<th>${escapeHtml(safeString(header[i] ?? "")) || "&nbsp;"}</th>`).join("")}</tr></thead>
      <tbody>
        ${data.length ? data.map(r => `<tr>${Array.from({ length: colCount }, (_, i) => `<td>${escapeHtml(safeString(r.cells?.[i] ?? "")) || "&nbsp;"}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${colCount}" class="muted">No rows yet.</td></tr>`}
      </tbody>
    </table>`;
}

async function getPuppeteer() {
  const mod = await import("puppeteer");
  return mod.default || mod;
}

async function handle(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = safeString(body?.projectId || body?.project_id);
    const artifactId = safeString(body?.artifactId || body?.artifact_id);
    if (!projectId || !artifactId) return jsonErr("Missing projectId/artifactId", 400);

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const { data: project } = await supabase.from("projects").select("title,project_code,organisation_id").eq("id", projectId).single();
    if (!project) return jsonErr("Project not found", 404);

    let organisationName = null, logoUrl = null;
    if (project.organisation_id) {
      const { data: org } = await supabase.from("organisations").select("name").eq("id", project.organisation_id).single();
      organisationName = org?.name;
      const { data: settings } = await supabase.from("org_settings").select("logo_url").eq("organisation_id", project.organisation_id).single();
      logoUrl = settings?.logo_url;
    }

    const { data: artifact } = await supabase.from("artifacts").select("content_json").eq("id", artifactId).single();
    if (!isV2Charter(artifact?.content_json)) return jsonErr("Invalid Charter content", 400);

    const html = renderCharterHtml({
      doc: artifact.content_json,
      meta: {
        projectName: project.title,
        projectCode: project.project_code,
        organisationName,
        generatedIso: new Date().toISOString(),
        pmName: artifact.content_json.meta?.pm_name,
        logoUrl,
        title: body?.title,
      },
    });

    const puppeteer = await getPuppeteer();
    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `<div></div>`,
        footerTemplate: `<div style="font-size:9px; width:100%; padding:0 14mm; color:#64748B; display:flex; justify-content:space-between;">
          <div>${escapeHtml(project.title)}</div>
          <div>Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>
        </div>`,
        margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
      });

      const fileBase = project.title.replace(/[^a-z0-9]/gi, "_");
      return new NextResponse(pdf, {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileBase}_Project_Charter.pdf"` },
      });
    } finally {
      await browser.close();
    }
  } catch (e: any) {
    return jsonErr(e.message, 500);
  }
}


export async function GET(req: NextRequest, ctx: any) {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: any) {
  return handle(req, ctx);
}


