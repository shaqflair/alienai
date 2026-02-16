// src/app/api/approvals/resolve/route.ts
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

function num(x: any): number {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function inBand(amount: number, min: any, max: any) {
  const a = amount;
  const mn = num(min);
  const mx = max == null ? Number.POSITIVE_INFINITY : num(max);
  return a >= mn && a <= mx;
}

export async function POST(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({}));
    const organisationId = safeStr(body?.orgId).trim();
    const artifactType = safeStr(body?.artifactType).trim();
    const amount = num(body?.amount);

    if (!organisationId) return err("Missing orgId", 400);
    if (!artifactType) return err("Missing artifactType", 400);

    await requireOrgMember(supabase, organisationId, user.id);

    const { data: rules, error } = await supabase
      .from("artifact_approver_rules")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("artifact_type", artifactType)
      .eq("is_active", true)
      .order("step", { ascending: true })
      .order("min_amount", { ascending: true });

    if (error) throw new Error(error.message);

    const applicable = (rules ?? []).filter((r: any) => inBand(amount, r.min_amount, r.max_amount));

    // collect groupIds and direct userIds
    const groupIds = Array.from(new Set(applicable.map((r: any) => String(r.approval_group_id ?? "")).filter(Boolean)));
    const directUserIds = Array.from(new Set(applicable.map((r: any) => String(r.approver_user_id ?? "")).filter(Boolean)));

    // fetch group members
    let groupMembers: any[] = [];
    if (groupIds.length) {
      const gm = await supabase.from("approval_group_members").select("*").in("group_id", groupIds);
      if (gm.error) throw new Error(gm.error.message);
      groupMembers = (gm.data ?? []).filter((m: any) => ("is_active" in m ? m.is_active !== false : true));
    }

    const groupUserIds = Array.from(new Set(groupMembers.map((m: any) => String(m.user_id ?? "")).filter(Boolean)));
    const allUserIds = Array.from(new Set([...directUserIds, ...groupUserIds]));

    const profByUser = await loadProfilesByUserIds(supabase, allUserIds);

    // build steps
    const byStep = new Map<number, any[]>();
    for (const r of applicable) {
      const step = Number(r.step ?? 1);
      const arr = byStep.get(step) ?? [];
      arr.push(r);
      byStep.set(step, arr);
    }

    const steps = Array.from(byStep.keys())
      .sort((a, b) => a - b)
      .map((step) => {
        const stepRules = byStep.get(step) ?? [];

        // resolve people for this step
        const people: { user_id: string; full_name: string | null; email: string | null; source: string }[] = [];

        for (const r of stepRules) {
          const uid = String(r.approver_user_id ?? "").trim();
          const gid = String(r.approval_group_id ?? "").trim();

          if (uid) {
            const p = profByUser.get(uid);
            people.push({
              user_id: uid,
              full_name: safeStr(p?.full_name).trim() || null,
              email: safeStr(p?.email).trim() || null,
              source: "user",
            });
          } else if (gid) {
            const members = groupMembers.filter((m: any) => String(m.group_id) === gid);
            for (const m of members) {
              const mu = String(m.user_id ?? "").trim();
              if (!mu) continue;
              const p = profByUser.get(mu);
              people.push({
                user_id: mu,
                full_name: safeStr(p?.full_name).trim() || null,
                email: safeStr(p?.email).trim() || null,
                source: `group:${gid}`,
              });
            }
          }
        }

        // de-dupe user_id
        const seen = new Set<string>();
        const uniq = people.filter((x) => (seen.has(x.user_id) ? false : (seen.add(x.user_id), true)));

        return {
          step,
          rules: stepRules,
          approvers: uniq,
        };
      });

    return ok({ amount, organisationId, artifactType, steps });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized") ? 401 : msg.toLowerCase().includes("forbidden") ? 403 : 400;
    return err(msg, s);
  }
}
