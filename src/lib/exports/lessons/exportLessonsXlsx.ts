// src/lib/exports/lessons/exportLessonsXlsx.ts
import "server-only";

import ExcelJS from "exceljs";

type SupabaseClient = any;

type ExportXlsxArgs = {
  supabase: SupabaseClient;
  artifactId?: string | null; // preferred
  projectRef?: string | null; // back-compat
  status?: string[] | null;
  filenameBase?: string | null;
};

type ProjectMeta = {
  id: string;
  title: string | null;
  client_name: string | null;
  project_code: string | null;
  organisation_id: string | null;
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
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function formatProjectCode(raw: any) {
  const s = safeStr(raw).trim();
  if (!s) return "";
  if (/^p-\d+/i.test(s)) return s.toUpperCase();
  if (/^\d+$/.test(s)) {
    const n = s.replace(/^0+/, "") || "0";
    const padded = n.padStart(5, "0");
    return `P-${padded}`;
  }
  return s;
}

function friendlyCategory(cat: any) {
  const v = safeStr(cat).trim();
  if (v === "what_went_well") return "What went well";
  if (v === "improvements") return "Improvements";
  if (v === "issues") return "Issues";
  return v || "";
}

function friendlyStatus(st: any) {
  const v = safeStr(st).trim();
  return v || "Open";
}

function safeExcelCell(v: any) {
  const s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

async function resolveProjectFromArtifactOrRef(
  supabase: SupabaseClient,
  artifactId?: string | null,
  projectRef?: string | null
): Promise<{ project: ProjectMeta; humanCode: string }> {
  const aid = safeStr(artifactId).trim();

  if (aid) {
    if (!looksLikeUuid(aid)) throw new Error("artifactId must be a uuid");

    const { data: art, error: aErr } = await supabase
      .from("artifacts")
      .select("id, project_id")
      .eq("id", aid)
      .single();

    if (aErr) throw new Error(`ARTIFACT_QUERY: ${aErr.message}`);
    if (!art?.project_id) throw new Error("ARTIFACT_QUERY: artifact not found");

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id, title, client_name, project_code, organisation_id")
      .eq("id", art.project_id)
      .single();

    if (pErr) throw new Error(`PROJECT_QUERY: ${pErr.message}`);
    if (!project) throw new Error("PROJECT_QUERY: project not found");

    const code = formatProjectCode(project.project_code);
    const humanCode = code || `P-${String(project.id).slice(0, 6).toUpperCase()}`;
    return { project, humanCode };
  }

  const pr = safeStr(projectRef).trim();
  if (!pr) throw new Error("Missing artifactId (or projectRef for back-compat)");

  if (looksLikeUuid(pr)) {
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id, title, client_name, project_code, organisation_id")
      .eq("id", pr)
      .single();

    if (pErr) throw new Error(`PROJECT_QUERY: ${pErr.message}`);
    if (!project) throw new Error("PROJECT_QUERY: project not found");

    const code = formatProjectCode(project.project_code);
    const humanCode = code || `P-${String(project.id).slice(0, 6).toUpperCase()}`;
    return { project, humanCode };
  }

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, title, client_name, project_code, organisation_id")
    .eq("project_code", pr)
    .single();

  if (pErr) throw new Error(`PROJECT_QUERY: ${pErr.message}`);
  if (!project) throw new Error("PROJECT_QUERY: project not found");

  const code = formatProjectCode(project.project_code);
  const humanCode = code || `P-${String(project.id).slice(0, 6).toUpperCase()}`;
  return { project, humanCode };
}

export async function exportLessonsXlsx(
  args: ExportXlsxArgs
): Promise<{ filename: string; bytes: Buffer }> {
  const { supabase, artifactId, projectRef, status, filenameBase } = args;

  const { project, humanCode } = await resolveProjectFromArtifactOrRef(
    supabase,
    artifactId,
    projectRef
  );

  let q = supabase
    .from("lessons_learned")
    .select(
      [
        "id",
        "project_id",
        "category",
        "description",
        "action_for_future",
        "created_at",
        "status",
        "date_raised",
        "impact",
        "severity",
        "project_stage",
        "next_action_summary",
        "is_published",
        "library_tags",
      ].join(",")
    )
    .eq("project_id", project.id)
    // ✅ oldest first so row numbering matches ascending order
    .order("created_at", { ascending: true });

  const statusFilter = (status || []).map((s) => safeStr(s).trim()).filter(Boolean);
  if (statusFilter.length) q = q.in("status", statusFilter);

  const { data, error } = await q;
  if (error) throw new Error(`LESSONS_QUERY: ${error.message}`);

  const items = (data || []).map((l: any) => ({
    ...l,
    status: friendlyStatus(l.status),
    library_tags: Array.isArray(l.library_tags) ? l.library_tags : [],
  }));

  const base = safeStr(filenameBase).trim() || `${humanCode}-lessons-learned`;
  const filename = `${slugify(base)}.xlsx`;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aliena AI";
  wb.created = new Date();

  const ws = wb.addWorksheet("Lessons", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "No", key: "no", width: 6 },
    { header: "Status", key: "status", width: 14 },
    { header: "Date Raised", key: "date", width: 14 },
    { header: "Category", key: "category", width: 18 },
    { header: "Impact", key: "impact", width: 12 },
    { header: "Severity", key: "severity", width: 12 },
    { header: "Project Stage", key: "stage", width: 18 },
    { header: "Description", key: "desc", width: 60 },
    { header: "Next Action", key: "action", width: 45 },
    { header: "Library", key: "library", width: 12 },
    { header: "Tags", key: "tags", width: 30 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 18;

  if (items.length === 0) {
    ws.addRow({
      no: "",
      status: "",
      date: "",
      category: "",
      impact: "",
      severity: "",
      stage: "",
      desc: "",
      action: "",
      library: "",
      tags: "",
    });
  } else {
    items.forEach((l: any, idx: number) => {
      // ✅ ASCENDING numbering
      const no = idx + 1;

      const date = l.date_raised ? ukDateFromIso(l.date_raised) : ukDateFromIso(l.created_at);

      ws.addRow({
        no,
        status: safeExcelCell(friendlyStatus(l.status)),
        date: safeExcelCell(date),
        category: safeExcelCell(friendlyCategory(l.category)),
        impact: safeExcelCell(l.impact || ""),
        severity: safeExcelCell(l.severity || ""),
        stage: safeExcelCell(l.project_stage || ""),
        desc: safeExcelCell(l.description || ""),
        action: safeExcelCell(l.action_for_future || l.next_action_summary || ""),
        library: safeExcelCell(l.is_published ? "Published" : "Private"),
        tags: safeExcelCell((l.library_tags || []).filter(Boolean).join(", ")),
      });
    });
  }

  // subtle borders; no extra banner row
  ws.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE6EAF0" } },
        left: { style: "thin", color: { argb: "FFE6EAF0" } },
        bottom: { style: "thin", color: { argb: "FFE6EAF0" } },
        right: { style: "thin", color: { argb: "FFE6EAF0" } },
      };
      cell.alignment = cell.alignment ?? { vertical: "top", wrapText: true };
      if (rowNumber === 1)
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FB" } };
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return { filename, bytes: Buffer.from(buf) };
}
