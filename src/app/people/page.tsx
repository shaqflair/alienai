// FILE: src/app/people/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import PeopleClient from "./_components/PeopleClient";
import type { PersonRow, RateCard } from "./_components/PeopleClient";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export const metadata = { title: "People | ResForce" };

export default async function PeoplePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/people");

  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : null;
  if (!organisationId) redirect("/projects?err=missing_org");

  // ── Check caller role ──────────────────────────────────────────────────────
  const { data: myMem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const isAdmin = safeStr(myMem?.role).toLowerCase() === "admin";

  // ── Fetch org members + profiles + rate cards in parallel ─────────────────
  const [memberRes, rateCardRes, allocRes] = await Promise.all([
    supabase
      .from("organisation_members")
      .select(`
        user_id, role,
        profiles:profiles!organisation_members_user_id_fkey (
          user_id, full_name, job_title, department,
          employment_type, default_capacity_days,
          is_active, available_from, rate_card_id,
          rate_cards:rate_cards!profiles_rate_card_id_fkey (
            id, label, rate_per_day, currency
          )
        )
      `)
      .eq("organisation_id", organisationId!)
      .is("removed_at", null),

    supabase
      .from("rate_cards")
      .select("id, label, rate_per_day, currency, notes, is_active")
      .eq("organisation_id", organisationId!)
      .order("label", { ascending: true }),

    // Recent allocations for utilisation calc (last 8 weeks)
    supabase
      .from("allocations")
      .select("person_id, project_id, days_allocated, week_start_date")
      .gte("week_start_date", (() => {
        const d = new Date();
        d.setDate(d.getDate() - 56);
        return d.toISOString().split("T")[0];
      })())
      .lte("week_start_date", new Date().toISOString().split("T")[0]),
  ]);

  // ── Build rate cards list ─────────────────────────────────────────────────
  const rateCards: RateCard[] = (rateCardRes.data ?? []).map((r: any) => ({
    id:         String(r.id),
    label:      safeStr(r.label),
    ratePerDay: parseFloat(String(r.rate_per_day)),
    currency:   safeStr(r.currency || "GBP"),
    notes:      r.notes ? safeStr(r.notes) : null,
    isActive:   r.is_active !== false,
  }));

  // ── Build utilisation map from recent allocations ─────────────────────────
  // personId → { totalDays, projectIds, weeklyUtils }
  const utilMap = new Map<string, { totalDays: number; projectIds: Set<string>; utils: number[] }>();
  for (const a of allocRes.data ?? []) {
    const pid  = String(a.person_id);
    const days = parseFloat(String(a.days_allocated));
    if (!utilMap.has(pid)) utilMap.set(pid, { totalDays: 0, projectIds: new Set(), utils: [] });
    const entry = utilMap.get(pid)!;
    entry.totalDays += days;
    entry.projectIds.add(String(a.project_id));
  }

  // ── Build PersonRow[] ─────────────────────────────────────────────────────
  const people: PersonRow[] = (memberRes.data ?? [])
    .map((m: any) => {
      const p = m.profiles;
      if (!p) return null;

      const pid      = String(p.user_id || m.user_id);
      const utilData = utilMap.get(pid);
      const cap      = parseFloat(String(p.default_capacity_days ?? 5));

      // Avg util over 8 weeks
      const avgUtil = utilData
        ? Math.min(Math.round((utilData.totalDays / (cap * 8)) * 100), 200)
        : 0;

      const rc = (p.rate_cards as any);

      return {
        personId:            pid,
        fullName:            safeStr(p.full_name || "Unknown"),
        jobTitle:            p.job_title   ? safeStr(p.job_title)   : null,
        department:          p.department  ? safeStr(p.department)  : null,
        employmentType:      safeStr(p.employment_type || "full_time"),
        defaultCapacityDays: cap,
        isActive:            p.is_active !== false,
        availableFrom:       p.available_from ? safeStr(p.available_from) : null,
        rateCardId:          p.rate_card_id   ? safeStr(p.rate_card_id)   : null,
        rateCardLabel:       rc?.label        ? safeStr(rc.label)          : null,
        ratePerDay:          rc?.rate_per_day ? parseFloat(String(rc.rate_per_day)) : null,
        avgUtilisationPct:   avgUtil,
        totalAllocatedDays:  utilData ? Math.round(utilData.totalDays * 10) / 10 : 0,
        activeProjectCount:  utilData ? utilData.projectIds.size : 0,
      } satisfies PersonRow;
    })
    .filter(Boolean) as PersonRow[];

  // Sort: active first, then by name
  people.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.fullName.localeCompare(b.fullName);
  });

  return (
    <PeopleClient
      people={people}
      rateCards={rateCards}
      organisationId={organisationId!}
      isAdmin={isAdmin}
    />
  );
}