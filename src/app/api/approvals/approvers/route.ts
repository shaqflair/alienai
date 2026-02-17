import "server-only";
import { NextResponse } from "next/server";
import {
  sb,
  requireAuth,
  requireOrgAdmin,
  requireOrgMember,
  safeStr,
} from "@/lib/approvals/admin-helpers";

export const runtime = "nodejs";

/* ───────────────────────────────────────────── */

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function normEmail(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

/* ───────────────────────────────────────────── */
/* GET: list approvers */
/* ───────────────────────────────────────────── */

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const organisationId = safeStr(url.searchParams.get("orgId")).trim();
    const q = safeStr(url.searchParams.get("q")).trim().toLowerCase();

    if (!organisationId) return err("Missing orgId", 400);

    await requireOrgMember(supabase, organisationId, user.id);

    const { data: rows, error } = await supabase
      .from("organisation_approvers")
      .select(
        "id, organisation_id, email, name, approver_role, department, user_id, is_active, created_at"
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const items = (rows ?? [])
      .map((r: any) => {
        const email = safeStr(r.email).trim();
        const name = safeStr(r.name).trim();
        const role = safeStr(r.approver_role).trim();
        const dept = safeStr(r.department).trim();
        const label = email || name || safeStr(r.id);

        return {
          id: safeStr(r.id),
          organisation_id: safeStr(r.organisation_id),
          user_id: safeStr(r.user_id) || null,
          is_active: r.is_active ?? true,
          created_at: r.created_at ?? null,
          email: email || null,
          name: name || null,
          approver_role: role || null,
          department: dept || null,
          label,
        };
      })
      .filter((x: any) => {
        if (!q) return true;
        const hay = `${x.email ?? ""} ${x.name ?? ""} ${x.department ?? ""} ${x.approver_role ?? ""} ${x.label ?? ""}`.toLowerCase();
        return hay.includes(q);
      });

    return ok({ approvers: items });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return err(msg, s);
  }
}

/* ───────────────────────────────────────────── */
/* POST: add/update approver */
/* ───────────────────────────────────────────── */

export async function POST(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({}));

    const organisationId = safeStr(body?.orgId).trim();
    const email = normEmail(body?.email);
    const name = safeStr(body?.name).trim();
    const approverRole = safeStr(body?.approver_role).trim();
    const department = safeStr(body?.department).trim();

    if (!organisationId) return err("Missing orgId", 400);
    if (!email) return err("Missing email", 400);

    await requireOrgAdmin(supabase, organisationId, user.id);

    const { data, error } = await supabase
      .from("organisation_approvers")
      .upsert(
        {
          organisation_id: organisationId,
          email,
          name: name || null,
          approver_role: approverRole || null,
          department: department || null,
          is_active: true,
          created_by: user.id,
        },
        { onConflict: "organisation_id,email" }
      )
      .select(
        "id, organisation_id, email, name, approver_role, department, user_id, is_active, created_at"
      )
      .single();

    if (error) throw new Error(error.message);

    return ok({ approver: data }, 201);
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return err(msg, s);
  }
}

/* ───────────────────────────────────────────── */
/* DELETE: remove approver */
/* ───────────────────────────────────────────── */

export async function DELETE(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);

    const organisationId = safeStr(url.searchParams.get("orgId")).trim();
    const approverId = safeStr(url.searchParams.get("id")).trim();

    // ✅ FIX: null-safe email parsing (build error fix)
    const email = normEmail(safeStr(url.searchParams.get("email")));

    if (!organisationId) return err("Missing orgId", 400);
    if (!approverId && !email) return err("Missing id or email", 400);

    await requireOrgAdmin(supabase, organisationId, user.id);

    const q = supabase
      .from("organisation_approvers")
      .delete()
      .eq("organisation_id", organisationId);

    const { error } = approverId
      ? await q.eq("id", approverId)
      : await q.eq("email", email);

    if (error) throw new Error(error.message);

    return ok({ removed: true });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return err(msg, s);
  }
}
