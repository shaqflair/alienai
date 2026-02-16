// src/app/api/raid/export/pdf/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Puppeteer / Chromium
import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

// ✅ External renderer (charter/closure pattern)
import { renderRaidExportHtml } from "@/lib/exports/renderRaidExportHtml";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* ──────────────────────────────────────────────── small utils (match your style) ──────────────────────────────────────────────── */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function formatUkDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function sanitizeFilename(name: string) {
  return (
    String(name || "raid")
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "raid"
  );
}

function escapeHtml(str: string) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}
function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

/* ──────────────────────────────────────────────── auth & membership (same style) ──────────────────────────────────────────────── */

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at, is_active")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  // Support both styles:
  // - removed_at null (your charter flow)
  // - is_active true (some of your other routes)
  if (memErr) throw new Error(memErr.message);

  const removedAt = (mem as any)?.removed_at ?? null;
  const isActive =
    typeof (mem as any)?.is_active === "boolean" ? Boolean((mem as any)?.is_active) : removedAt == null;

  if (!mem || !isActive) throw new Error("Forbidden");

  const role = String((mem as any).role ?? "viewer").toLowerCase();
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  return { userId: auth.user.id, role, canEdit };
}

/* ──────────────────────────────────────────────── Browser launcher (closure-report pattern) ──────────────────────────────────────────────── */

async function launchBrowser() {
  const isServerless =
    !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.AWS_REGION;

  if (isServerless) {
    return puppeteerCore.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
  }

  return puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

/* ──────────────────────────────────────────────── Org logo resolver (same pattern) ──────────────────────────────────────────────── */

async function resolveOrganisationLogoUrl(supabase: any, organisation_id?: string | null) {
  // You can override via env for global branding if you want
  const envLogo =
    process.env.RAID_REPORT_LOGO_URL ||
    process.env.NEXT_PUBLIC_RAID_REPORT_LOGO_URL ||
    process.env.CHARTER_REPORT_LOGO_URL ||
    process.env.NEXT_PUBLIC_CHARTER_REPORT_LOGO_URL ||
    process.env.CLOSURE_REPORT_LOGO_URL ||
    process.env.NEXT_PUBLIC_CLOSURE_REPORT_LOGO_URL ||
    "";

  if (!organisation_id) return envLogo;

  {
    const { data, error } = await supabase
      .from("organisations")
      .select("logo_url")
      .eq("id", organisation_id)
      .maybeSingle();
    if (!error && data?.logo_url) return String(data.logo_url);
    if (error && !looksMissingColumn(error)) {
      // ignore non-fatal
    }
  }

  {
    const { data, error } = await supabase
      .from("organisations")
      .select("logo")
      .eq("id", organisation_id)
      .maybeSingle();
    if (!error && data?.logo) return String(data.logo);
    if (error && !looksMissingColumn(error)) {
      // ignore non-fatal
    }
  }

  {
    const { data, error } = await supabase
      .from("organisations")
      .select("logo_path")
      .eq("id", organisation_id)
      .maybeSingle();
    if (!error && data?.logo_path) {
      const v = String(data.logo_path);
      if (v.startsWith("http://") || v.startsWith("https://")) return v;
    }
  }

  return envLogo;
}

/* ──────────────────────────────────────────────── Route handler ──────────────────────────────────────────────── */

async function handle(req: NextRequest) {
  let browser: any = null;

  try {
    const supabase = await createClient();

    const url = new URL(req.url);

    // Support GET ?projectId=... as primary
    // Also allow POST with JSON { projectId } if you prefer later
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const projectId = safeStr(url.searchParams.get("projectId") ?? body?.projectId ?? body?.project_id).trim();

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);

    await requireAuthAndMembership(supabase, projectId);

    // Project header info
    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("id,title,client_name,project_code,brand_primary_color,organisation_id,client_logo_url")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr) throw new Error(projErr.message);
    if (!proj) return jsonErr("Project not found", 404);

    // Org name
    let organisationName = "—";
    const organisationId = (proj as any)?.organisation_id ?? null;
    if (organisationId) {
      const { data: org, error: orgErr } = await supabase
        .from("organisations")
        .select("name")
        .eq("id", organisationId)
        .maybeSingle();
      if (orgErr && !looksMissingRelation(orgErr) && !looksMissingColumn(orgErr)) {
        // ignore non-fatal
      }
      if (org?.name) organisationName = safeStr(org.name);
    }

    // Prefer explicit org logo resolver; fallback to project client_logo_url
    const orgLogoUrl = await resolveOrganisationLogoUrl(supabase, organisationId);
    const clientLogoUrl = safeStr((proj as any)?.client_logo_url).trim();
    const logoUrl = orgLogoUrl || clientLogoUrl || "";

    // RAID items (your raid_items DDL)
    const { data: items, error } = await supabase
      .from("raid_items")
      .select(
        "id,project_id,item_no,public_id,type,title,description,owner_label,priority,probability,severity,impact,ai_rollup,status,response_plan,next_steps,notes,related_refs,created_at,updated_at,due_date"
      )
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Normalize items for renderer
    const list = (items ?? []).map((it: any) => ({
      id: safeStr(it.id),
      public_id: safeStr(it.public_id).trim() || safeStr(it.id).slice(0, 8).toUpperCase(),
      type: safeStr(it.type).trim() || "Risk",
      title: safeStr(it.title).trim(),
      description: safeStr(it.description).trim(),
      owner_label: safeStr(it.owner_label).trim(),
      status: safeStr(it.status).trim() || "Open",
      priority: safeStr(it.priority).trim(),
      probability: it.probability ?? null,
      severity: it.severity ?? null,
      impact: safeStr(it.impact).trim(),
      ai_rollup: safeStr(it.ai_rollup).trim(),
      response_plan: safeStr(it.response_plan).trim(),
      next_steps: safeStr(it.next_steps).trim(),
      notes: safeStr(it.notes).trim(),
      related_refs: it.related_refs ?? null,
      due_date: it.due_date ?? null,
      updated_at: it.updated_at ?? null,
    }));

    const projectTitle = safeStr((proj as any).title).trim() || "Project";
    const clientName = safeStr((proj as any).client_name).trim();
    const projectCode = safeStr((proj as any).project_code).trim() || projectId.slice(0, 8);
    const brand = safeStr((proj as any).brand_primary_color).trim() || "#111827";
    const generatedAt = formatUkDateTime();
    const watermarkText = "DRAFT"; // keep simple like your charter; you can wire approval later if needed.

    const html = renderRaidExportHtml({
      items: list,
      meta: {
        projectName: escapeHtml(projectTitle),
        projectCode: escapeHtml(projectCode),
        clientName: escapeHtml(clientName),
        organisationName: escapeHtml(organisationName),
        generated: generatedAt,
        brand: escapeHtml(brand),
        logoUrl: escapeHtml(logoUrl),
        watermarkText: escapeHtml(watermarkText),
        locale: "en-GB",
        dateFormat: "UK",
      },
    });

    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");

    try {
      await page.evaluate(() => document.fonts.ready);
    } catch {}

    const headerTemplate = `<div></div>`;
    const footerTemplate = `
      <div style="
        width:100%;
        padding:0 15mm;
        font-family:Arial,sans-serif;
        font-size:10px;
        color:#6b7280;
      ">
        <div style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          height:18px;
          white-space:nowrap;
        ">
          <span>${escapeHtml(projectCode)}</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      </div>
    `;

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: "12mm", right: "15mm", bottom: "16mm", left: "15mm" },
      timeout: 45000,
    });

    const filename = `Project_${sanitizeFilename(projectCode)}_RAID.pdf`;

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "Server error");
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 500;
    return jsonErr(msg, status);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
