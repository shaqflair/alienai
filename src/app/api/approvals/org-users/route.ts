// src/app/api/approvals/org-users/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { sb, requireAuth, requireOrgMember, safeStr, loadProfilesByUserIds } from "@/lib/approvals/admin-helpers";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const orgId = safeStr(url.searchParams.get("orgId")).trim();
    const q = safeStr(url.searchParams.get("q")).trim().toLowerCase();
    const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") || 25)));

    if (!orgId) return err("Missing orgId", 400);

    // any org member can search users
    await requireOrgMember(supabase, orgId, user.id);

    // Get org members (admins + members)
    const { data: members, error: memErr } = await supabase
      .from("organisation_members")
      .select("user_id, role")
      .eq("organisation_id", orgId);

    if (memErr) throw new Error(memErr.message);

    const userIds = (members ?? []).map((m: any) => String(m.user_id ?? "")).filter(Boolean);
    const profByUser = await loadProfilesByUserIds(supabase, userIds);

    const items = userIds
      .map((uid) => {
        const p = profByUser.get(uid);
        const full_name = safeStr(p?.full_name).trim();
        const email = safeStr(p?.email).trim();
        const label = full_name || email || uid;
        return { user_id: uid, full_name: full_name || null, email: email || null, label };
      })
      .filter((x) => {
        if (!q) return true;
        const hay = `${x.label} ${x.email ?? ""} ${x.user_id}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
      .slice(0, limit);

    return ok({ users: items });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const lower = msg.toLowerCase();
    const status = lower.includes("unauthorized") ? 401 : lower.includes("forbidden") ? 403 : 400;
    return err(msg, status);
  }
}
