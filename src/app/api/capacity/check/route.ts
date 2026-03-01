import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    person_id,
    project_id,
    start_date,
    end_date,
    days_per_week,
    organisation_id,
  } = body;

  if (!person_id || !project_id || !start_date || !end_date || !days_per_week) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // -- Capacity check (week-by-week preview) ---------------------------------
  const { data: weekRows, error: weekErr } = await supabase.rpc("check_capacity", {
    p_person_id:    person_id,
    p_project_id:   project_id,
    p_start_date:   start_date,
    p_end_date:     end_date,
    p_days_per_week: days_per_week,
  });

  if (weekErr) {
    console.error("[check_capacity]", weekErr);
    return NextResponse.json({ error: weekErr.message }, { status: 500 });
  }

  const weeks = (weekRows ?? []) as Array<{
    week_start:        string;
    existing_days:     number;
    proposed_days:     number;
    total_days:        number;
    capacity_days:     number;
    utilisation_pct:   number;
    has_conflict:      boolean;
    conflict_severity: string;
  }>;

  const hasConflicts = weeks.some(w => w.has_conflict);

  // -- Alternatives (only fetch if there are conflicts) ----------------------
  let alternatives: any[] = [];

  if (hasConflicts && organisation_id) {
    const { data: altRows, error: altErr } = await supabase.rpc(
      "get_available_alternatives",
      {
        p_organisation_id: organisation_id,
        p_start_date:      start_date,
        p_end_date:        end_date,
        p_days_needed:     days_per_week,
        p_exclude_person:  person_id,
      }
    );

    if (!altErr) {
      alternatives = altRows ?? [];
    }
  }

  return NextResponse.json({ weeks, alternatives });
}
