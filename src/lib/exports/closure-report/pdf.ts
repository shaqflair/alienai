// src/lib/exports/closure-report/pdf.ts
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ✅ Shared puppeteer wrapper
import { htmlToPdfBuffer } from "../_shared/puppeteer";

// ✅ New closure HTML renderer (uses renderClosureReportSections internally)
import { renderClosureReportHtml } from "./renderClosureReportHtml";

/* =========================================================================================
   Closure Report → PDF Exporter
   ========================================================================================= */

type Args = {
  supabase: SupabaseClient;
  artifactId: string;
  filenameBase?: string | null;
  contentOverride?: any | null;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function yyyymmdd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function sanitizeFilename(name: string) {
  return safeStr(name)
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/* ---------------- tolerant getters ---------------- */

function getPath(obj: any, path: string): any {
  try {
    if (!obj || !path) return undefined;
    const parts = path.split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  } catch {
    return undefined;
  }
}

function pickAny(obj: any, paths: string[]) {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (v === true) return "Yes";
    if (v === false) return "No";
    if (v != null && typeof v !== "object") return String(v);
  }
  return "";
}

function toArrayLoose(items: any): any[] {
  if (items == null) return [];
  if (Array.isArray(items)) return items;

  if (typeof items === "string") {
    const s = items.trim();
    if (!s) return [];
    const parts = s
      .split(/\r?\n|•|\u2022|;+/g)
      .map((x) => x.trim())
      .filter(Boolean);
    return parts.length ? parts : [s];
  }

  return [items];
}

function unwrapArray(input: any, preferredKeys: string[] = []): any[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input;

  if (typeof input === "object") {
    for (const k of preferredKeys) {
      const v = (input as any)?.[k];
      if (Array.isArray(v)) return v;
    }
    const common = ["items", "rows", "data", "value", "list", "entries", "key"];
    for (const k of common) {
      const v = (input as any)?.[k];
      if (Array.isArray(v)) return v;
    }
    const arrKey = Object.keys(input).find((k) => Array.isArray((input as any)[k]));
    if (arrKey) return (input as any)[arrKey];
  }

  return toArrayLoose(input);
}

function normaliseRag(v: any) {
  const s = safeStr(v).trim().toLowerCase();
  if (!s) return "—";
  if (s.includes("green") || s === "g") return "GREEN";
  if (s.includes("amber") || s.includes("yellow") || s === "a" || s === "y") return "AMBER";
  if (s.includes("red") || s === "r") return "RED";
  return safeStr(v).toUpperCase();
}

function normaliseOverall(v: any) {
  const s = safeStr(v).trim().toLowerCase();
  if (!s) return "—";
  if (s === "good") return "Good";
  if (s === "ok" || s === "okay" || s === "watch") return "Watch";
  if (s === "poor" || s === "bad" || s === "critical") return "Critical";
  if (s === "at risk" || s === "atrisk") return "At Risk";
  return safeStr(v);
}

/* ========================================================================================= */

export async function exportClosureReportPdf({
  supabase,
  artifactId,
  filenameBase,
  contentOverride,
}: Args): Promise<{ filename: string; bytes: Buffer }> {
  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, title, content, content_json, updated_at")
    .eq("id", artifactId)
    .single();

  if (artErr) throw new Error(artErr.message);
  if (!artifact) throw new Error("Artifact not found");

  const projectId = (artifact as any).project_id;
  if (!projectId) throw new Error("Artifact has no project_id");

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, title, project_code, client_name, organisation_id")
    .eq("id", projectId)
    .single();

  if (projErr) throw new Error(projErr.message);
  if (!project) throw new Error("Project not found");

  let orgName = "";
  if ((project as any).organisation_id) {
    const { data: org, error: orgErr } = await supabase
      .from("organisations")
      .select("name")
      .eq("id", (project as any).organisation_id)
      .maybeSingle();

    if (!orgErr) orgName = safeStr((org as any)?.name);
  }

  const raw =
    contentOverride && typeof contentOverride === "object"
      ? contentOverride
      : (artifact as any).content_json;

  if (!raw || typeof raw !== "object") {
    throw new Error("Closure report content is empty (content_json is null)");
  }

  // Header fields
  const projectName =
    pickAny(raw, [
      "project.project_name",
      "meta.projectName",
      "projectSummary.project_name",
      "project_summary.project_name",
      "projectName",
      "title",
    ]) ||
    safeStr((project as any).title) ||
    safeStr((artifact as any).title) ||
    "Project";

  const projectCode =
    pickAny(raw, ["project.project_code", "meta.projectCode", "projectSummary.project_code", "project_code"]) ||
    safeStr((project as any).project_code) ||
    "";

  const clientName =
    pickAny(raw, ["project.client_name", "meta.clientName", "projectSummary.client", "client_name"]) ||
    safeStr((project as any).client_name) ||
    "";

  // Normalised top-level indicators for the renderer model
  const rag = normaliseRag(
    pickAny(raw, ["health.rag", "meta.rag", "rag", "projectSummary.rag_status", "rag_status"])
  );

  const overall = normaliseOverall(
    pickAny(raw, [
      "health.overall_health",
      "meta.overall",
      "overall",
      "projectSummary.overall_health",
      "overall_health",
    ])
  );

  const executiveSummary =
    pickAny(raw, [
      "health.summary",
      "executiveSummary",
      "projectSummary.summary",
      "project_summary.summary",
      "summary",
    ]) || "";

  // Arrays for the renderer model
  const stakeholdersArr = unwrapArray(
    getPath(raw, "stakeholders.key") ??
      getPath(raw, "stakeholders") ??
      getPath(raw, "keyStakeholders") ??
      getPath(raw, "projectSummary.stakeholders") ??
      getPath(raw, "project_summary.stakeholders"),
    ["key", "stakeholders", "items"]
  );

  const achievementsArr = unwrapArray(
    getPath(raw, "achievements.key_achievements") ??
      getPath(raw, "achievements") ??
      getPath(raw, "keyAchievements") ??
      getPath(raw, "projectSummary.achievements") ??
      getPath(raw, "project_summary.achievements"),
    ["key_achievements", "achievements", "items"]
  );

  const criteriaArr = unwrapArray(
    getPath(raw, "success.criteria") ??
      getPath(raw, "criteria") ??
      getPath(raw, "successCriteria") ??
      getPath(raw, "success_criteria"),
    ["criteria", "success_criteria", "items"]
  );

  const deliveredArr = unwrapArray(
    getPath(raw, "deliverables.delivered") ??
      getPath(raw, "delivered") ??
      getPath(raw, "deliverablesDelivered") ??
      getPath(raw, "deliverables_delivered"),
    ["delivered", "items"]
  );

  const outstandingArr = unwrapArray(
    getPath(raw, "deliverables.outstanding") ??
      getPath(raw, "outstanding") ??
      getPath(raw, "deliverablesOutstanding") ??
      getPath(raw, "deliverables_outstanding"),
    ["outstanding", "items"]
  );

  const budgetRowsArr = unwrapArray(
    getPath(raw, "financial_closeout.budget_rows") ??
      getPath(raw, "budgetRows") ??
      getPath(raw, "financial.budget_rows") ??
      getPath(raw, "financial.budgetRows"),
    ["budget_rows", "budgetRows", "items"]
  );

  const wentWellArr = unwrapArray(
    getPath(raw, "lessons.went_well") ??
      getPath(raw, "wentWell") ??
      getPath(raw, "lessonsLearned.wentWell") ??
      getPath(raw, "lessons_learned.went_well"),
    ["went_well", "wentWell", "items"]
  );

  const didntGoWellArr = unwrapArray(
    getPath(raw, "lessons.didnt_go_well") ??
      getPath(raw, "didntGoWell") ??
      getPath(raw, "lessonsLearned.didntGoWell") ??
      getPath(raw, "lessons_learned.didnt_go_well"),
    ["didnt_go_well", "didntGoWell", "items"]
  );

  const surprisesArr = unwrapArray(
    getPath(raw, "lessons.surprises_risks") ??
      getPath(raw, "surprises") ??
      getPath(raw, "lessonsLearned.surprises") ??
      getPath(raw, "lessons_learned.surprises"),
    ["surprises_risks", "surprises", "items"]
  );

  const risksIssuesArr = unwrapArray(
    getPath(raw, "handover.risks_issues") ??
      getPath(raw, "risksIssues") ??
      getPath(raw, "risks_issues") ??
      getPath(raw, "handover.risksIssues") ??
      getPath(raw, "handover.risks_issues"),
    ["risks_issues", "risksIssues", "items"]
  );

  const recommendationsArr = unwrapArray(
    getPath(raw, "recommendations.items") ??
      getPath(raw, "recommendations") ??
      getPath(raw, "followUpActions") ??
      getPath(raw, "follow_up_actions"),
    ["items", "recommendations", "follow_up_actions"]
  );

  const signoff =
    getPath(raw, "signoff") ??
    getPath(raw, "finalSignOff") ??
    getPath(raw, "final_sign_off") ??
    {};

  const roi = getPath(raw, "roi") ?? {};

  // Build the exact model your narrative renderer expects
  const renderModel = {
    meta: { generatedIso: new Date().toISOString() },
    executiveSummary,
    rag,
    overall,

    stakeholders: stakeholdersArr,
    achievements: achievementsArr,
    criteria: criteriaArr,
    delivered: deliveredArr,
    outstanding: outstandingArr,
    budgetRows: budgetRowsArr,

    wentWell: wentWellArr,
    didntGoWell: didntGoWellArr,
    surprises: surprisesArr,

    risksIssues: risksIssuesArr,
    recommendations: recommendationsArr,

    teamMoves: unwrapArray(getPath(raw, "handover.team_moves") ?? getPath(raw, "teamMoves"), ["items"]) ?? [],

    roi,
    signoff,
  };

  const html = renderClosureReportHtml({
    model: renderModel,
    projectName,
    projectCode: projectCode || safeStr((project as any).project_code) || "—",
    clientName,
    orgName: orgName || "—",
  });

  const bytes = await htmlToPdfBuffer({
    html,
    waitUntil: "networkidle2",
    emulateScreen: true,
    viewport: { width: 1440, height: 1024, deviceScaleFactor: 2 },
    forceA4PageSize: true,
    navigationTimeoutMs: 25_000,
    renderTimeoutMs: 25_000,
    pdf: {
      landscape: true,
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
    },
  });

  const base =
    filenameBase ||
    (projectCode
      ? `${projectCode}-closure-report`
      : safeStr((project as any).project_code)
        ? `${safeStr((project as any).project_code)}-closure-report`
        : "Closure-Report");

  const filename = `${sanitizeFilename(base)}-${yyyymmdd(new Date())}.pdf`;

  return { filename, bytes };
}
