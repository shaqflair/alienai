import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CHANGE_TABLE = "change_requests";
const BUCKET = process.env.CHANGE_ATTACHMENTS_BUCKET || "change_attachments";

/* ------------------------- helpers ------------------------- */

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

function safeStr(x: any) {
  if (typeof x === "string") return x.trim();
  if (x == null) return "";
  return String(x);
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

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

function toDateGB(x: any) {
  if (!x) return "";
  const d = new Date(String(x));
  if (Number.isNaN(d.getTime())) return safeStr(x);
  return d.toLocaleString("en-GB");
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

function hexToARGB(hex: string) {
  const h = safeStr(hex).replace("#", "").trim();
  const six = (h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.padEnd(6, "1")).slice(0, 6);
  return ("FF" + six).toUpperCase();
}

function normKey(s: string) {
  return safeStr(s).toLowerCase().trim().replace(/\s+/g, "_");
}

function safeSheetName(name: string) {
  const cleaned = safeStr(name)
    .replace(/[:\\/?*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
  return cleaned || "Sheet";
}

function formatUkDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/* ------------------------- storage helpers ------------------------- */

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

/* ------------------------- membership (tolerant) ------------------------- */

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

/* ------------------------- excel styling ------------------------- */

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
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    fill(c, "FF0F172A");
    c.alignment = { vertical: "middle", horizontal: "left" };
    borderAll(c);
  });
}

function zebra(row: ExcelJS.Row, idx: number) {
  if (idx % 2 === 1) row.eachCell((c) => fill(c, "FFF8FAFC"));
  row.eachCell((c) => borderAll(c));
}

/**
 * ? FIXED:
 * headers must start at Column A (NO leading null)
 */
function writeHeadersAtRow(ws: ExcelJS.Worksheet, headerRowNumber: number) {
  const headers = (ws.columns || []).map((c: any) => safeStr(c?.header));
  const row = ws.getRow(headerRowNumber);

  // ExcelJS row.values is 1-indexed *internally*,
  // but providing a normal array writes starting at column A.
  row.values = headers;

  styleHeaderRow(row);
}

/* ------------------------- ID logic ------------------------- */

function deriveCrId(cr: any) {
  const seq = cr?.seq;
  if (seq != null && String(seq).trim() !== "") return `CR-${String(seq).trim()}`;
  const id = safeStr(cr?.id);
  return id ? `CR-${id.slice(0, 8).toUpperCase()}` : "CR";
}

/* ------------------------- sheet builders ------------------------- */

type ChangeRow = {
  id: string;
  public_id: string; // CR ID
  title: string;
  status: string;
  decision_status: string;
  priority: string;
  delivery_status: string;
  requester_name: string;
  owner_label: string;
  assignee_id: string;
  due_date: string;
  updated_at: string;
  created_at: string;
  cost_impact: string;
  schedule_impact_days: string;
  risk_summary: string;
  description: string;
  proposed_change: string;
  attachments: string;
};

function addOverviewSheet(
  wb: ExcelJS.Workbook,
  brandARGB: string, // kept for compatibility, but no longer used
  meta: { projectName: string; projectCode: string; clientName: string; generated: string; changeId: string }
) {
  const ws = wb.addWorksheet("Overview", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [{ width: 22 }, { width: 70 }];

  // Brand bar removed - headers now start at row 1

  ws.getCell("A1").value = "Field";
  ws.getCell("B1").value = "Value";
  ws.getRow(1).font = { bold: true };
  borderAll(ws.getCell("A1"));
  borderAll(ws.getCell("B1"));

  const rows: Array<[string, string]> = [
    ["Document", "Change Request"],
    ["Generated", meta.generated],
    ["Project", meta.projectName],
    ["Project Code", meta.projectCode || "—"],
    ["Client", meta.clientName || "—"],
    ["Filter", `change_id = ${meta.changeId}`],
  ];

  let r = 2;
  for (const [k, v] of rows) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 2).value = v;
    borderAll(ws.getCell(r, 1));
    borderAll(ws.getCell(r, 2));
    r++;
  }

  return ws;
}

function addLaneSheet(wb: ExcelJS.Workbook, sheetName: string, brandARGB: string, rows: ChangeRow[]) {
  const ws = wb.addWorksheet(safeSheetName(sheetName), { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "ID", key: "public_id", width: 14 },
    { header: "Title", key: "title", width: 28 },
    { header: "Gov Status", key: "status", width: 16 },
    { header: "Lane (Delivery)", key: "delivery_status", width: 16 },
    { header: "Decision", key: "decision_status", width: 14 },
    { header: "Priority", key: "priority", width: 12 },
    { header: "Requester", key: "requester_name", width: 16 },
    { header: "Owner", key: "owner_label", width: 16 },
    { header: "Due", key: "due_date", width: 18 },
    { header: "Cost", key: "cost_impact", width: 14 },
    { header: "Schedule (days)", key: "schedule_impact_days", width: 14 },
    { header: "Risk", key: "risk_summary", width: 18 },
    { header: "Updated", key: "updated_at", width: 18 },
    { header: "Description", key: "description", width: 42 },
    { header: "Proposed Change", key: "proposed_change", width: 42 },
    { header: "Attachments", key: "attachments", width: 30 },
  ];

  // Brand bar removed - headers now at row 1
  writeHeadersAtRow(ws, 1);

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.alignment = { vertical: "top", wrapText: true };
    zebra(row, i);
  });

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ws.columnCount },
  };

  return ws;
}

/* ------------------------- main handler ------------------------- */

async function handle(req: NextRequest, routeId: string) {
  try {
    const url = new URL(req.url);

    let change_id =
      safeStr(routeId) ||
      safeStr(url.searchParams.get("id")) ||
      safeStr(url.searchParams.get("changeId")) ||
      safeStr(url.searchParams.get("change_id"));

    if (!change_id && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      change_id = safeStr((body as any)?.change_id || (body as any)?.id);
    }

    if (!change_id) return jsonErr("Missing change id", 400);

    const supabase = await createClient();

    const { data: cr, error: crErr } = await supabase.from(CHANGE_TABLE).select("*").eq("id", change_id).single();
    if (crErr || !cr) return jsonErr("Change request not found", 404);

    const projectId = safeStr((cr as any).project_id);
    if (!projectId) return jsonErr("Change request missing project_id", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid project_id", 400);

    await requireAuthAndMembership(supabase, projectId);

    let projectName = "Project";
    let projectCode = projectId.slice(0, 8);
    let clientName = "";
    let brandHex = "#111827";

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("title, project_code, client_name, brand_primary_color")
      .eq("id", projectId)
      .maybeSingle();

    if (pErr) throw new Error(pErr.message);

    if (project) {
      projectName = safeStr((project as any).title) || projectName;
      projectCode = safeStr((project as any).project_code) || projectCode;
      clientName = safeStr((project as any).client_name) || clientName;
      brandHex = safeStr((project as any).brand_primary_color) || brandHex;
    }

    const BRAND = hexToARGB(brandHex);

    const impact = ((cr as any).impact_analysis && typeof (cr as any).impact_analysis === "object"
      ? (cr as any).impact_analysis
      : {}) as any;

    const days = Number(impact?.days ?? (cr as any)?.ai_schedule ?? 0) || 0;
    const cost = Number(impact?.cost ?? (cr as any)?.ai_cost ?? 0) || 0;
    const risk = safeStr(impact?.risk ?? (cr as any)?.ai_risk ?? "None identified");

    const attachments = await listAttachmentNames(supabase, change_id);
    const crId = deriveCrId(cr);

    const row: ChangeRow = {
      id: safeStr((cr as any).id),
      public_id: crId,
      title: safeStr((cr as any).title),
      status: safeStr((cr as any).status),
      decision_status: safeStr((cr as any).decision_status),
      priority: safeStr((cr as any).priority),
      delivery_status: safeStr((cr as any).delivery_status),
      requester_name: safeStr((cr as any).requester_name),
      owner_label: safeStr((cr as any).owner_label),
      assignee_id: safeStr((cr as any).assignee_id),
      due_date: safeStr((cr as any).due_date ? toDateGB((cr as any).due_date) : ""),
      updated_at: safeStr((cr as any).updated_at ? toDateGB((cr as any).updated_at) : ""),
      created_at: safeStr((cr as any).created_at ? toDateGB((cr as any).created_at) : ""),
      cost_impact: formatGBP(cost),
      schedule_impact_days: String(days),
      risk_summary: risk,
      description: safeStr((cr as any).description),
      proposed_change: safeStr((cr as any).proposed_change),
      attachments: attachments.join(" | "),
    };

    const LANE_ORDER = [
      { key: "intake", sheet: "Intake" },
      { key: "analysis", sheet: "Analysis" },
      { key: "review", sheet: "Review" },
      { key: "implementation", sheet: "Implementation" },
      { key: "closed", sheet: "Closed" },
    ] as const;

    const buckets: Record<string, ChangeRow[]> = {};
    for (const l of LANE_ORDER) buckets[l.key] = [];
    const other: ChangeRow[] = [];

    const laneKey = normKey(row.delivery_status) || normKey(row.status);
    if (buckets[laneKey]) buckets[laneKey].push(row);
    else other.push(row);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Aliena AI";
    wb.created = new Date();
    wb.modified = new Date();

    addOverviewSheet(wb, BRAND, {
      projectName,
      projectCode,
      clientName,
      generated: formatUkDateTime(),
      changeId: safeStr((cr as any).id),
    });

    for (const l of LANE_ORDER) addLaneSheet(wb, l.sheet, BRAND, buckets[l.key] ?? []);
    if (other.length) addLaneSheet(wb, "Other", BRAND, other);

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `${sanitizeFilename(crId)}_Change_Request.xlsx`;

    return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(Buffer.from(buffer as any)))), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[SINGLE CR XLSX EXPORT]", err);
    const msg = String(err?.message || "Failed to generate XLSX");
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return jsonErr(msg, status);
  }
}

export async function exportChangeXlsx(req: NextRequest, id: string) {
  return handle(req, safeStr(id));
}
