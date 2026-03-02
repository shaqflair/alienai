import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    // Get organisation
    const { data: memRow } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", user.id)
      .is("removed_at", null)
      .limit(1)
      .maybeSingle();
      
    const orgId = memRow?.organisation_id;
    if (!orgId) return NextResponse.json({ ok: false, error: "No org" }, { status: 400 });

    const days = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") ?? "7", 10)));
    const limit = Math.min(20, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "8", 10)));

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    const sinceIso = since.toISOString().slice(0, 10);
    const todayIso = new Date().toISOString().slice(0, 10);

    // ── Milestones where date is within the last N days ──────────────────
    // Join to projects to get code + title + organisation check
    const { data: milestones, error } = await supabase
      .from("project_milestones")
      .select(`
        id,
        label,
        date,
        type,
        project_id,
        projects!project_milestones_project_id_fkey (
          id,
          title,
          project_code,
          colour,
          organisation_id
        )
      `)
      .gte("date", sinceIso)
      .lte("date", todayIso)
      .order("date", { ascending: false })
      .limit(limit * 3); // fetch extra to filter by org

    if (error) {
      // Fallback: try without join if FK hint fails
      const { data: rawMs } = await supabase
        .from("project_milestones")
        .select("id, label, date, type, project_id")
        .gte("date", sinceIso)
        .lte("date", todayIso)
        .order("date", { ascending: false })
        .limit(limit);

      const wins = (rawMs ?? []).map((m: any) => ({
        id:           String(m.id),
        title:        String(m.label || "Milestone"),
        date:         String(m.date),
        type:         String(m.type || "other"),
        project_id:   String(m.project_id),
        project_code: null,
        project_name: null,
        project_colour: "#00b8db",
        link:         null,
      }));

      return NextResponse.json({ ok: true, wins, days, count: wins.length });
    }

    // Filter to this org and shape the response
    const wins = (milestones ?? [])
      .filter((m: any) => {
        const proj = m.projects as any;
        return proj && String(proj.organisation_id) === String(orgId);
      })
      .slice(0, limit)
      .map((m: any) => {
        const proj = m.projects as any;
        const code = proj?.project_code ? String(proj.project_code) : null;
        const ref  = code || String(proj?.id || m.project_id);
        return {
          id:             String(m.id),
          title:          String(m.label || "Milestone"),
          date:           String(m.date),
          type:           String(m.type || "other"),
          project_id:     String(m.project_id),
          project_code:   code,
          project_name:   proj?.title ? String(proj.title) : null,
          project_colour: proj?.colour ? String(proj.colour) : "#00b8db",
          link:           ref ? `/projects/${encodeURIComponent(ref)}` : null,
        };
      });

    return NextResponse.json({ ok: true, wins, days, count: wins.length });
  } catch (e: any) {
    console.error("[recent-wins]", e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
