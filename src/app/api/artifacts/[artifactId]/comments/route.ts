import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId } = await params;
    const projectId = safeStr(req.nextUrl.searchParams.get("projectId")).trim();
    if (!artifactId || !projectId) {
      return NextResponse.json(
        { ok: false, error: "Missing artifactId or projectId" },
        { status: 400 }
      );
    }

    // Membership gate
    const { data: membership } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
    }

    const { data: rows, error } = await supabase
      .from("approval_comments")
      .select("id, project_id, artifact_id, chain_id, step_id, author_user_id, comment_type, body, is_private, created_at")
      .eq("artifact_id", artifactId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const comments = rows ?? [];
    const authorIds = Array.from(
      new Set(comments.map((r: any) => safeStr(r?.author_user_id).trim()).filter(Boolean))
    );

    const nameMap: Record<string, string> = {};
    if (authorIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, display_name, name, email")
        .or(authorIds.map((id) => `id.eq.${id},user_id.eq.${id}`).join(","));

      for (const p of profiles ?? []) {
        const id1 = safeStr((p as any)?.id).trim();
        const id2 = safeStr((p as any)?.user_id).trim();
        const nm =
          safeStr((p as any)?.full_name).trim() ||
          safeStr((p as any)?.display_name).trim() ||
          safeStr((p as any)?.name).trim() ||
          safeStr((p as any)?.email).trim() ||
          "Unknown";

        if (id1) nameMap[id1] = nm;
        if (id2) nameMap[id2] = nm;
      }
    }

    return NextResponse.json({
      ok: true,
      comments: comments.map((r: any) => ({
        id: safeStr(r?.id),
        project_id: safeStr(r?.project_id),
        artifact_id: safeStr(r?.artifact_id),
        chain_id: safeStr(r?.chain_id) || null,
        step_id: safeStr(r?.step_id) || null,
        author_user_id: safeStr(r?.author_user_id),
        author_name: nameMap[safeStr(r?.author_user_id)] ?? null,
        comment_type: safeStr(r?.comment_type),
        body: safeStr(r?.body),
        is_private: Boolean(r?.is_private),
        created_at: safeStr(r?.created_at),
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
