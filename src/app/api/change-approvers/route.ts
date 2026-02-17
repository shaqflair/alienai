// src/app/api/change-approvers/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { sb, requireUser, requireProjectRole, safeStr } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function shortUuid(x?: string) {
  const s = safeStr(x).trim();
  return s ? s.slice(0, 6) : "";
}

/** ✅ convert string/number/bigint safely into text */
function toText(x: any): string {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number") return Number.isFinite(x) ? String(x) : "";
  if (typeof x === "bigint") return String(x);
  try {
    return String(x);
  } catch {
    return "";
  }
}

/** ✅ normalize to "PRJ-xxxx" */
function normalizeProjectDisplay(raw: string): string {
  const s = toText(raw).trim();
  if (!s) return "";

  if (/^prj[-\s]/i.test(s)) return s.replace(/\s+/g, "-").replace(/^prj/i, "PRJ");
  if (/^\d+$/.test(s)) return `PRJ-${s}`;

  const stripped = s.replace(/^id\s*:\s*/i, "").trim();
  if (!stripped) return "";

  if (/^prj[-\s]/i.test(stripped)) return stripped.replace(/\s+/g, "-").replace(/^prj/i, "PRJ");
  return `PRJ-${stripped}`;
}

function pickProjectDisplayId(projectRow: any): string {
  // ✅ Your projects table (per your JSON) definitely has: project_code
  const candidates = [toText(projectRow?.project_code)].map((s) => s.trim()).filter(Boolean);

  if (candidates.length) {
    const norm = normalizeProjectDisplay(candidates[0]);
    if (norm) return norm;
  }

  const id = toText(projectRow?.id).trim();
  return id ? `PRJ-${id.slice(0, 6)}` : "";
}

function pickChangeDisplayId(crRow: any): string {
  const pub = toText(crRow?.public_id).trim();
  if (pub) return pub;

  const seq = Number((crRow as any)?.seq);
  if (Number.isFinite(seq) && seq > 0) return `CR-${seq}`;

  const id = toText(crRow?.id).trim();
  return id ? `CR-${id.slice(0, 6)}` : "CR";
}

/**
 * GET /api/change-approvers?projectId=UUID&changeId=UUID
 */
export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const changeId = safeStr(url.searchParams.get("changeId")).trim();

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!changeId) return jsonErr("Missing changeId", 400);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);

    // ---- project meta (best effort) ----
    let projectDisplayId = `PRJ-${shortUuid(projectId)}`;

    try {
      // ✅ select ONLY columns that exist in your projects table
      const p = await supabase
        .from("projects")
        .select("id, project_code, title")
        .eq("id", projectId)
        .maybeSingle();

      if (p.error) {
        console.warn("[projects select error]", p.error);
      } else if (!p.data) {
        console.warn("[projects select returned no row - likely RLS]", { projectId });
      } else {
        projectDisplayId = pickProjectDisplayId(p.data) || projectDisplayId;
      }
    } catch (e) {
      console.warn("[projects select exception]", e);
    }

    // ---- change decision meta ----
    const { data: cr, error: crErr } = await supabase
      .from("change_requests")
      .select(
        `
        id,
        project_id,
        public_id,
        seq,
        title,

        delivery_status,
        status,

        decision_status,
        decision_by,
        decision_at,
        decision_role,
        decision_rationale,

        approver_id,
        approval_date
      `
      )
      .eq("id", changeId)
      .maybeSingle();

    if (crErr) throw new Error(crErr.message);
    if (!cr) return jsonErr("Change not found", 404);
    if (safeStr((cr as any).project_id) !== projectId) return jsonErr("Invalid project scope", 403);

    const changeDisplayId = pickChangeDisplayId(cr);

    const deliveryLane = toText((cr as any).delivery_status || (cr as any).status).trim().toLowerCase();
    const decisionStatus = toText((cr as any).decision_status).trim().toLowerCase() || "proposed";
    const decisionBy = toText((cr as any).decision_by || (cr as any).approver_id).trim() || null;
    const decisionAt = toText((cr as any).decision_at || (cr as any).approval_date).trim() || null;
    const decisionRole = toText((cr as any).decision_role).trim() || null;
    const decisionRationale = toText((cr as any).decision_rationale).trim() || null;

    // ---- approvers list (best effort) ----
    let approversRows: any[] = [];
    try {
      const a = await supabase
        .from("change_approvers")
        .select("id, project_id, user_id, role, is_active, profiles:user_id(full_name,name,email,avatar_url)")

        .eq("project_id", projectId)
        .eq("is_active", true);

      approversRows = a.error ? [] : ((a.data as any[]) ?? []);
    } catch {
      approversRows = [];
    }

    const mapped = approversRows.map((r: any) => {
      const uid = toText(r?.user_id).trim();
      const nm =
        toText(r?.profiles?.full_name).trim() ||
        toText(r?.profiles?.name).trim() ||
        toText(r?.profiles?.email).trim() ||
        "Approver";

      let state: "pending" | "approved" | "rejected" | "rework" | "n/a" = "pending";

      if (deliveryLane === "analysis" && (decisionStatus === "rejected" || decisionStatus === "rework")) {
        state = "rework";
      } else if (decisionStatus === "approved") {
        state = uid && decisionBy && uid === decisionBy ? "approved" : "pending";
      } else if (decisionStatus === "rejected") {
        state = uid && decisionBy && uid === decisionBy ? "rejected" : "pending";
      } else {
        state = "pending";
      }

      return {
        user_id: uid,
        name: nm,
        role: toText(r?.role).trim() || "approver",
        state,
      };
    });

    const decision = {
      decision_status: decisionStatus,
      decision_by: decisionBy,
      decision_at: decisionAt,
      decision_role: decisionRole,
      decision_rationale: decisionRationale,
      delivery_lane: deliveryLane,
    };

    return jsonOk({
      projectDisplayId, // ✅ should now become PRJ-100011
      changeDisplayId,
      changeTitle: toText((cr as any).title).trim() || null,
      decision,
      approvers: mapped,
    });
  } catch (e: any) {
    console.error("[GET /api/change-approvers]", e);
    return jsonErr(safeStr(e?.message) || "Failed", 500);
  }
}

