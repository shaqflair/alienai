import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient as createAdminClient } from "@/lib/supabase/service";
import { runPremortem } from "@/lib/server/ai/premortem/runPremortem";

export const runtime   = "nodejs";
export const dynamic   = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function jsonErr(error: string, status = 400) {
  const res = NextResponse.json({ ok: false, error }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

async function getOrgId(admin: any, projectId: string): Promise<string | null> {
  const { data } = await admin.from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
  return safeStr((data as any)?.organisation_id).trim() || null;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonErr("Unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const projectId  = safeStr(body?.projectId).trim();
    const windowDays = Number(body?.windowDays) || 30;
    const persist    = body?.persist !== false;
    const skipNarrative = body?.skipNarrative === true;

    if (!projectId) return jsonErr("projectId required", 400);

    // Check project membership
    const { data: mem } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    // Also allow org members
    const admin = createAdminClient();
    const orgId = await getOrgId(admin, projectId);
    let hasAccess = !!mem;

    if (!hasAccess && orgId) {
      const { data: orgMem } = await supabase
        .from("organisation_members")
        .select("role")
        .eq("organisation_id", orgId)
        .eq("user_id", user.id)
        .is("removed_at", null)
        .maybeSingle();
      hasAccess = !!orgMem;
    }

    if (!hasAccess) return jsonErr("Forbidden", 403);
    if (!orgId) return jsonErr("Project has no organisation", 400);

    const result = await runPremortem(admin, {
      organisationId: orgId,
      projectId,
      windowDays,
      persist,
      skipNarrative,
    });

    return jsonOk(result);
  } catch (e: any) {
    console.error("[premortem/compute] error:", e);
    return jsonErr(safeStr(e?.message) || "Compute failed", 500);
  }
}

// Also allow GET for quick reads
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonErr("Unauthorized", 401);

    const url       = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    if (!projectId) return jsonErr("projectId required", 400);

    const { getLatestPremortemSnapshot, getPremortemHistory } = await import("@/lib/server/ai/premortem/premortemRepo");
    const admin = createAdminClient();

    const [snapshot, history] = await Promise.all([
      getLatestPremortemSnapshot(admin, projectId),
      getPremortemHistory(admin, projectId, 5),
    ]);

    if (!snapshot) return jsonOk({ snapshot: null, history: [], hasData: false });

    const trend = history.length > 1
      ? { previousScore: history[1]?.failure_risk_score ?? null, previousGeneratedAt: history[1]?.generated_at ?? null }
      : { previousScore: null, previousGeneratedAt: null };

    return jsonOk({ snapshot, history, trend, hasData: true });
  } catch (e: any) {
    console.error("[premortem/compute GET] error:", e);
    return jsonErr(safeStr(e?.message) || "Failed", 500);
  }
}
