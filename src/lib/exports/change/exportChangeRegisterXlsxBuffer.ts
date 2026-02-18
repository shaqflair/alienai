import "server-only";

import { createClient } from "@/utils/supabase/server";
import ExcelJS from "exceljs";

/* ------------------------------------------------ constants ------------------------------------------------ */

const TABLE = "change_requests";

/* ------------------------------------------------ helpers ------------------------------------------------ */

function safeStr(x: unknown) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function normalizeProjectRef(input: unknown) {
  let v = safeStr(input);
  if (!v) return "";

  try {
    v = decodeURIComponent(v);
  } catch {}

  v = v.trim();
  if (!v) return "";

  if (isUuid(v)) return v;

  const up = v.toUpperCase();
  if (up.startsWith("P-")) v = v.slice(2).trim();

  v = v.replace(/[^a-z0-9._-]+/gi, "").trim();
  return v;
}

function safeUuid(x: unknown): string | null {
  const s = safeStr(x);
  if (!s) return null;
  return isUuid(s) ? s : null;
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

async function resolveProjectId(supabase: any, projectRef: string) {
  const ref = safeStr(projectRef).trim();
  if (!ref) return { projectId: "", projectRow: null as any };

  if (isUuid(ref)) {
    const { data: proj, error } = await supabase
      .from("projects")
      .select("id, title, project_code, client_name")
      .eq("id", ref)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return { projectId: proj?.id ? String(proj.id) : "", projectRow: proj };
  }

  const { data: proj, error } = await supabase
    .from("projects")
    .select("id, title, project_code, client_name")
    .eq("project_code", ref)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return { projectId: proj?.id ? String(proj.id) : "", projectRow: proj };
}

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  // Prefer removed_at model (if present)
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
      return { userId: auth.user.id, role: String((mem as any).role ?? "viewer") };
    }

    if (memErr && !looksMissingColumn(memErr)) {
      // fall through
    }
  }

  // Fallback is_active
  {
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("role,is_active")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (memErr) throw new Error(memErr.message);
    if (!mem?.is_active) throw new Error("Forbidden");
    return { userId: auth.user.id, role: String((mem as any).role ?? "viewer") };
  }
}

function formatUkDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function sanitizeFilename(name: string) {
  return (
    String(name || "change-register")
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "change-register"
  );
}

function iaDays(cr: any): number {
  const ia = cr?.impact_analysis;
  const d =
    (ia && typeof ia === "object" && !Array.isArray(ia) ? Number((ia as any).days) : NaN) ||
    Number(cr?.ai_schedule) ||
    0;
  return Number.isFinite(d) ? d : 0;
}

function iaCost(cr: any): number {
  const ia = cr?.impact_analysis;
  const c =
    (ia && typeof ia === "object" && !Array.isArray(ia) ? Number((ia as any).cost) : NaN) ||
    Number(cr?.ai_cost) ||
    0;
  return Number.isFinite(c) ? c : 0;
}

function asGbDateTime(x: any) {
  const s = safeStr(x);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-GB");
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

/* ----------------------------------------------- Excel style ----------------------------------------------- */

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
  if (idx % 2 === 0) row.eachCell((c) => fill(c, "FFF8FAFC"));
  row.eachCell((c) => borderAll(c));
}

function derivePublicId(cr: any) {
  const seq = cr?.seq;
  if (seq != null && String(seq).trim() !== "") return `CR-${String(seq).trim()}`;
  const id = safeStr(cr?.id);
  return id ? `CR-${id.slice(0, 8).toUpperCase()}` : "CR";
}

/* ----------------------------------------------- Input parsing ----------------------------------------------- */

export type ChangeRegisterInputs = {
  project_ref: string; // uuid or project_code
  artifact_id: string | null;
};

export function parseChangeRegisterInputsFromRequest(req: Request): ChangeRegisterInputs {
  const url = new URL(req.url);

  const project_ref = normalizeProjectRef(url.searchParams.get("projectId") || url.searchParams.get("project_id"));
  const artifact_id = safeUuid(url.searchParams.get("artifactId") || url.searchParams.get("artifact_id"));

  return { project_ref, artifact_id };
}

/* ----------------------------------------------- Sheets ----------------------------------------------- */

type CRRow = {
  public_id: string;
  title: string;
  priority: string;
  impact_days: number;
  impact_cost: number;
  delivery_status: string;
  status: string;
  decision_status: string;
  updated_at: string;
};

function addOverviewSheet(wb: ExcelJS.Workbook, meta: { projectTitle: string; projectCode: string; clientName: string; generated: string }) {
  const ws = wb.addWorksheet("Overview", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [{ width: 22 }, { width: 72 }];

  ws.getCell("A1").value = "Field";
  ws.getCell("B1").value = "Value";
  styleHeaderRow(ws.getRow(1));

  // ? FILTER ROW REMOVED (per request)
  const rows: Array<[string, string]> = [
    ["Document", "Change Register"],
    ["Generated", meta.generated],
    ["Project", meta.projectTitle],
    ["Project Code", meta.projectCode || "—"],
    ["Client", meta.clientName || "—"],
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

function addRegisterSheet(wb: ExcelJS.Workbook, name: string, items: CRRow[]) {
  const ws = wb.addWorksheet(safeSheetName(name), { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { key: "public_id", width: 14 },
    { key: "title", width: 44 },
    { key: "priority", width: 12 },
    { key: "impact_days", width: 12 },
    { key: "impact_cost", width: 14 },
    { key: "delivery_status", width: 18 },
    { key: "status", width: 16 },
    { key: "decision_status", width: 16 },
    { key: "updated_at", width: 20 },
  ];

  const headerLabels = [
    "CR ID",
    "Title",
    "Priority",
    "Impact Days",
    "Impact Cost",
    "Lane (Delivery)",
    "Gov Status",
    "Decision",
    "Updated",
  ];
  const headerRow = ws.getRow(1);
  for (let i = 0; i < headerLabels.length; i++) headerRow.getCell(i + 1).value = headerLabels[i];
  styleHeaderRow(headerRow);

  items.forEach((x, i) => {
    const row = ws.addRow({
      public_id: x.public_id,
      title: x.title,
      priority: x.priority,
      impact_days: x.impact_days,
      impact_cost: x.impact_cost,
      delivery_status: x.delivery_status,
      status: x.status,
      decision_status: x.decision_status,
      updated_at: x.updated_at,
    });
    row.alignment = { vertical: "top", wrapText: true };
    zebra(row, i);
  });

  ws.getColumn(5).numFmt = "#,##0";
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
  return ws;
}

/* ------------------------------------------------ Exporter ------------------------------------------------ */

export async function exportChangeRegisterXlsxBuffer(input: ChangeRegisterInputs) {
  const project_ref = safeStr(input?.project_ref);
  const artifact_id = input?.artifact_id ? safeStr(input.artifact_id) : null;

  if (!project_ref) {
    const e = new Error("Missing or invalid project_id");
    (e as any).status = 400;
    throw e;
  }

  const supabase = await createClient();

  const { projectId: project_id, projectRow } = await resolveProjectId(supabase, project_ref);
  if (!project_id) {
    const e = new Error("Missing or invalid project_id");
    (e as any).status = 400;
    throw e;
  }

  await requireAuthAndMembership(supabase, project_id);

  let projectTitle = "Project";
  let projectCode = project_ref.slice(0, 12);
  let clientName = "";

  if (projectRow) {
    projectTitle = safeStr((projectRow as any).title) || projectTitle;
    projectCode = safeStr((projectRow as any).project_code) || projectCode;
    clientName = safeStr((projectRow as any).client_name) || clientName;
  }

  let q = supabase
    .from(TABLE)
    .select("id, seq, public_id, title, priority, delivery_status, status, decision_status, updated_at, impact_analysis, ai_schedule, ai_cost")
    .eq("project_id", project_id);

  if (artifact_id) q = q.eq("artifact_id", artifact_id);

  const { data: rows, error } = await q.order("delivery_status", { ascending: true }).order("updated_at", { ascending: false });

  if (error) {
    const e = new Error(error.message);
    (e as any).status = 400;
    throw e;
  }

  const itemsRaw = rows || [];

  const items: CRRow[] = itemsRaw.map((cr: any) => ({
    public_id: derivePublicId(cr),
    title: safeStr(cr.title),
    priority: safeStr(cr.priority),
    impact_days: iaDays(cr),
    impact_cost: iaCost(cr),
    delivery_status: safeStr(cr.delivery_status),
    status: safeStr(cr.status),
    decision_status: safeStr(cr.decision_status),
    updated_at: asGbDateTime(cr.updated_at),
  }));

  const LANE_ORDER = [
    { key: "intake", name: "Intake" },
    { key: "analysis", name: "Analysis" },
    { key: "review", name: "Review" },
    { key: "in_progress", name: "In Progress" },
    { key: "implemented", name: "Implemented" },
    { key: "closed", name: "Closed" },
  ] as const;

  const buckets: Record<string, CRRow[]> = {};
  for (const l of LANE_ORDER) buckets[l.key] = [];
  const other: CRRow[] = [];

  for (const it of items) {
    const lane = normKey(it.delivery_status) || normKey(it.status);
    if (lane && buckets[lane]) buckets[lane].push(it);
    else other.push(it);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aliena";
  wb.created = new Date();
  wb.modified = new Date();

  addOverviewSheet(wb, {
    projectTitle,
    projectCode,
    clientName,
    generated: formatUkDateTime(),
  });

  addRegisterSheet(wb, "All", items);
  for (const l of LANE_ORDER) addRegisterSheet(wb, l.name, buckets[l.key] || []);
  if (other.length) addRegisterSheet(wb, "Other", other);

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${sanitizeFilename(projectTitle)}_Register.xlsx`;

  return { buffer: Buffer.from(buffer as any), filename };
}
