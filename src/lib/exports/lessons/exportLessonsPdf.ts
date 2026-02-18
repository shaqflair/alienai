import "server-only";

import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

// ? use shared shell + escape (NO stakeholder renderer)
import { renderRegisterShell, escapeHtml } from "@/lib/exports/shared/registerPdfShell";

type SupabaseClient = any;

type ExportPdfArgs = {
  supabase: SupabaseClient;
  artifactId?: string | null;
  projectRef?: string | null;
  status?: string[] | null;
  filenameBase?: string | null;

  // ? NEW: only export published lessons (Org Library)
  publishedOnly?: boolean | null;
};

type ProjectMeta = {
  id: string;
  title: string | null;
  client_name: string | null;
  project_code: string | null;
  organisation_id: string | null;
};

type LessonRow = {
  id: string;
  project_id: string;
  category: string;
  description: string;
  action_for_future: string | null;
  created_at: string;
  status: string;
  date_raised: string | null;
  impact: string | null;
  severity: string | null;
  project_stage: string | null;
  next_action_summary: string | null;
  ai_summary: string | null;
  ai_generated: boolean;
  is_published: boolean;
  library_tags: string[] | null;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function slugify(x: string) {
  return String(x || "export")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .slice(0, 80);
}

function ukDateFromIso(isoLike?: string | null) {
  const s = safeStr(isoLike).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function ukDateTimeFromIso(isoLike?: string | null) {
  const s = safeStr(isoLike).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

async function launchBrowser() {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (!isServerless) {
    return puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  }

  const execPath = await chromium.executablePath();
  return puppeteerCore.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: execPath,
    headless: chromium.headless,
  });
}

async function resolveProjectFromArtifactOrRef(
  supabase: SupabaseClient,
  artifactId?: string | null,
  projectRef?: string | null
): Promise<{ project: ProjectMeta; humanProjectCode: string }> {
  const aid = safeStr(artifactId).trim();
  if (aid) {
    if (!looksLikeUuid(aid)) throw new Error("artifactId must be a uuid");

    const { data: art, error: aErr } = await supabase
      .from("artifacts")
      .select("id, project_id")
      .eq("id", aid)
      .single();

    if (aErr || !art?.project_id) throw new Error("Artifact not found");

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id, title, client_name, project_code, organisation_id")
      .eq("id", art.project_id)
      .single();

    if (pErr || !project) throw new Error("Project not found");

    const humanProjectCode = safeStr(project.project_code).trim() || String(project.id).slice(0, 6);
    return { project, humanProjectCode };
  }

  const pr = safeStr(projectRef).trim();
  if (!pr) throw new Error("Missing project identifier");

  const queryField = looksLikeUuid(pr) ? "id" : "project_code";
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, title, client_name, project_code, organisation_id")
    .eq(queryField, pr)
    .single();

  if (pErr || !project) throw new Error("Project not found");

  const humanProjectCode = safeStr(project.project_code).trim() || String(project.id).slice(0, 6);
  return { project, humanProjectCode };
}

async function resolveOrgName(supabase: SupabaseClient, organisationId?: string | null) {
  const oid = safeStr(organisationId).trim();
  if (!oid || !looksLikeUuid(oid)) return "";
  const { data: org } = await supabase.from("organisations").select("name").eq("id", oid).single();
  return safeStr(org?.name).trim();
}

function friendlyCategory(cat: string) {
  const v = safeStr(cat).trim();
  const maps: Record<string, string> = {
    what_went_well: "What went well",
    improvements: "Improvements",
    issues: "Issues",
  };
  return maps[v] || v || "—";
}

function joinTags(tags: any) {
  if (!tags) return "—";
  if (Array.isArray(tags)) return tags.map((t) => safeStr(t).trim()).filter(Boolean).join(", ") || "—";
  const s = safeStr(tags).trim();
  return s || "—";
}

function cell(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "—";
}

export async function exportLessonsPdf(args: ExportPdfArgs): Promise<{ filename: string; bytes: Buffer }> {
  const { supabase, artifactId, projectRef, status, filenameBase, publishedOnly } = args;

  const { project, humanProjectCode } = await resolveProjectFromArtifactOrRef(supabase, artifactId, projectRef);
  const orgName = await resolveOrgName(supabase, project.organisation_id);

  let q = supabase
    .from("lessons_learned")
    .select("*")
    .eq("project_id", project.id);

  // ? NEW: Org Library mode
  if (publishedOnly) {
    q = q.eq("is_published", true);
  }

  const statusFilter = (status || []).map((s) => safeStr(s).trim()).filter(Boolean);
  if (statusFilter.length) q = q.in("status", statusFilter);

  // ? ASCENDING sort (oldest -> newest) so numbering 1..n matches order
  q = q.order("created_at", { ascending: true });

  const { data, error } = await q;
  if (error) throw new Error(`Fetch failed: ${error.message}`);

  const items: LessonRow[] = Array.isArray(data) ? data : [];

  const projectTitle = safeStr(project.title) || "Project";
  const clientName = safeStr(project.client_name) || "—";

  const base =
    safeStr(filenameBase).trim() ||
    `${humanProjectCode}-${publishedOnly ? "org-library" : "lessons-learned"}`;

  const filename = `${slugify(base)}.pdf`;

  const generatedAtIso = new Date().toISOString();
  const generatedDate = ukDateFromIso(generatedAtIso);
  const generatedDateTime = ukDateTimeFromIso(generatedAtIso);

  const filterBits: string[] = [];
  if (publishedOnly) filterBits.push("Org Library only");
  if (statusFilter.length) filterBits.push(`Status: ${statusFilter.join(", ")}`);
  const filterLabel = filterBits.length ? filterBits.join(" • ") : "All lessons";

  // ---------- meta html ----------
  const metaHtml = `
    <div style="display:flex; gap:16px; flex-wrap:wrap;">
      <div style="min-width:220px;">
        <div><b>Organisation:</b> ${escapeHtml(orgName || "—")}</div>
        <div><b>Client:</b> ${escapeHtml(clientName || "—")}</div>
        <div><b>Project ID:</b> <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${escapeHtml(
          humanProjectCode || "—"
        )}</span></div>
      </div>
      <div style="min-width:220px;">
        <div><b>Total Lessons:</b> ${escapeHtml(String(items.length))}</div>
        <div><b>Report Date:</b> ${escapeHtml(generatedDate)}</div>
        <div><b>Filter:</b> ${escapeHtml(filterLabel)}</div>
      </div>
    </div>
  `;

  // ---------- table ----------
  const cols = [
    { label: "No", style: "width:34px; color:#64748b;" },
    { label: "Status", style: "width:92px;" },
    { label: "Date", style: "width:74px;" },
    { label: "Category", style: "width:110px;" },
    { label: "Impact", style: "width:92px;" },
    { label: "Severity", style: "width:72px;" },
    { label: "Stage", style: "width:90px;" },
    { label: "Description", style: "min-width:280px; font-weight:700;" },
    { label: "Action", style: "min-width:240px;" },
    { label: "Visibility", style: "width:84px;" },
    { label: "Tags", style: "min-width:160px;" },
  ] as const;

  const thead = `
    <thead>
      <tr>
        ${cols.map((c) => `<th style="${c.style}">${escapeHtml(c.label)}</th>`).join("")}
      </tr>
    </thead>
  `;

  const tbody =
    items.length === 0
      ? `<tbody><tr><td colspan="${cols.length}">No lessons recorded.</td></tr></tbody>`
      : `<tbody>
          ${items
            .map((l, idx) => {
              const no = idx + 1; // ? ASCENDING
              const date = ukDateFromIso(l.date_raised || l.created_at);
              const statusText = safeStr(l.status).trim() || "Open";

              return `
                <tr>
                  <td style="color:#64748b; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${escapeHtml(
                    String(no)
                  )}</td>
                  <td>${escapeHtml(statusText)}</td>
                  <td style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${escapeHtml(date)}</td>
                  <td>${escapeHtml(friendlyCategory(l.category))}</td>
                  <td>${escapeHtml(cell(l.impact))}</td>
                  <td>${escapeHtml(cell(l.severity))}</td>
                  <td>${escapeHtml(cell(l.project_stage))}</td>
                  <td style="font-weight:700;">${escapeHtml(cell(l.description))}</td>
                  <td>${escapeHtml(cell(l.action_for_future || l.next_action_summary))}</td>
                  <td>${escapeHtml(l.is_published ? "Published" : "Private")}</td>
                  <td>${escapeHtml(joinTags(l.library_tags))}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>`;

  const bodyHtml = `
    <div style="margin-top:8px; font-size:12px; color:#475569;">
      <b>Register</b> • ${escapeHtml(String(items.length))} records
    </div>
    <table>
      ${thead}
      ${tbody}
    </table>
  `;

  const html = renderRegisterShell({
    title: publishedOnly ? "Org Library — Lessons Learned Register" : "Lessons Learned Register",
    metaHtml,
    bodyHtml,
    generatedAt: generatedDateTime,
  });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle2"] });

    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    });

    return { filename, bytes: Buffer.from(pdf) };
  } finally {
    await browser.close().catch(() => {});
  }
}

