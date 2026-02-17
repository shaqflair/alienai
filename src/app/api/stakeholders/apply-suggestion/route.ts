import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x ?? ""));
}

type MemberRole = "viewer" | "editor" | "admin" | "owner";
function normalizeRole(role: unknown): MemberRole {
  const r = String(role ?? "viewer").toLowerCase();
  if (r === "owner" || r === "admin" || r === "editor" || r === "viewer") return r;
  return "viewer";
}
function canWrite(role: MemberRole) {
  return role === "owner" || role === "admin" || role === "editor";
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  return createSbJsClient(url, key, { auth: { persistSession: false } });
}

function slugNameKey(name: string) {
  const s = String(name ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  return s || "stakeholder";
}

function normalizeInfluenceDb(x: unknown): "high" | "medium" | "low" {
  const s = String(x ?? "").toLowerCase();
  if (s === "high") return "high";
  if (s === "low") return "low";
  return "medium";
}

async function requireAuthAndMembership(projectId: string) {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Not found");

  return { supabase, userId: auth.user.id, role: normalizeRole((mem as any).role) };
}

/**
 * POST /api/stakeholders/apply-suggestion
 * Body: { projectId, artifactId, suggestionId }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    const artifactId = safeStr(body?.artifactId).trim();
    const suggestionId = safeStr(body?.suggestionId).trim();

    if (!projectId || !isUuid(projectId)) return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
    if (!artifactId || !isUuid(artifactId)) return NextResponse.json({ ok: false, error: "Invalid artifactId" }, { status: 400 });
    if (!suggestionId || !isUuid(suggestionId)) return NextResponse.json({ ok: false, error: "Invalid suggestionId" }, { status: 400 });

    const { supabase, userId, role } = await requireAuthAndMembership(projectId);
    if (!canWrite(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const sb = adminClient();

    // Load suggestion (admin)
    const { data: s, error: sErr } = await sb
      .from("ai_suggestions")
      .select("id, project_id, artifact_id, target_artifact_type, suggestion_type, status, patch")
      .eq("id", suggestionId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (sErr) throw new Error(sErr.message);
    if (!s) return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });

    if (String(s.artifact_id ?? "") !== artifactId) {
      return NextResponse.json({ ok: false, error: "Suggestion does not match artifact" }, { status: 400 });
    }

    if (safeLower(s.target_artifact_type) !== "stakeholder_register") {
      return NextResponse.json({ ok: false, error: "Not a stakeholder suggestion" }, { status: 400 });
    }

    const patch = s.patch ?? null;
    const kind = safeLower(patch?.kind);
    if (kind !== "add_rows" || !Array.isArray(patch?.rows)) {
      return NextResponse.json({ ok: false, error: "Suggestion has no add_rows patch" }, { status: 400 });
    }

    const rows: any[] = patch.rows;

    const upserts = rows
      .map((r) => (Array.isArray(r) ? r : null))
      .filter(Boolean)
      .map((cells: any[]) => {
        const c0 = String(cells?.[0] ?? "").trim(); // usually "TBC"
        const c1 = String(cells?.[1] ?? "").trim(); // role/title
        const c2 = String(cells?.[2] ?? "").trim(); // influence
        const c3 = String(cells?.[3] ?? "").trim(); // expectations/notes

        const roleName = c1 || "Stakeholder";
        const displayName = c0 && safeLower(c0) !== "tbc" ? c0 : `${roleName} (TBC)`;

        return {
          project_id: projectId,
          artifact_id: artifactId,
          name: displayName,
          role: roleName,
          influence_level: normalizeInfluenceDb(c2),
          expectations: c3 || null,
          communication_strategy: null,
          contact_info: {},
          name_key: slugNameKey(displayName),
        };
      });

    if (upserts.length === 0) return NextResponse.json({ ok: true, applied: 0 }, { status: 200 });

    // Apply rows (cookie client, respects RLS)
    const { data: appliedRows, error: upErr } = await supabase
      .from("stakeholders")
      .upsert(upserts as any[], { onConflict: "project_id,artifact_id,name_key" })
      .select("id, name, name_key");

    if (upErr) throw new Error(upErr.message);

    // Mark suggestion as applied (admin)
    const { error: updErr } = await sb
      .from("ai_suggestions")
      .update({
        status: "applied",
        actioned_by: userId,
        decided_at: new Date().toISOString(),
        rejected_at: null,
      })
      .eq("id", suggestionId)
      .eq("project_id", projectId);

    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ ok: true, applied: (appliedRows ?? []).length, rows: appliedRows ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

