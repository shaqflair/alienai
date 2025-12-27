// src/app/projects/[id]/artifacts/[artifactId]/export/docx/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  AlignmentType,
  Document,
  Header,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

// ✅ IMPORTANT: docx + Buffer requires Node runtime
export const runtime = "nodejs";

/* -------------------------------- Utilities -------------------------------- */

function safeHexColor(x: unknown, fallback = "#E60000") {
  const s = String(x ?? "").trim();
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s)) return s;
  return fallback;
}

function derivedStatus(a: any) {
  const s = String(a?.approval_status ?? "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "changes_requested") return "changes_requested";
  if (s === "submitted") return "submitted";
  if (a?.approved_by) return "approved";
  if (a?.rejected_by) return "rejected";
  if (a?.is_locked) return "submitted";
  return "draft";
}

function watermarkTextFromStatus(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return "";
  if (s === "submitted") return "SUBMITTED";
  if (s === "changes_requested") return "CHANGES REQUESTED";
  if (s === "rejected") return "REJECTED";
  return "DRAFT";
}

function niceStatus(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "changes_requested") return "CHANGES REQUESTED";
  return s.toUpperCase();
}

function fmtDateOnly(x: string | null | undefined) {
  if (!x) return "";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(x);
  }
}

async function fetchLogoBuffer(url?: string | null): Promise<Buffer | null> {
  const u = String(url ?? "").trim();
  if (!u) return null;
  try {
    const res = await fetch(u, { cache: "no-store" });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/* ---------------------- Legacy charter table extraction ---------------------- */

function cellText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return String(node.text ?? "");
  const kids = Array.isArray(node.content) ? node.content : [];
  return kids.map(cellText).join("");
}

function extractTable(doc: any) {
  const table = (doc?.content ?? []).find((n: any) => n?.type === "table");
  return table ?? null;
}

/* ---------------------------- Canonical v2 support --------------------------- */

function getSectionsFromContentJson(content_json: any) {
  if (content_json && typeof content_json === "object" && Array.isArray((content_json as any).sections)) {
    return (content_json as any).sections.map((s: any, idx: number) => ({
      key: String(s?.key ?? `section_${idx + 1}`),
      title: String(s?.title ?? `Section ${idx + 1}`),
      content_json: s?.content_json ?? {},
    }));
  }
  return [{ key: "content", title: "Content", content_json: content_json ?? {} }];
}

function stringifyFallback(x: any) {
  if (!x) return "";
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

/* -------------------------------- Approvals -------------------------------- */

type ApprovalRow = {
  role: string;
  name: string;
  decision: "Approved" | "Rejected" | "Changes requested" | "Pending";
  date: string;
  comment: string;
};

async function buildApprovalRowsFromAudit(
  supabase: any,
  projectId: string,
  artifactId: string
): Promise<ApprovalRow[]> {
  const { data: approvers } = await supabase
    .from("project_approvers")
    .select("user_id, role")
    .eq("project_id", projectId)
    .eq("is_active", true);

  const approverList =
    approvers?.map((a: any) => ({
      user_id: String(a.user_id),
      role: String(a.role ?? "Approver"),
    })) ?? [];

  const ids = Array.from(new Set(approverList.map((a) => a.user_id).filter(Boolean)));
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids)
    : ({ data: [] } as any);

  const byId = new Map<string, any>();
  for (const p of profiles ?? []) byId.set(String(p.user_id), p);

  const displayName = (uid: string, fallbackEmail?: string) => {
    const p = byId.get(uid);
    return (
      String(p?.full_name ?? "").trim() ||
      String(p?.email ?? "").trim() ||
      (fallbackEmail ? String(fallbackEmail).trim() : "") ||
      uid.slice(0, 8) + "…"
    );
  };

  const { data: auditRows } = await supabase
    .from("artifact_audit")
    .select("actor_user_id, actor_email, on_behalf_of_user_id, on_behalf_of_email, action, meta, created_at")
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: false })
    .limit(500);

  const latestByApprover = new Map<string, any>();
  for (const row of auditRows ?? []) {
    const effectiveUserId = String(row?.on_behalf_of_user_id ?? row?.actor_user_id ?? "");
    if (!effectiveUserId) continue;
    if (latestByApprover.has(effectiveUserId)) continue;

    const action = String(row?.action ?? "").toLowerCase();
    if (action.includes("approve") || action.includes("reject") || action.includes("change")) {
      latestByApprover.set(effectiveUserId, row);
    }
  }

  const mapDecision = (action: string): ApprovalRow["decision"] => {
    const a = String(action ?? "").toLowerCase();
    if (a.includes("approve")) return "Approved";
    if (a.includes("reject")) return "Rejected";
    if (a.includes("change")) return "Changes requested";
    return "Pending";
  };

  const commentFromMeta = (meta: any) => {
    const m = meta && typeof meta === "object" ? meta : {};
    return (
      String(m.reason ?? "").trim() ||
      String(m.comment ?? "").trim() ||
      String(m.note ?? "").trim() ||
      String(m.rejection_reason ?? "").trim() ||
      ""
    );
  };

  const rows: ApprovalRow[] = approverList.map((a) => {
    const ev = latestByApprover.get(a.user_id);
    return {
      role: a.role || "Approver",
      name: displayName(a.user_id, ev?.on_behalf_of_email || ev?.actor_email),
      decision: ev ? mapDecision(String(ev.action ?? "")) : "Pending",
      date: ev ? fmtDateOnly(ev.created_at ?? null) : "",
      comment: ev ? commentFromMeta(ev.meta) : "",
    };
  });

  if (rows.length === 0) {
    rows.push({
      role: "—",
      name: "No approvers configured",
      decision: "Pending",
      date: "",
      comment: "Add active approvers in Project Approvals.",
    });
  }

  return rows;
}

/* ----------------------------------- GET ----------------------------------- */

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; artifactId: string }> } // ✅ Next 15/16
) {
  try {
    // ✅ FIX: unwrap params properly
    const { id, artifactId } = await ctx.params;
    const projectId = String(id ?? "").trim();
    const aid = String(artifactId ?? "").trim();

    if (!projectId || !aid) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: mem } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (!mem) return NextResponse.json({ error: "Not a project member" }, { status: 403 });

    // Branding columns
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, title, client_name, client_logo_url, brand_primary_color")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) console.warn("[projects.select]", projErr.message);

    const clientName =
      String(project?.client_name ?? "").trim() || String(project?.title ?? "").trim() || "Client";

    const logoUrl = String(project?.client_logo_url ?? "").trim() || null;
    const brandColor = safeHexColor(project?.brand_primary_color, "#E60000").replace("#", "").toUpperCase();
    const logoBuf = await fetchLogoBuffer(logoUrl);

    const { data: artifact, error } = await supabase
      .from("artifacts")
      .select("id,title,type,content_json,updated_at,created_at,approval_status,approved_by,rejected_by,is_locked,version")
      .eq("id", aid)
      .eq("project_id", projectId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!artifact) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const status = derivedStatus(artifact);
    const watermark = watermarkTextFromStatus(status);

    const titleText = String(artifact.title ?? "Project Charter");
    const fileBase = titleText.replace(/[^\w\-]+/g, "-").replace(/\-+/g, "-").replace(/^\-|\-$/g, "");
    const fileName = `${fileBase || "project-charter"}-${niceStatus(status)}.docx`;

    const sections = getSectionsFromContentJson((artifact as any).content_json);

    // Find a legacy table anywhere
    let tableNode: any | null = null;
    for (const s of sections) {
      tableNode = extractTable(s.content_json);
      if (tableNode) break;
    }

    const approvalRows = await buildApprovalRowsFromAudit(supabase, projectId, aid);

    // Branded header
    const docHeader = new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({ text: clientName, bold: true }),
            new TextRun({ text: "   " }),
            new TextRun({ text: `Brand: ${brandColor}`, color: brandColor }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({
              text: `Confidential – Generated by AlienAI – ${new Date().toISOString().slice(0, 10)}`,
              color: "666666",
            }),
          ],
        }),
        ...(logoBuf
          ? [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new ImageRun({
                    data: logoBuf,
                    transformation: { width: 140, height: 32 },
                  }),
                ],
              }),
            ]
          : []),
      ],
    });

    // “Watermark banner”
    const bannerLines: Paragraph[] = [];
    if (watermark) {
      bannerLines.push(
        new Paragraph({ children: [new TextRun({ text: watermark, bold: true, size: 28, color: "666666" })] }),
        new Paragraph({
          children: [
            new TextRun({
              text: "This document is not final. Status shown above reflects the latest workflow state at export time.",
              size: 18,
              color: "666666",
            }),
          ],
        }),
        new Paragraph(" ")
      );
    }

    const title = new Paragraph({ children: [new TextRun({ text: titleText, bold: true, size: 32 })] });

    const meta = new Paragraph({
      children: [
        new TextRun({
          text: `Status: ${niceStatus(status)}    Version: ${String((artifact as any).version ?? "—")}`,
          size: 20,
          color: "444444",
        }),
      ],
    });

    // Approvals table
    const approvalsHeader = new Paragraph({ children: [new TextRun({ text: "Approvals", bold: true, size: 26 })] });

    const approvalTableRows: TableRow[] = [
      new TableRow({
        children: ["Role", "Approver", "Decision", "Date", "Comment"].map(
          (h) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
            })
        ),
      }),
      ...approvalRows.map(
        (r) =>
          new TableRow({
            children: [r.role, r.name, r.decision, r.date || "—", r.comment || "—"].map(
              (t) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: String(t ?? "—") })] })],
                })
            ),
          })
      ),
    ];

    const approvalTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: approvalTableRows,
    });

    // If no legacy table, export sections
    if (!tableNode) {
      const children: any[] = [
        ...bannerLines,
        title,
        meta,
        new Paragraph(" "),
        new Paragraph({ children: [new TextRun({ text: "Sections", bold: true, size: 24 })] }),
        new Paragraph(" "),
      ];

      for (const s of sections) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: s.title, bold: true, size: 24 })] }),
          new Paragraph({ children: [new TextRun({ text: stringifyFallback(s.content_json) || "—", size: 20 })] }),
          new Paragraph(" ")
        );
      }

      children.push(new Paragraph(" "), approvalsHeader, new Paragraph(" "), approvalTable);

      const out = new Document({ sections: [{ headers: { default: docHeader }, children }] });
      const buf = await Packer.toBuffer(out);

      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // Legacy charter table export
    const rows = (tableNode.content ?? []).filter((r: any) => r?.type === "tableRow");

    const wordRows: TableRow[] = rows.map((r: any) => {
      const cells = (r.content ?? []).filter((c: any) => c?.type === "tableCell" || c?.type === "tableHeader");

      const wordCells = cells.map((c: any) => {
        const colspan = Number(c?.attrs?.colspan ?? 1);
        const text = (c.content ?? []).map(cellText).join("").trim();

        return new TableCell({
          columnSpan: colspan > 1 ? colspan : undefined,
          children: [new Paragraph({ children: [new TextRun({ text: text || " " })] })],
        });
      });

      return new TableRow({ children: wordCells });
    });

    const wordTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: wordRows,
    });

    const out = new Document({
      sections: [
        {
          headers: { default: docHeader },
          children: [
            ...bannerLines,
            title,
            meta,
            new Paragraph(" "),
            wordTable,
            new Paragraph(" "),
            approvalsHeader,
            new Paragraph(" "),
            approvalTable,
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(out);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), stack: e?.stack || null }, { status: 500 });
  }
}
