import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import ExcelJS from "exceljs";

/* =============================================================================
   RAID XLSX Exporter (Standardised)
============================================================================= */

function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
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

function formatDateUK(dateInput: unknown): string {
  if (!dateInput) return "";
  const d = new Date(String(dateInput));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB");
}

function formatDateTimeUK(dateInput: unknown): string {
  if (!dateInput) return "";
  const d = new Date(String(dateInput));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB");
}

function asNum(x: any) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function score(prob: any, sev: any) {
  const p = clamp(asNum(prob), 0, 100);
  const s = clamp(asNum(sev), 0, 100);
  return Math.round((p * s) / 100);
}
function normStatusKey(s: string) {
  return safeStr(s).trim().toLowerCase().replace(/\s+/g, "_");
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

/* ----------------------------------------- membership (tolerant) ----------------------------------------- */

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  // try removed_at model
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
      // fallback below
    }
  }

  // fallback is_active model
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

/* ----------------------------------------- worksheet builders ----------------------------------------- */

type RaidRow = {
  public_id: string;
  type: string;
  status: string;
  priority: string;
  probability: number | null;
  severity: number | null;
  score: number;
  impact: string;
  owner_label: string;
  title: string;
  description: string;
  response_plan: string;
  next_steps: string;
  notes: string;
  ai_rollup: string;
  due_date: string;
  updated_at: string;
  created_at: string;
};

const RAID_COLUMNS: Array<{ header: string; key: keyof RaidRow; width: number }> = [
  { header: "ID", key: "public_id", width: 14 },
  { header: "Type", key: "type", width: 12 },
  { header: "Status", key: "status", width: 14 },
  { header: "Priority", key: "priority", width: 12 },
  { header: "Probability", key: "probability", width: 12 },
  { header: "Severity", key: "severity", width: 10 },
  { header: "Score", key: "score", width: 8 },
  { header: "Owner", key: "owner_label", width: 18 },
  { header: "Title", key: "title", width: 26 },
  { header: "Description", key: "description", width: 46 },
  { header: "Impact", key: "impact", width: 24 },
  { header: "Response Plan", key: "response_plan", width: 34 },
  { header: "Next Steps", key: "next_steps", width: 34 },
  { header: "Notes", key: "notes", width: 34 },
  { header: "AI Rollup", key: "ai_rollup", width: 40 },
  { header: "Due Date", key: "due_date", width: 12 },
  { header: "Updated", key: "updated_at", width: 18 },
  { header: "Created", key: "created_at", width: 18 },
];

function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
}

function tintScoreCell(cell: ExcelJS.Cell, sc: number) {
  cell.font = { bold: true };
  if (sc >= 61) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE4E6" } };
  else if (sc >= 31) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };
  else cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECFDF5" } };
}

function addRaidSheet(wb: ExcelJS.Workbook, name: string, rows: RaidRow[]) {
  const sheet = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });

  sheet.columns = RAID_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key as string,
    width: c.width,
  }));

  styleHeaderRow(sheet.getRow(1));

  rows.forEach((row, idx) => {
    const excelRow = sheet.addRow(row);
    excelRow.alignment = { vertical: "top", wrapText: true };

    if (idx % 2 === 1) {
      excelRow.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      });
    }

    const sc = Number(row.score) || 0;
    const scoreColIndex = RAID_COLUMNS.findIndex((c) => c.key === "score") + 1;
    if (scoreColIndex > 0) tintScoreCell(excelRow.getCell(scoreColIndex), sc);
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };

  return sheet;
}

export async function exportRaidXlsx(args: {
  req: NextRequest;
  artifactId: string;
  projectId: string | null;
  content_json: any; 
}) {
  try {
    const { artifactId } = args;
    let projectId = safeStr(args.projectId).trim();
    const supabase = await createClient();

    if (!projectId) {
      const { data: art, error: artErr } = await supabase
        .from("artifacts")
        .select("id,project_id")
        .eq("id", artifactId)
        .maybeSingle();

      if (artErr) throw new Error(artErr.message);
      if (art?.project_id) projectId = safeStr((art as any).project_id).trim();
    }

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);

    await requireAuthAndMembership(supabase, projectId);

    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("id,title,project_code,client_name,organisation_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr || !proj) throw new Error("Project not found");

    let organisationName = "";
    const organisationId = (proj as any).organisation_id ?? null;
    if (organisationId) {
      const { data: org } = await supabase.from("organisations").select("name").eq("id", organisationId).maybeSingle();
      if (org?.name) organisationName = safeStr(org.name).trim();
    }

    const { data: items, error } = await supabase
      .from("raid_items")
      .select("public_id,type,status,priority,probability,severity,impact,owner_label,title,description,response_plan,next_steps,notes,ai_rollup,due_date,updated_at,created_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    const now = new Date();
    const projectName = safeStr((proj as any).title).trim() || "Project";
    const projectCode = safeStr((proj as any).project_code).trim() || projectId.slice(0, 8);
    const clientName = safeStr((proj as any).client_name).trim();

    const rowsAll: RaidRow[] = (items ?? []).map((it: any) => ({
      public_id: safeStr(it.public_id),
      type: safeStr(it.type),
      status: safeStr(it.status),
      priority: safeStr(it.priority),
      probability: it.probability ?? null,
      severity: it.severity ?? null,
      score: score(it.probability, it.severity),
      impact: safeStr(it.impact),
      owner_label: safeStr(it.owner_label),
      title: safeStr(it.title),
      description: safeStr(it.description),
      response_plan: safeStr(it.response_plan),
      next_steps: safeStr(it.next_steps),
      notes: safeStr(it.notes),
      ai_rollup: safeStr(it.ai_rollup),
      due_date: it.due_date ? formatDateUK(it.due_date) : "",
      updated_at: it.updated_at ? formatDateTimeUK(it.updated_at) : "",
      created_at: it.created_at ? formatDateTimeUK(it.created_at) : "",
    }));

    const TYPES = [
      { db: "Risk", sheet: "Risks" },
      { db: "Issue", sheet: "Issues" },
      { db: "Assumption", sheet: "Assumptions" },
      { db: "Dependency", sheet: "Dependencies" },
    ] as const;

    const byType: Record<string, RaidRow[]> = { "Risk": [], "Issue": [], "Assumption": [], "Dependency": [] };
    for (const row of rowsAll) {
      const key = safeStr(row.type).trim();
      if (byType[key]) byType[key].push(row);
    }

    const total = rowsAll.length;
    const openish = new Set(["open", "in_progress", "in progress"]);
    const openCount = rowsAll.filter((x) => openish.has(normStatusKey(x.status))).length;
    const closedCount = rowsAll.filter((x) => normStatusKey(x.status) === "closed").length;
    const highExposure = rowsAll.filter((x) => x.score >= 61 && normStatusKey(x.status) !== "closed").length;

    const wb = new ExcelJS.Workbook();
    wb.creator = "Aliena AI";

    const summary = wb.addWorksheet("Summary");
    summary.getCell("A1").value = "RAID Export";
    summary.getCell("A1").font = { bold: true, size: 18 };

    let r = 3;
    const addKV = (k: string, v: any) => {
      summary.getCell(r, 1).value = k;
      summary.getCell(r, 1).font = { bold: true };
      summary.getCell(r, 2).value = v;
      r++;
    };

    addKV("Project", projectName);
    addKV("Project Code", projectCode);
    if (clientName) addKV("Client", clientName);
    addKV("Generated", now.toLocaleString("en-GB"));

    r += 2;
    summary.getCell(r, 1).value = "Key Metrics";
    summary.getCell(r, 1).font = { bold: true, size: 12 };
    r++;

    [["Open", openCount], ["High Exposure", highExposure], ["Closed", closedCount], ["Total", total]].forEach(([k, v]) => {
      summary.getCell(r, 1).value = k;
      summary.getCell(r, 2).value = v;
      summary.getCell(r, 2).font = { bold: true };
      r++;
    });

    summary.getColumn(1).width = 25;
    summary.getColumn(2).width = 40;

    for (const t of TYPES) addRaidSheet(wb, t.sheet, byType[t.db]);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = `RAID_${sanitizeFilename(projectCode)}.xlsx`;

    return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(buffer))), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return jsonErr(e?.message ?? "Export failed", 500);
  }
}
