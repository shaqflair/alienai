import "server-only";

import ExcelJS from "exceljs";
import { createClient } from "@/utils/supabase/server";

const CHANGE_TABLE = "change_requests";
const BUCKET = process.env.CHANGE_ATTACHMENTS_BUCKET || "change_attachments";

/* ───────────────────────── helpers ───────────────────────── */

function safeStr(x: any) {
  if (typeof x === "string") return x.trim();
  if (x == null) return "";
  return String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

function sanitizeFilename(name: string) {
  return (
    safeStr(name)
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "change"
  );
}

function toDateGB(x: any) {
  if (!x) return "";
  const d = new Date(String(x));
  if (Number.isNaN(d.getTime())) return safeStr(x);
  return d.toLocaleString("en-GB");
}

function formatUkDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatGBP(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "£0";
  return v.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  });
}

function filenameFromStorageObjectName(objName: string) {
  const n = safeStr(objName);
  const idx = n.indexOf("__");
  return idx >= 0 ? n.slice(idx + 2) : n || "Attachment";
}

async function listAttachmentNames(supabase: any, changeId: string) {
  const { data, error } = await supabase.storage.from(BUCKET).list(`change/${changeId}`, { limit: 100 });
  if (error) return [];
  return (data || []).map((o: any) => filenameFromStorageObjectName(o.name));
}

/* ───────────────────────── membership (tolerant) ───────────────────────── */

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  // removed_at first
  {
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("role, removed_at")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!memErr) {
      if (!mem) throw new Error("Forbidden");
      return { userId: auth.user.id };
    }
    if (memErr && !looksMissingColumn(memErr)) {
      // fall through
    }
  }

  // fallback is_active
  {
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("role,is_active")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (memErr) throw new Error(memErr.message);
    if (!mem?.is_active) throw new Error("Forbidden");
    return { userId: auth.user.id };
  }
}

/* ───────────────────────── excel styling ───────────────────────── */

function borderAll(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
}

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 20;
  row.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    fill(c, "FF0F172A");
    c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    borderAll(c);
  });
}

function zebraRow(ws: ExcelJS.Worksheet, rowNum: number, idx: number) {
  const row = ws.getRow(rowNum);
  if (idx % 2 === 1) row.eachCell({ includeEmpty: true }, (c) => fill(c, "FFF8FAFC"));
  row.eachCell({ includeEmpty: true }, (c) => borderAll(c));
}

/* ───────────────────────── ID logic ───────────────────────── */

function deriveCrId(cr: any) {
  const seq = cr?.seq;
  if (seq != null && String(seq).trim() !== "") return `CR-${String(seq).trim()}`;
  const id = safeStr(cr?.id);
  return id ? `CR-${id.slice(0, 8).toUpperCase()}` : "CR";
}

/* ───────────────────────── sheets ───────────────────────── */

function addOverviewSheet(
  wb: ExcelJS.Workbook,
  meta: { projectName: string; projectCode: string; clientName: string; generated: string; crId: string }
) {
  const ws = wb.addWorksheet("Overview", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [{ width: 22 }, { width: 72 }];

  ws.getCell("A1").value = "Field";
  ws.getCell("B1").value = "Value";
  styleHeaderRow(ws.getRow(1));

  // ✅ no Filter row
  const rows: Array<[string, string]> = [
    ["Document", "Change Request"],
    ["Generated", meta.generated],
    ["Project", meta.projectName],
    ["Project Code", meta.projectCode || "—"],
    ["Client", meta.clientName || "—"],
    ["CR ID", meta.crId || "—"],
  ];

  let r = 2;
  for (const [k, v] of rows) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 2).value = v;
    borderAll(ws.getCell(r, 1));
    borderAll(ws.getCell(r, 2));
    zebraRow(ws, r, r - 2);
    r++;
  }

  return ws;
}

function addDetailsSheet(wb: ExcelJS.Workbook, cr: any, attachments: string[]) {
  const ws = wb.addWorksheet("Change Request", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [{ width: 26 }, { width: 90 }];

  ws.getCell("A1").value = "Field";
  ws.getCell("B1").value = "Value";
  styleHeaderRow(ws.getRow(1));

  const impact =
    cr?.impact_analysis && typeof cr.impact_analysis === "object" && !Array.isArray(cr.impact_analysis)
      ? cr.impact_analysis
      : {};

  const days = Number(impact?.days ?? cr?.ai_schedule ?? 0) || 0;
  const cost = Number(impact?.cost ?? cr?.ai_cost ?? 0) || 0;
  const risk = safeStr(impact?.risk ?? cr?.ai_risk ?? cr?.risk_impact ?? "");

  const rows: Array<[string, string]> = [
    ["Title", safeStr(cr?.title)],
    ["Status", safeStr(cr?.status)],
    ["Decision", safeStr(cr?.decision_status)],
    ["Priority", safeStr(cr?.priority)],
    ["Lane (Delivery)", safeStr(cr?.delivery_status)],
    ["Requester", safeStr(cr?.requester_name)],
    ["Owner", safeStr(cr?.owner_label)],
    ["Submitted", safeStr(cr?.submitted_at ? toDateGB(cr.submitted_at) : cr?.created_at ? toDateGB(cr.created_at) : "")],
    ["Needed By", safeStr(cr?.needed_by || cr?.required_by || cr?.due_date ? toDateGB(cr.needed_by || cr.required_by || cr.due_date) : "")],
    ["Cost Impact", formatGBP(cost)],
    ["Schedule Impact (days)", String(days)],
    ["Risk Impact", risk || "—"],
    ["Benefits", safeStr(cr?.benefits || cr?.benefit_summary || "")],
    ["Description", safeStr(cr?.description || cr?.change_description || "")],
    ["Proposed Change", safeStr(cr?.proposed_change || "")],
    ["Implementation Plan", safeStr(cr?.implementation_plan || cr?.plan || "")],
    ["Rollback Plan", safeStr(cr?.rollback_plan || cr?.rollback || "")],
    ["Assumptions", safeStr(cr?.assumptions || "")],
    ["Dependencies", safeStr(cr?.dependencies || "")],
    ["Attachments", attachments.length ? attachments.join(" | ") : "—"],
  ];

  let r = 2;
  for (const [k, v] of rows) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 2).value = v;
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
    borderAll(ws.getCell(r, 1));
    borderAll(ws.getCell(r, 2));
    zebraRow(ws, r, r - 2);
    r++;
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 2 } };
  return ws;
}

/* ───────────────────────── exporter ───────────────────────── */

export async function exportChangeRequestXlsxBuffer(changeId: string) {
  const id = safeStr(changeId);
  if (!id) {
    const e = new Error("Missing change id");
    (e as any).status = 400;
    throw e;
  }
  if (!isUuid(id)) {
    const e = new Error("Invalid change id");
    (e as any).status = 400;
    throw e;
  }

  const supabase = await createClient();

  const { data: cr, error: crErr } = await supabase.from(CHANGE_TABLE).select("*").eq("id", id).maybeSingle();
  if (crErr) throw new Error(crErr.message);
  if (!cr) {
    const e = new Error("Change request not found");
    (e as any).status = 404;
    throw e;
  }

  const projectId = safeStr((cr as any).project_id);
  if (!projectId) throw new Error("Change request missing project_id");

  await requireAuthAndMembership(supabase, projectId);

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("title, project_code, client_name")
    .eq("id", projectId)
    .maybeSingle();

  if (pErr) throw new Error(pErr.message);

  const projectName = safeStr(project?.title) || "Project";
  const projectCode = safeStr(project?.project_code) || projectId.slice(0, 8);
  const clientName = safeStr(project?.client_name) || "";

  const attachments = await listAttachmentNames(supabase, id);
  const crId = deriveCrId(cr);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aliena AI";
  wb.created = new Date();
  wb.modified = new Date();

  addOverviewSheet(wb, {
    projectName,
    projectCode,
    clientName,
    generated: formatUkDateTime(),
    crId,
  });

  addDetailsSheet(wb, cr, attachments);

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${sanitizeFilename(projectCode)}_${sanitizeFilename(crId)}_Change_Request.xlsx`;

  return { buffer: Buffer.from(buffer as any), filename };
}
