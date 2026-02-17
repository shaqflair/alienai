import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return err("Unauthorized", 401);

    const userId = auth.user.id;

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 12)));

    // ✅ Scope: projects user can access (prevents over-fetch when RLS is permissive)
    const { data: pmRows, error: pmErr } = await supabase
      .from("project_members")
      .select("project_id, role")
      .eq("user_id", userId)
      .is("removed_at", null);

    if (pmErr) throw new Error(pmErr.message);

    const projectIds = (pmRows ?? [])
      .map((r: any) => String(r?.project_id || ""))
      .filter(Boolean);

    const roleByProject = new Map<string, string>();
    for (const r of pmRows ?? []) {
      const pid = String((r as any)?.project_id || "");
      const role = safeStr((r as any)?.role).trim().toLowerCase();
      if (pid) roleByProject.set(pid, role || "viewer");
    }

    // If caller asks for a projectId, ensure user is a member
    if (projectId && !projectIds.includes(projectId)) {
      return err("Forbidden", 403);
    }

    // Pull approvals + join change_requests
    const q = supabase
      .from("change_approvals")
      .select(
        `
        id,
        change_id,
        project_id,
        approver_user_id,
        approval_role,
        status,
        created_at,
        decided_at,
        decision_comment,
        change:change_requests!change_approvals_change_fkey (
          id,
          title,
          status,
          decision_status,
          created_at,
          requester_name
        )
      `,
        { count: "exact" }
      )
      .eq("approver_user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (projectId) {
      q.eq("project_id", projectId);
    } else {
      // ✅ only approvals tied to projects user can access
      q.in("project_id", projectIds);
    }

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    const items = (rows ?? []).map((r: any) => {
      const pid = safeStr(r.project_id);
      const cid = safeStr(r.change_id);

      return {
        id: safeStr(r.id),
        project_id: pid,
        change_id: cid,

        approval_role: safeStr(r.approval_role) || "Approver",
        status: safeStr(r.status) || "pending",

        created_at: r.created_at ?? null,
        decided_at: r.decided_at ?? null,
        decision_comment: r.decision_comment ?? null,

        // embedded change
        change: r.change ?? null,

        // ✅ convenient nav (your HomePage viewHref can use this or keep its logic)
        href: pid && cid ? `/projects/${pid}/change/${cid}` : "",

        // ✅ member role context (useful for UI gating)
        myRole: roleByProject.get(pid) || "viewer",
      };
    });

    // ✅ Your HomeData type expects these (optional but helpful)
    const roleSet = new Set<string>();
    for (const r of roleByProject.values()) roleSet.add(r);

    return ok({
      count: Number(count ?? items.length),
      items,
      role: roleSet.has("owner") ? "owner" : roleSet.has("editor") ? "editor" : "viewer",
      isApprover: items.length > 0,
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized") ? 401 : msg.toLowerCase().includes("forbidden") ? 403 : 400;
    return err(msg, s);
  }
}
