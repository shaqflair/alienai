import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import CapacityClient from "./_components/CapacityClient";
import type { ExceptionRow, PersonOption } from "./_components/CapacityClient";

export const metadata = { title: "Leave & Capacity | ResForce" };

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function defaultDateFrom() {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

function defaultDateTo(from: string) {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().split("T")[0];
}

export default async function CapacityPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string; dept?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/capacity");

  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : null;
  if (!organisationId) redirect("/projects?err=missing_org");

  const sp         = (await searchParams) ?? {};
  const dateFrom   = safeStr(sp?.from) || defaultDateFrom();
  const dateTo     = safeStr(sp?.to)   || defaultDateTo(dateFrom);

  // ── Check caller role ────────────────────────────────────────────────────
  const { data: myMem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const isAdmin = safeStr(myMem?.role).toLowerCase() === "admin";

  // ── Fetch people + capacity_exceptions in parallel ────────────────────────
  const [memberRes, exceptionsRes] = await Promise.all([
    supabase
      .from("organisation_members")
      .select(`
        user_id,
        profiles:profiles!organisation_members_user_id_fkey (
          user_id, full_name, department, is_active, default_capacity_days
        )
      `)
      .eq("organisation_id", organisationId)
      .is("removed_at", null),

    supabase
      .from("capacity_exceptions")
      .select(`
        id, person_id, week_start_date,
        available_days, reason, notes,
        profiles:profiles!capacity_exceptions_person_id_fkey (
          full_name, default_capacity_days
        )
      `)
      .gte("week_start_date", dateFrom)
      .lte("week_start_date", dateTo)
      .order("week_start_date", { ascending: true }),
  ]);

  // ── Build people list ─────────────────────────────────────────────────────
  const people: PersonOption[] = (memberRes.data ?? [])
    .map((m: any) => {
      const p = m.profiles;
      if (!p || p.is_active === false) return null;
      return {
        id:         String(p.user_id || m.user_id),
        fullName:   safeStr(p.full_name || "Unknown"),
        department: p.department ? safeStr(p.department) : null,
        defaultCap: parseFloat(String(p.default_capacity_days ?? 5)),
      } satisfies PersonOption;
    })
    .filter(Boolean) as PersonOption[];

  people.sort((a, b) => a.fullName.localeCompare(b.fullName));

  // ── Build exceptions list ─────────────────────────────────────────────────
  const exceptions: ExceptionRow[] = (exceptionsRes.data ?? [])
    .map((e: any) => {
      const profile = e.profiles;
      return {
        id:            String(e.id),
        personId:      String(e.person_id),
        fullName:      safeStr(profile?.full_name || "Unknown"),
        weekStartDate: safeStr(e.week_start_date),
        available_days: parseFloat(String(e.available_days)),
        reason:        safeStr(e.reason || "annual_leave"),
        notes:         e.notes ? safeStr(e.notes) : null,
        defaultCap:    parseFloat(String(profile?.default_capacity_days ?? 5)),
      } satisfies ExceptionRow;
    });

  return (
    <CapacityClient
      exceptions={exceptions}
      people={people}
      organisationId={organisationId}
      currentUserId={user.id}
      isAdmin={isAdmin}
      dateFrom={dateFrom}
      dateTo={dateTo}
    />
  );
}
