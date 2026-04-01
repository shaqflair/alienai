import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

function safeStr(x: unknown): string { return typeof x === "string" ? x : ""; }
function bad(msg: string, s = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status: s });
}

function toCSV(rows: string[][]): string {
  return rows.map(r =>
    r.map(cell => {
      const s = String(cell ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(",")
  ).join("\n");
}

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return bad("Not authenticated", 401);

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) return bad("No active organisation", 400);

  const url    = new URL(req.url);
  const fmt    = safeStr(url.searchParams.get("format")).toLowerCase() || "csv";
  const from   = safeStr(url.searchParams.get("from"))  || "";
  const to     = safeStr(url.searchParams.get("to"))    || "";
  const userId = safeStr(url.searchParams.get("user_id")) || null;

  // Admin check for viewing other users
  let targetUserId = user.id;
  if (userId && userId !== user.id) {
    const { data: mem } = await sb
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", String(orgId))
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();
    const role = safeStr(mem?.role).toLowerCase();
    if (role !== "admin" && role !== "owner") return bad("Admin access required for exporting other users", 403);
    targetUserId = userId;
  }

  // Fetch timesheets + entries
  let tsQuery = sb
    .from("timesheets")
    .select(`
      id, week_start_date, status, submitted_at, reviewed_at, reviewer_note,
      weekly_timesheet_entries (
        id, work_date, hours, description,
        projects:projects!weekly_timesheet_entries_project_id_fkey(title, project_code)
      )
    `)
    .eq("organisation_id", String(orgId))
    .eq("user_id", targetUserId)
    .order("week_start_date", { ascending: true });

  if (from) tsQuery = tsQuery.gte("week_start_date", from);
  if (to)   tsQuery = tsQuery.lte("week_start_date", to);

  const { data: timesheets, error } = await tsQuery;
  if (error) return bad(error.message, 500);

  // Fetch user profile
  const { data: profile } = await sb
    .from("profiles")
    .select("full_name, email")
    .eq("user_id", targetUserId)
    .maybeSingle();

  const userName = safeStr(profile?.full_name || profile?.email || targetUserId);

  // Build flat rows
  const header = ["Person", "Week Starting", "Date", "Project", "Project Code", "Hours", "Description", "Status"];
  const rows: string[][] = [header];

  for (const ts of timesheets ?? []) {
    const entries = (ts as any).timesheet_entries ?? [];
    if (entries.length === 0) {
      rows.push([
        userName,
        ts.week_start_date,
        "",
        "",
        "",
        "0",
        "",
        ts.status,
      ]);
      continue;
    }
    for (const e of entries) {
      rows.push([
        userName,
        ts.week_start_date,
        e.work_date,
        safeStr(e.projects?.title),
        safeStr(e.projects?.project_code),
        String(e.hours ?? 0),
        safeStr(e.description),
        ts.status,
      ]);
    }
  }

  const csvContent = toCSV(rows);
  const fileName   = `timesheets_${userName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0,10)}.csv`;

  return new Response(csvContent, {
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control":       "no-store",
    },
  });
}

