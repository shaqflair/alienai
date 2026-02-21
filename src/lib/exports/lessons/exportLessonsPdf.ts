// src/lib/exports/lessons/exportLessonsPdf.ts
import "server-only";

import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

type ExportLessonsPdfArgs = {
  supabase: any;
  artifactId: string | null;
  status?: string[] | null;
  filenameBase?: string | null;
};

type LessonsItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  impact: string;
  recommendation: string;
  owner: string;
  dateIdentified: string | null; // YYYY-MM-DD or ISO
  createdAt: string | null;
  updatedAt: string | null;
  tags: string[];
};

type LessonsExportModel = {
  artifactId: string;
  artifactTitle: string;
  projectId: string | null;
  projectTitle: string;
  clientName: string;
  orgName: string;
  generatedAtIso: string;
  statusFilter: string[] | null;
  items: LessonsItem[];
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeJson(x: any) {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function slugifyFilename(name: string) {
  const base = safeStr(name).trim() || "lessons-learned";
  return base
    .replace(/[^\w\s\-().]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatUkDate(isoOrYmd: string | null | undefined) {
  const s = safeStr(isoOrYmd).trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatUkDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

/**
 * Best-effort: pulls org/client/project display fields if your schema has them.
 * If not present, returns blanks.
 */
async function getProjectContext(supabase: any, projectId: string | null) {
  if (!projectId || !looksLikeUuid(projectId)) {
    return { projectTitle: "", clientName: "", orgName: "" };
  }

  // Try a projects row with common fields
  const { data: proj, error: projErr } = await supabase
    .from("projects")
    .select("id,title,client_name,org_name,organisation_name,organization_name")
    .eq("id", projectId)
    .maybeSingle();

  if (!projErr && proj) {
    return {
      projectTitle: safeStr(proj.title),
      clientName: safeStr(proj.client_name),
      orgName: safeStr(proj.org_name || proj.organisation_name || proj.organization_name),
    };
  }

  // Fallback: just empty
  return { projectTitle: "", clientName: "", orgName: "" };
}

function normalizeLessonsFromArtifactDoc(doc: any): LessonsItem[] {
  // Support multiple possible shapes:
  // - { lessons: [...] }
  // - { items: [...] }
  // - { rows: [...] }
  const arr =
    (Array.isArray(doc?.lessons) ? doc.lessons : null) ||
    (Array.isArray(doc?.items) ? doc.items : null) ||
    (Array.isArray(doc?.rows) ? doc.rows : null) ||
    [];

  return arr
    .map((x: any, idx: number) => {
      const id = safeStr(x?.id) || `row-${idx + 1}`;
      const title = safeStr(x?.title || x?.lesson || x?.summary || x?.name);
      const description = safeStr(x?.description || x?.details || x?.what_happened || x?.observation);
      const category = safeStr(x?.category || x?.theme || x?.area);
      const status = safeStr(x?.status || x?.state || "Open");
      const impact = safeStr(x?.impact || x?.impact_statement || x?.consequence);
      const recommendation = safeStr(x?.recommendation || x?.action || x?.proposal || x?.resolution);
      const owner = safeStr(x?.owner || x?.assigned_to || x?.assignee);
      const dateIdentified = safeStr(x?.dateIdentified || x?.date_identified || x?.date || x?.identified_on) || null;
      const createdAt = safeStr(x?.created_at || x?.createdAt) || null;
      const updatedAt = safeStr(x?.updated_at || x?.updatedAt) || null;
      const tags = Array.isArray(x?.tags) ? x.tags.map((t: any) => safeStr(t)).filter(Boolean) : [];

      return {
        id,
        title,
        description,
        category,
        status,
        impact,
        recommendation,
        owner,
        dateIdentified,
        createdAt,
        updatedAt,
        tags,
      } satisfies LessonsItem;
    })
    .filter((x: LessonsItem) => {
      // Keep rows that have *something* meaningful
      return Boolean(x.title || x.description || x.recommendation || x.impact);
    });
}

/**
 * Optional fallback if you still have a table-based Lessons implementation.
 * This will NOT throw if the table doesn't exist; it just returns [].
 */
async function tryFetchLessonsFromTable(supabase: any, artifactId: string, statusFilter: string[] | null) {
  // Try a couple common table names (adjust later if needed)
  const candidateTables = ["lessons_learned_items", "lessons_learned", "lesson_items"];

  for (const table of candidateTables) {
    try {
      let q = supabase
        .from(table)
        .select(
          "id,title,description,category,status,impact,recommendation,owner,date_identified,created_at,updated_at,tags,artifact_id"
        )
        .eq("artifact_id", artifactId);

      if (statusFilter?.length) q = q.in("status", statusFilter);

      const { data, error } = await q;
      if (error) continue;

      const rows = Array.isArray(data) ? data : [];
      return rows.map((r: any) => {
        const tags =
          Array.isArray(r?.tags) ? r.tags.map((t: any) => safeStr(t)).filter(Boolean) : safeStr(r?.tags).split(",").map((t) => t.trim()).filter(Boolean);

        return {
          id: safeStr(r?.id) || crypto.randomUUID(),
          title: safeStr(r?.title),
          description: safeStr(r?.description),
          category: safeStr(r?.category),
          status: safeStr(r?.status),
          impact: safeStr(r?.impact),
          recommendation: safeStr(r?.recommendation),
          owner: safeStr(r?.owner),
          dateIdentified: safeStr(r?.date_identified) || null,
          createdAt: safeStr(r?.created_at) || null,
          updatedAt: safeStr(r?.updated_at) || null,
          tags,
        } satisfies LessonsItem;
      });
    } catch {
      // If the table doesn't exist, supabase will usually error; just try the next
      continue;
    }
  }

  return [];
}

function applyStatusFilter(items: LessonsItem[], statusFilter: string[] | null) {
  if (!statusFilter?.length) return items;

  const want = new Set(statusFilter.map((s) => s.toLowerCase()));
  return items.filter((it) => want.has((it.status || "").toLowerCase()));
}

function renderLessonsHtml(model: LessonsExportModel) {
  const title = model.artifactTitle || "Lessons Learned";
  const hasFilters = Boolean(model.statusFilter?.length);
  const filterLabel = hasFilters ? `Status: ${model.statusFilter!.join(", ")}` : "All statuses";

  const headerLeft = [
    model.orgName ? `<div class="meta-line"><span class="k">Org</span><span class="v">${escapeHtml(model.orgName)}</span></div>` : "",
    model.clientName ? `<div class="meta-line"><span class="k">Client</span><span class="v">${escapeHtml(model.clientName)}</span></div>` : "",
    model.projectTitle ? `<div class="meta-line"><span class="k">Project</span><span class="v">${escapeHtml(model.projectTitle)}</span></div>` : "",
  ]
    .filter(Boolean)
    .join("");

  const rows = model.items
    .map((it, idx) => {
      const tagHtml =
        it.tags?.length
          ? `<div class="tags">${it.tags
              .slice(0, 12)
              .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
              .join("")}</div>`
          : "";

      return `
        <tr>
          <td class="col-idx">${idx + 1}</td>
          <td class="col-main">
            <div class="row-title">${escapeHtml(it.title || "Untitled")}</div>
            ${it.description ? `<div class="row-desc">${escapeHtml(it.description)}</div>` : ""}
            ${tagHtml}
          </td>
          <td class="col-status">
            <div class="pill">${escapeHtml(it.status || "")}</div>
            ${it.category ? `<div class="muted">${escapeHtml(it.category)}</div>` : ""}
          </td>
          <td class="col-owner">
            <div>${escapeHtml(it.owner || "")}</div>
            ${it.dateIdentified ? `<div class="muted">${escapeHtml(formatUkDate(it.dateIdentified))}</div>` : ""}
          </td>
          <td class="col-impact">
            ${it.impact ? `<div>${escapeHtml(it.impact)}</div>` : `<div class="muted">—</div>`}
          </td>
          <td class="col-reco">
            ${it.recommendation ? `<div>${escapeHtml(it.recommendation)}</div>` : `<div class="muted">—</div>`}
          </td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color: #0b1220;
      background: #ffffff;
    }
    .page {
      padding: 28px 32px 36px;
    }
    .top {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: flex-start;
      margin-bottom: 18px;
    }
    .hgroup h1 {
      margin: 0;
      font-size: 20px;
      letter-spacing: 0.2px;
    }
    .hgroup .sub {
      margin-top: 6px;
      font-size: 12px;
      color: #52607a;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .badge {
      display: inline-flex;
      border: 1px solid #d9e1f2;
      color: #1f2a44;
      background: #f6f8ff;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      line-height: 1.2;
      white-space: nowrap;
    }
    .meta {
      min-width: 260px;
      border: 1px solid #e6ebf7;
      background: #fbfcff;
      border-radius: 12px;
      padding: 10px 12px;
    }
    .meta .meta-line {
      display: grid;
      grid-template-columns: 64px 1fr;
      gap: 10px;
      margin: 4px 0;
      font-size: 11px;
      color: #2a3550;
    }
    .meta .k { color: #64748b; }
    .meta .v { color: #0b1220; }
    .tablewrap {
      border: 1px solid #e6ebf7;
      border-radius: 14px;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    thead th {
      text-align: left;
      font-size: 11px;
      letter-spacing: 0.2px;
      color: #42516b;
      background: #f6f8ff;
      border-bottom: 1px solid #e6ebf7;
      padding: 10px 10px;
    }
    tbody td {
      vertical-align: top;
      padding: 10px 10px;
      border-bottom: 1px solid #eef2ff;
      font-size: 11px;
      color: #0b1220;
      word-wrap: break-word;
    }
    tbody tr:last-child td { border-bottom: none; }
    .col-idx { width: 34px; color: #64748b; }
    .col-main { width: 260px; }
    .col-status { width: 110px; }
    .col-owner { width: 110px; }
    .col-impact { width: 170px; }
    .col-reco { width: auto; }

    .row-title { font-weight: 700; font-size: 11.5px; margin-bottom: 4px; }
    .row-desc { color: #334155; white-space: pre-wrap; }
    .muted { color: #64748b; margin-top: 4px; }
    .pill {
      display: inline-flex;
      border: 1px solid #d9e1f2;
      background: #ffffff;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10.5px;
      color: #1f2a44;
      max-width: 100%;
    }
    .tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
    .tag {
      display: inline-flex;
      border: 1px solid #e6ebf7;
      background: #ffffff;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 10px;
      color: #334155;
    }
    .footer {
      margin-top: 10px;
      font-size: 10px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="hgroup">
        <h1>${escapeHtml(title || "Lessons Learned")}</h1>
        <div class="sub">
          <span class="badge">${escapeHtml(filterLabel)}</span>
          <span class="badge">Total: ${model.items.length}</span>
          <span class="badge">Generated: ${escapeHtml(formatUkDateTime(model.generatedAtIso))}</span>
        </div>
      </div>
      ${
        headerLeft
          ? `<div class="meta">${headerLeft}</div>`
          : `<div class="meta">
              <div class="meta-line"><span class="k">Generated</span><span class="v">${escapeHtml(
                formatUkDateTime(model.generatedAtIso)
              )}</span></div>
              <div class="meta-line"><span class="k">Filter</span><span class="v">${escapeHtml(filterLabel)}</span></div>
            </div>`
      }
    </div>

    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th class="col-idx">#</th>
            <th class="col-main">Lesson</th>
            <th class="col-status">Status / Category</th>
            <th class="col-owner">Owner / Date</th>
            <th class="col-impact">Impact</th>
            <th class="col-reco">Recommendation</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6" class="muted" style="padding: 14px 10px;">No lessons found.</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <div>Aliena AI • Lessons Learned</div>
      <div>Artifact: ${escapeHtml(model.artifactId)}</div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: any) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Puppeteer launcher that works locally (puppeteer) and serverless (puppeteer-core + sparticuz/chromium)
 */
async function launchBrowser() {
  const isVercelLike =
    Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) || Boolean(process.env.NETLIFY);

  if (!isVercelLike) {
    // Local / standard node: use full puppeteer
    return puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  // Serverless: use chromium
  const executablePath = await chromium.executablePath();

  return puppeteerCore.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

export async function exportLessonsPdf(args: ExportLessonsPdfArgs): Promise<{ filename: string; bytes: Uint8Array }> {
  const artifactId = safeStr(args.artifactId).trim();
  if (!artifactId) {
    throw new Error("Missing artifactId");
  }

  const statusFilter = Array.isArray(args.status) ? args.status.map((s) => safeStr(s).trim()).filter(Boolean) : null;
  const filenameBase = safeStr(args.filenameBase).trim() || "";

  // 1) Fetch artifact (primary source for v2 export architecture)
  const { data: artifact, error: artErr } = await args.supabase
    .from("artifacts")
    .select("id,project_id,title,content_json,doc_json,document_json,updated_at,created_at,type")
    .eq("id", artifactId)
    .maybeSingle();

  if (artErr) throw new Error(artErr.message);
  if (!artifact) throw new Error("Artifact not found");

  const projectId = safeStr(artifact.project_id) || null;

  // 2) Load project context (best effort)
  const ctx = await getProjectContext(args.supabase, projectId);

  // 3) Parse artifact doc
  const doc =
    safeJson(artifact.content_json) ||
    safeJson(artifact.doc_json) ||
    safeJson(artifact.document_json) ||
    null;

  // 4) Normalize lessons
  let items: LessonsItem[] = [];
  if (doc) {
    items = normalizeLessonsFromArtifactDoc(doc);
  }

  // 5) Fallback to table-based data if artifact JSON empty
  if (!items.length) {
    items = await tryFetchLessonsFromTable(args.supabase, artifactId, statusFilter);
  }

  // 6) Apply filter again (covers artifact-json path too)
  items = applyStatusFilter(items, statusFilter);

  // 7) Build export model
  const model: LessonsExportModel = {
    artifactId,
    artifactTitle: safeStr(artifact.title) || "Lessons Learned",
    projectId,
    projectTitle: ctx.projectTitle || "",
    clientName: ctx.clientName || "",
    orgName: ctx.orgName || "",
    generatedAtIso: new Date().toISOString(),
    statusFilter: statusFilter?.length ? statusFilter : null,
    items,
  };

  // 8) Render HTML and convert to PDF bytes
  const html = renderLessonsHtml(model);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    // Fonts & layout stability
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"] });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });

    const base =
      filenameBase ||
      model.artifactTitle ||
      "lessons-learned";

    const filename = `${slugifyFilename(base)}.pdf`;
    return { filename, bytes: new Uint8Array(pdf) };
  } finally {
    await browser.close().catch(() => {});
  }
}