import "server-only";


        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/* ---------------- utils ---------------- */

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

/**
 * Normalize incoming project identifier:
 * - decodeURIComponent
 * - trim
 * - allow "P-100011" -> "100011"
 */
function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    // ignore
  }
  v = v.trim();
  if (/^p-\s*/i.test(v)) v = v.replace(/^p-\s*/i, "").trim();
  return v;
}

/**
 * Resolve a project identifier (UUID or project_code) -> UUID
 */
async function resolveProjectUuid(supabase: any, identifier: string): Promise<string | null> {
  const id = normalizeProjectIdentifier(identifier);
  if (!id) return null;

  if (looksLikeUuid(id)) return id;

  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("project_code", id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const uuid = safeStr(data?.id).trim();
  return uuid || null;
}

async function requireAuthAndMembership(supabase: any, projectUuid: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active, removed_at")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem || mem.is_active === false || (mem as any).removed_at != null) throw new Error("Forbidden");

  return { userId: auth.user.id, role: String((mem as any).role ?? "viewer") };
}

function parseBool(v: string | null): boolean | null {
  if (v == null) return null;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return null;
}

/**
 * Map common incoming types to your canon artifact types.
 * (So type=wbs matches rows that store "WBS".)
 */
function canonArtifactType(typeParam: string) {
  const t = safeStr(typeParam).trim().toLowerCase();

  if (!t) return "";

  if (t === "wbs" || t === "work_breakdown_structure" || t === "work breakdown structure") return "WBS";
  if (t === "schedule" || t === "roadmap" || t === "gantt" || t === "schedule_roadmap") return "SCHEDULE";
  if (t === "raid" || t === "raid_log" || t === "raid log" || t === "raid_register") return "RAID";

  if (t === "project_charter" || t === "project charter" || t === "charter" || t === "pid") return "PROJECT_CHARTER";
  if (t === "stakeholder_register" || t === "stakeholder register" || t === "stakeholders") return "STAKEHOLDER_REGISTER";
  if (t === "change_requests" || t === "change requests" || t === "change_request" || t === "change request") return "CHANGE_REQUESTS";
  if (t === "lessons_learned" || t === "lessons learned" || t === "lessons") return "LESSONS_LEARNED";
  if (t === "project_closure_report" || t === "project closure report" || t === "closure report") return "PROJECT_CLOSURE_REPORT";

  // If caller already sends canon, preserve it
  return t.toUpperCase().replace(/\s+/g, "_");
}

/* ---------------- handler ---------------- */

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;

    const projectIdentifier = normalizeProjectIdentifier(safeParam(id));
    if (!projectIdentifier || projectIdentifier === "undefined") {
      return NextResponse.json({ ok: false, error: "Missing project id" }, { status: 400 });
    }

    const supabase = await createClient();

    // âœ… Resolve UUID from UUID OR project_code OR P-XXXX
    const projectUuid = await resolveProjectUuid(supabase, projectIdentifier);
    if (!projectUuid) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }

    await requireAuthAndMembership(supabase, projectUuid);

    // Query params (defaults: type=wbs, is_current=true)
    const url = new URL(req.url);
    const typeParamRaw = safeParam(url.searchParams.get("type"));
    const currentParam = parseBool(url.searchParams.get("is_current"));

    const typeCanon = canonArtifactType(typeParamRaw || "wbs");
    const isCurrent = currentParam ?? true;

    // âœ… Type matching: try canon + raw variants so you don't get empty results due to casing
    const typeCandidates = Array.from(
      new Set(
        [typeCanon, safeStr(typeParamRaw).trim(), safeStr(typeParamRaw).trim().toUpperCase(), safeStr(typeParamRaw).trim().toLowerCase()]
          .map((x) => safeStr(x).trim())
          .filter(Boolean)
      )
    );

    let q = supabase
      .from("artifacts")
      .select("id, project_id, title, type, is_current, status, created_at, updated_at")
      .eq("project_id", projectUuid)
      .eq("is_current", isCurrent)
      .order("updated_at", { ascending: false });

    if (typeCandidates.length === 1) {
      q = q.eq("type", typeCandidates[0]);
    } else {
      q = q.in("type", typeCandidates);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,

      // echoes
      projectIdentifier, // could be human id
      projectId: projectUuid, // UUID (what the DB uses)

      filters: { type: typeCanon, is_current: isCurrent, typeCandidates },

      artifacts: data ?? [],
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "Unknown error");
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

