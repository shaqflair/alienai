// src/app/api/change/[id]/export/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { sb, requireUser, requireProjectRole, safeStr } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

function err(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function htmlEscape(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function crDisplayId(row: any) {
  const seq = Number(row?.seq);
  if (Number.isFinite(seq) && seq > 0) return `CR${seq}`;
  const pid = safeStr(row?.public_id).trim();
  const m = pid.match(/(\d+)/);
  if (m?.[1]) return `CR${m[1]}`;
  return safeStr(row?.public_id).trim() || safeStr(row?.id).trim();
}

async function loadChange(supabase: any, id: string) {
  const { data, error } = await supabase
    .from("change_requests")
    .select(
      `
      id,
      public_id,
      seq,
      project_id,
      artifact_id,
      title,
      description,
      proposed_change,
      impact_analysis,
      status,
      delivery_status,
      priority,
      tags,
      requester_name,
      requester_id,
      decision_status,
      decision_rationale,
      decision_at,
      decision_role,
      created_at,
      updated_at
    `
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

function toWordHtml(row: any) {
  const impact = row?.impact_analysis ?? {};
  const tags = Array.isArray(row?.tags) ? row.tags : [];
  const title = safeStr(row?.title) || "Change Request";
  const crId = crDisplayId(row);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(crId)} - ${htmlEscape(title)}</title>
  <style>
    body{ font-family: Arial, sans-serif; margin: 32px; }
    h1{ font-size: 22px; margin: 0 0 8px; }
    .meta{ color:#444; font-size: 12px; margin-bottom: 18px; }
    .sec{ margin-top: 18px; }
    .label{ font-weight: 700; margin-bottom: 6px; }
    .box{ border: 1px solid #ddd; padding: 12px; border-radius: 10px; white-space: pre-wrap; }
    table{ width:100%; border-collapse: collapse; margin-top: 10px; }
    td,th{ border:1px solid #ddd; padding:8px; font-size:12px; vertical-align: top; }
    th{ background:#f6f6f6; text-align:left; }
  </style>
</head>
<body>
  <h1>${htmlEscape(crId)} — ${htmlEscape(title)}</h1>
  <div class="meta">
    Priority: ${htmlEscape(row?.priority ?? "Medium")} • Status: ${htmlEscape(row?.delivery_status ?? row?.status ?? "new")}
    • Updated: ${htmlEscape(row?.updated_at ?? "")}
  </div>

  <div class="sec">
    <div class="label">Summary</div>
    <div class="box">${htmlEscape(row?.description ?? "")}</div>
  </div>

  <div class="sec">
    <div class="label">Proposed Change</div>
    <div class="box">${htmlEscape(row?.proposed_change ?? "")}</div>
  </div>

  <div class="sec">
    <div class="label">Impact (AI/Estimate)</div>
    <table>
      <tr><th>Days</th><th>Cost</th><th>Risk</th></tr>
      <tr>
        <td>${htmlEscape(String(impact?.days ?? 0))}</td>
        <td>${htmlEscape(String(impact?.cost ?? 0))}</td>
        <td>${htmlEscape(String(impact?.risk ?? "None identified"))}</td>
      </tr>
    </table>
  </div>

  <div class="sec">
    <div class="label">Tags</div>
    <div class="box">${htmlEscape(tags.join(", "))}</div>
  </div>

  <div class="sec">
    <div class="label">Decision</div>
    <table>
      <tr><th>Status</th><th>Role</th><th>At</th><th>Rationale</th></tr>
      <tr>
        <td>${htmlEscape(row?.decision_status ?? "")}</td>
        <td>${htmlEscape(row?.decision_role ?? "")}</td>
        <td>${htmlEscape(row?.decision_at ?? "")}</td>
        <td>${htmlEscape(row?.decision_rationale ?? "")}</td>
      </tr>
    </table>
  </div>

</body>
</html>`;
}

export async function GET(req: Request, ctx: { params: Promise<{ id?: string }>}) {
  try {
    const id = safeStr((await ctx.params).id).trim();
    if (!id) return err("Missing id", 400);

    const url = new URL(req.url);
    const format = safeStr(url.searchParams.get("format")).trim().toLowerCase() || "pdf";

    const supabase = await sb();
    const user = await requireUser(supabase);

    const row = await loadChange(supabase, id);
    if (!row) return err("Not found", 404);

    const projectId = safeStr(row.project_id).trim();
    const role = await (requireProjectRole as any)(supabase, projectId, user.id).catch(async () => {
      return await (requireProjectRole as any)(supabase, projectId);
    });
    if (!role) return err("Forbidden", 403);

    const filenameBase = clamp(crDisplayId(row) || "change-request", 80).replace(/\s+/g, "_");

    // Simple Word export (HTML-as-doc) – works immediately in Word
    if (format === "docx" || format === "word") {
      const html = toWordHtml(row);
      return new NextResponse(new Uint8Array(new Uint8Array(html)), {
        status: 200,
        headers: {
          "Content-Type": "application/msword; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filenameBase}.doc"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // Simple PDF fallback: return the same HTML, but as printable content
    // If you later add a real PDF renderer, swap this out.
    const html = toWordHtml(row);
    return new NextResponse(new Uint8Array(new Uint8Array(html)), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.html"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[GET /api/change/:id/export]", e);
    return err(safeStr(e?.message) || "Export failed", 500);
  }
}

