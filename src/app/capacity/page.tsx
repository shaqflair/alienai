// FILE: src/app/capacity/page.tsx
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

  // -- Check caller role ----------------------------------------------------
  const { data: myMem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const isAdmin = safeStr(myMem?.role).toLowerCase() === "admin";

  // -- Fetch people (two-step to avoid FK hint issues) ------------------------
  const { data: memberUserRows } = await supabase
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", organisationId)
    .is("removed_at", null);

  const memberUserIds = (memberUserRows ?? []).map((r: any) => String(r.user_id)).filter(Boolean);

  const [profileRes, exceptionsRes] = await Promise.all([
    memberUserIds.length > 0
      ? supabase
          .from("profiles")
          .select("user_id, full_name, department, is_active, default_capacity_days")
          .in("user_id", memberUserIds)
      : Promise.resolve({ data: [] as any[] }),

    supabase
      .from("capacity_exceptions")
      .select("id, person_id, week_start_date, available_days, reason, notes")
      .gte("week_start_date", dateFrom)
      .lte("week_start_date", dateTo)
      .order("week_start_date", { ascending: true }),
  ]);

  // Build a profile lookup map for exceptions
  const profileMap = new Map<string, any>(
    (profileRes.data ?? []).map((p: any) => [String(p.user_id), p])
  );

  // -- Build people list -----------------------------------------------------
  const people: PersonOption[] = (profileRes.data ?? [])
    .map((p: any) => {
      if (!p || p.is_active === false) return null;
      return {
        id:         String(p.user_id),
        fullName:   safeStr(p.full_name || "Unknown"),
        department: p.department ? safeStr(p.department) : null,
        defaultCap: parseFloat(String(p.default_capacity_days ?? 5)),
      } satisfies PersonOption;
    })
    .filter(Boolean) as PersonOption[];

  people.sort((a, b) => a.fullName.localeCompare(b.fullName));

  // -- Build exceptions list -------------------------------------------------
  const exceptions: ExceptionRow[] = (exceptionsRes.data ?? [])
    .map((e: any) => {
      const profile = profileMap.get(String(e.person_id));
      return {
        id:            String(e.id),
        personId:      String(e.person_id),
        fullName:      safeStr(profile?.full_name || "Unknown"),
        weekStartDate: safeStr(e.week_start_date),
        availableDays: parseFloat(String(e.available_days)),
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