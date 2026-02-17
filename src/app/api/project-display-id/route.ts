import "server-only";
import { NextResponse } from "next/server";
import { sb, requireUser, requireProjectRole, safeStr } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

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

function normalizeProjectDisplayId(raw: string): string {
  const v = toText(raw).trim();
  if (!v) return "";
  if (/^prj[-\s]/i.test(v)) return v.replace(/\s+/g, "-").replace(/^prj/i, "PRJ");
  const stripped = v.replace(/^id\s*:\s*/i, "").trim();
  if (!stripped) return "";
  return `PRJ-${stripped}`;
}

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    if (!projectId) return jsonErr("Missing projectId", 400);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);

    const { data: p, error } = await supabase
      .from("projects")
      .select("id, project_code, project_number, project_no, code, public_id, external_id")
      .eq("id", projectId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!p) return jsonErr("Project not found", 404);

    const candidates = [
      toText((p as any).project_number),
      toText((p as any).project_no),
      toText((p as any).external_id),
      toText((p as any).public_id),
      toText((p as any).code),
      toText((p as any).project_code),
    ]
      .map((s) => s.trim())
      .filter(Boolean);

    const picked = candidates[0] ? normalizeProjectDisplayId(candidates[0]) : "";
    return jsonOk({ projectDisplayId: picked });
  } catch (e: any) {
    return jsonErr(safeStr(e?.message) || "Failed", 500);
  }
}
