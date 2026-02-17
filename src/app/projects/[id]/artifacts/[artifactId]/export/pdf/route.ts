// src/app/projects/[id]/artifacts/[artifactId]/export/pdf/route.ts
import "server-only";


        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { launchBrowser } from "@/lib/pdf/puppeteer-launch";
import { makeEtag } from "@/lib/pdf/etag";
import { renderProjectCharterHtml, type CharterData, type PdfBrand } from "@/lib/pdf/charter-html";
import { isCharterExportReady } from "@/lib/charter/export-ready";

export const runtime = "nodejs";

/**
 * âœ… This file contains NO JSX.
 * If you still see: Expected '>', got 'className'
 * it means JSX exists in a different route handler file.
 * Search your repo for: className=
 * and check route handler files under src/app/.../route.ts
 */

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

async function unwrapParams(p: any) {
  if (!p) return {};
  return typeof p?.then === "function" ? await p : p;
}

function safeHexColor(x: unknown, fallback = "#E60000") {
  const s = String(x ?? "").trim();
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s)) return s;
  return fallback;
}

function fallbackIdsFromUrl(url: string) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const pIdx = parts.indexOf("projects");
  const aIdx = parts.indexOf("artifacts");
  return {
    projectId: pIdx >= 0 ? safeParam(parts[pIdx + 1]) : "",
    artifactId: aIdx >= 0 ? safeParam(parts[aIdx + 1]) : "",
  };
}

function parseArtifactContent(content: any) {
  if (content == null) return null;
  if (typeof content === "object") return content;

  if (typeof content === "string") {
    const s = content.trim();
    if (!s) return "";
    try {
      if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        return JSON.parse(s);
      }
    } catch {
      // keep as string
    }
    return content;
  }

  return content;
}

function inferStatusFromRaw(raw: any): string {
  const s = String(raw?.approval_status ?? raw?.approvalStatus ?? raw?.status ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "draft";
  if (s === "changes requested") return "changes_requested";
  if (["approved", "submitted", "rejected", "changes_requested", "draft"].includes(s)) return s;
  return "draft";
}

function fileSafe(name: string) {
  return String(name ?? "document")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

async function fetchBranding(admin: any, projectId: string) {
  const { data: project, error } = await admin
    .from("projects")
    .select("id, client_name, client_logo_url, brand_primary_color, title")
    .eq("id", projectId)
    .maybeSingle();

  if (error) console.error("[PDF] projects.select (branding) error:", error);

  const clientName = project?.client_name || "Client";
  const brandColor = safeHexColor(project?.brand_primary_color, "#E60000");
  const productName = "AlienAI";
  const logoDataUri: string | null = project?.client_logo_url || null;

  const brand: PdfBrand = { clientName, brandColor, productName, logoDataUri };
  return { brand, project };
}

async function fetchArtifact(admin: any, artifactId: string) {
  const { data, error } = await admin
    .from("artifacts")
    .select("id, project_id, user_id, type, title, content, content_json, created_at, updated_at, approval_status, status")
    .eq("id", artifactId)
    .maybeSingle();

  if (error) {
    console.error("[PDF] artifacts.select error:", error);
    return null;
  }
  return data ?? null;
}

export async function GET(req: NextRequest,
  ctx: { params: { id?: string; artifactId?: string } | Promise<any> }
) {
  const p = await unwrapParams(ctx.params);

  let projectId = safeParam(p?.id);
  let artifactId = safeParam(p?.artifactId);

  if (!projectId || !artifactId) {
    const fb = fallbackIdsFromUrl(req.url);
    projectId = projectId || fb.projectId;
    artifactId = artifactId || fb.artifactId;
  }

  if (!projectId || !artifactId) return new NextResponse("Missing project/artifact id", { status: 400 });

  // Auth gate (PDF export is not public)
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) console.error("[PDF] auth.getUser error:", authErr);
  if (!auth?.user) return new NextResponse("Unauthorized", { status: 401 });

  const admin = createAdminClient();

  // Pull project title so the PDF always shows the project name correctly
  const { data: projectTitleRow, error: projErr } = await admin
    .from("projects")
    .select("id,title")
    .eq("id", projectId)
    .maybeSingle();

  if (projErr) console.error("[PDF] projects.select (title) error:", projErr);

  const projectTitleFromProject = String(projectTitleRow?.title ?? "").trim();

  const [brandRes, artifact] = await Promise.all([fetchBranding(admin, projectId), fetchArtifact(admin, artifactId)]);

  if (!artifact) return new NextResponse("Not found (artifact missing)", { status: 404 });
  if (safeParam(artifact.project_id) !== projectId) return new NextResponse("Not found (project mismatch)", { status: 404 });

  const raw = parseArtifactContent(artifact.content_json ?? artifact.content);

  // âœ… Export readiness gate (prevents blank PDFs)
  const v2 = raw && typeof raw === "object" ? raw : null;

  // Hard stop: must be v2-like { meta, sections }
  if (!v2?.meta || !Array.isArray(v2?.sections)) {
    return new NextResponse(
      "Project Charter is not in v2 format.\n\nOpen the charter, click 'Upgrade to v2', then 'Save charter', and try exporting again.",
      { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const report = isCharterExportReady(v2);
  if (!report.ready) {
    return new NextResponse(
      `Project Charter is incomplete for export.\n\nMissing:\n- ${report.missing.join(
        "\n- "
      )}\n\nOpen the charter, complete the missing parts, click 'Save charter', then export again.`,
      { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const charter: CharterData = {
    projectTitle:
      projectTitleFromProject ||
      raw?.meta?.project_title ||
      raw?.projectTitle ||
      raw?.title ||
      "Project Charter",
    projectCode: raw?.projectCode ?? raw?.project_code ?? null,
    version: raw?.version
      ? String(raw.version)
      : (artifact as any)?.version
      ? String((artifact as any).version)
      : null,
    status: inferStatusFromRaw(raw),
    preparedBy: raw?.preparedBy ?? raw?.prepared_by ?? null,
    approvedBy: raw?.approvedBy ?? raw?.approved_by ?? null,
    lastUpdated: artifact.updated_at ?? artifact.created_at ?? null,
    raw,
  };

  const brand = brandRes.brand;

  const etag = makeEtag({
    v: 4,
    projectId,
    artifactId,
    brand,
    artifact: {
      id: artifact.id,
      project_id: artifact.project_id,
      type: artifact.type,
      updated_at: artifact.updated_at ?? artifact.created_at,
      content_len: typeof artifact.content === "string" ? artifact.content.length : null,
      content_json_hint: artifact.content_json ? "json" : null,
    },
    charterHints: { title: charter.projectTitle, status: charter.status, version: charter.version },
  });

  const inm = req.headers.get("if-none-match");
  if (inm && inm === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, max-age=0, must-revalidate" },
    });
  }

  const { html, headerTemplate, footerTemplate } = renderProjectCharterHtml({ brand, charter });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754 });
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"] });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: "90px", bottom: "70px", left: "36px", right: "36px" },
    });

    const filename = `${fileSafe(charter.projectTitle || "Project-Charter")}.pdf`;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
        ETag: etag,
      },
    });
  } catch (e: any) {
    console.error("[PDF] puppeteer render error:", e);
    return new NextResponse(`PDF render failed: ${String(e?.message ?? e)}`, { status: 500 });
  } finally {
    await browser.close().catch(() => {});
  }
}

