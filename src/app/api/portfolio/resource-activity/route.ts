import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    // Get organisation context
    const { data: memRow } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", user.id)
      .is("removed_at", null)
      .limit(1)
      .maybeSingle();

    const orgId = memRow?.organisation_id;
    if (!orgId) return NextResponse.json({ ok: false, error: "No org" }, { status: 400 });

    // Range logic: default to 30 days, capped at 90
    const days = Math.min(90, Math.max(7, parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10)));

    const today = new Date();
    const startMonday = getMondayOf(addDays(today, -(days - 1)));
    const endMonday   = getMondayOf(today);

    const weeks: string[] = [];
    let cur = new Date(startMonday);
    while (isoDate(cur) <= isoDate(endMonday) && weeks.length < 20) {
      weeks.push(isoDate(cur));
      cur = addDays(cur, 7);
    }

    const dateFrom = weeks[0];
    const dateTo   = weeks[weeks.length - 1];

    // 1. Fetch active org members
    const { data: members } = await supabase
      .from("organisation_members")
      .select("user_id")
      .eq("organisation_id", orgId)
      .is("removed_at", null);

    const memberUserIds = (members ?? []).map((m: any) => String(m.user_id));
    if (memberUserIds.length === 0) {
      return NextResponse.json({ ok: true, weeks: [], dateFrom, dateTo });
    }

    // 2. Fetch profiles for default capacity (e.g., 5 days/week)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, default_capacity_days, is_active")
      .in("user_id", memberUserIds);

    const activePeopleProfiles = (profiles ?? []).filter((p: any) => p.is_active !== false);
    const defaultCapMap = new Map<string, number>();
    for (const p of activePeopleProfiles) {
      defaultCapMap.set(String(p.user_id), parseFloat(String(p.default_capacity_days ?? 5)));
    }

    // 3. Fetch capacity exceptions (e.g., leave or temporary increases)
    const { data: exceptions } = await supabase
      .from("capacity_exceptions")
      .select("person_id, week_start_date, available_days")
      .in("person_id", memberUserIds)
      .gte("week_start_date", dateFrom)
      .lte("week_start_date", dateTo);

    const exMap = new Map<string, Map<string, number>>();
    for (const ex of exceptions ?? []) {
      const pid = String(ex.person_id);
      if (!exMap.has(pid)) exMap.set(pid, new Map());
      exMap.get(pid)!.set(String(ex.week_start_date), parseFloat(String(ex.available_days)));
    }

    // 4. Fetch Allocations (Confirmed vs Soft)
    const { data: allocs } = await supabase
      .from("allocations")
      .select("person_id, week_start_date, days_allocated, allocation_type")
      .in("person_id", memberUserIds)
      .gte("week_start_date", dateFrom)
      .lte("week_start_date", dateTo);

    const weekAllocMap = new Map<string, { confirmed: number; soft: number }>();
    for (const w of weeks) weekAllocMap.set(w, { confirmed: 0, soft: 0 });

    for (const a of allocs ?? []) {
      const w = String(a.week_start_date);
      if (!weekAllocMap.has(w)) continue;
      const amount = parseFloat(String(a.days_allocated ?? 0));
      const type   = String(a.allocation_type ?? "confirmed").toLowerCase();
      const entry  = weekAllocMap.get(w)!;
      if (type === "soft" || type === "pipeline") {
        entry.soft += amount;
      } else {
        entry.confirmed += amount;
      }
    }

    // 5. Aggregate totals per week
    const result = weeks.map(w => {
      let totalCap = 0;
      for (const [pid, baseCap] of defaultCapMap) {
        const override = exMap.get(pid)?.get(w);
        totalCap += override !== undefined ? override : baseCap;
      }

      const { confirmed, soft } = weekAllocMap.get(w) ?? { confirmed: 0, soft: 0 };
      const utilisationPct = totalCap > 0 ? Math.round((confirmed / totalCap) * 100) : 0;

      return {
        weekLabel: w, // Used by chart component
        capacity:  Math.round(totalCap * 10) / 10,
        allocated: Math.round(confirmed * 10) / 10,
        pipeline:  Math.round(soft * 10) / 10,
        utilisationPct,
      };
    });

    return NextResponse.json({ ok: true, weeks: result, dateFrom, dateTo });
  } catch (e: any) {
    console.error("[resource-activity]", e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
