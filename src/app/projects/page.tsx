// src/app/projects/page.tsx
import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import CreateProjectModal from "./_components/CreateProjectModal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Project = {
  id: string;
  title: string;
  project_code: string | null;
  colour: string | null;
  status: string | null;
  resource_status: string | null;
  start_date: string | null;
  finish_date: string | null;
  created_at: string;
  project_manager_id?: string | null;
  pm_user_id?: string | null;
  pm_name?: string | null;
  health?: number | null;
  rag?: "G" | "A" | "R" | null;
  isMember: boolean; // NEW: whether the current user is a project member
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function fmtShort(d: string | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "2-digit",
    });
  } catch { return null; }
}

function fmtLong(d: string | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return null; }
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  try {
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
  } catch { return null; }
}

function normaliseRag(v: unknown): "G" | "A" | "R" | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "G" || s === "GREEN") return "G";
  if (s === "A" || s === "AMBER" || s === "Y") return "A";
  if (s === "R" || s === "RED") return "R";
  return null;
}

function ragLabel(rag: "G" | "A" | "R" | null | undefined) {
  if (rag === "G") return "Green";
  if (rag === "A") return "Amber";
  if (rag === "R") return "Red";
  return "";
}

async function setProjectStatus(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!user) redirect("/login");

  const projectId = (formData.get("project_id") as string) || "";
  const status = (formData.get("status") as string) || "";
  const next = (formData.get("next") as string) || "/projects";

  if (!projectId || !["active", "closed"].includes(status)) redirect(next);

  const { error } = await supabase
    .from("projects")
    .update({ status })
    .eq("id", projectId);

  if (error) throw error;
  redirect(next);
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    filter?: string;
    sort?: string;
    q?: string;
    from_date?: string;
    to_date?: string;
  }>;
}) {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) redirect("/login");

  const activeOrgId = await getActiveOrgId();
  if (!activeOrgId) redirect("/settings?err=no_active_org");

  // ── 1a. Check if the user is an org admin/owner ───────────────────────────
  const { data: orgMemberRow } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", activeOrgId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const orgRole  = String(orgMemberRow?.role ?? "").toLowerCase();
  const isOrgAdmin = orgRole === "admin" || orgRole === "owner";

  // ── 1b. Get the current user's project memberships ────────────────────────
  const { data: memberRows, error: memErr } = await supabase
    .from("project_members")
    .select("project_id, role, removed_at")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .limit(20000);

  if (memErr) throw memErr;

  const memberProjectIds = new Set(
    (memberRows ?? [])
      .map((r: any) => String(r?.project_id || "").trim())
      .filter(Boolean),
  );

  const roleMap = Object.fromEntries(
    (memberRows ?? []).map((r: any) => [String(r.project_id), r.role]),
  );

  // ── 2. Fetch ALL org projects (not just the user's) ────────────────────────
  let projects: Project[] = [];

  const { data: pData, error: pErr } = await supabase
    .from("projects")
    .select(
      "id, title, project_code, colour, status, resource_status, start_date, finish_date, created_at, organisation_id, deleted_at, project_manager_id, pm_user_id, pm_name",
    )
    .eq("organisation_id", activeOrgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20000);

  if (pErr) throw pErr;

  const projectIds = (pData ?? []).map((p: any) => String(p.id));

  // ── 3. RAG scores ──────────────────────────────────────────────────────────
  const ragMap = new Map<string, { health: number | null; rag: "G" | "A" | "R" | null }>();

  if (projectIds.length > 0) {
    const { data: ragData } = await supabase
      .from("project_rag_scores")
      .select("project_id, health, rag, created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false });

    if (ragData) {
      for (const r of ragData as any[]) {
        const pid = String(r?.project_id ?? "");
        if (!pid || ragMap.has(pid)) continue;
        ragMap.set(pid, {
          health: r?.health == null || Number.isNaN(Number(r.health)) ? null : Number(r.health),
          rag: normaliseRag(r?.rag),
        });
      }
    }
  }

  // ── 4. PM name resolution ─────────────────────────────────────────────────
  const pmUserIds = Array.from(new Set(
    (pData ?? []).map((p: any) => safeStr(p?.pm_user_id).trim()).filter(Boolean),
  ));
  const pmProfileIds = Array.from(new Set(
    (pData ?? []).map((p: any) => safeStr(p?.project_manager_id).trim()).filter(Boolean),
  ));

  const pmByUserIdMap = new Map<string, { full_name?: string | null; email?: string | null }>();
  const pmByIdMap     = new Map<string, { full_name?: string | null; email?: string | null }>();

  if (pmUserIds.length > 0) {
    const { data: p1 } = await supabase
      .from("profiles").select("id, user_id, full_name, email").in("user_id", pmUserIds);
    for (const row of (p1 ?? []) as any[]) {
      const uid = safeStr(row?.user_id).trim();
      if (uid) pmByUserIdMap.set(uid, { full_name: row?.full_name ?? null, email: row?.email ?? null });
    }
  }

  if (pmProfileIds.length > 0) {
    const { data: p2 } = await supabase
      .from("profiles").select("id, user_id, full_name, email").in("id", pmProfileIds);
    for (const row of (p2 ?? []) as any[]) {
      const id = safeStr(row?.id).trim();
      if (id) pmByIdMap.set(id, { full_name: row?.full_name ?? null, email: row?.email ?? null });
    }
  }

  // ── 5. Build project list ─────────────────────────────────────────────────
  projects = (pData ?? []).map((p: any) => {
    const projectId       = String(p.id);
    const pmUserId        = safeStr(p?.pm_user_id).trim() || null;
    const projectMgrId    = safeStr(p?.project_manager_id).trim() || null;
    const storedPmName    = safeStr(p?.pm_name).trim() || null;
    const pmByUser        = pmUserId ? pmByUserIdMap.get(pmUserId) : null;
    const pmById          = projectMgrId ? pmByIdMap.get(projectMgrId) : null;

    const resolvedPmName =
      storedPmName ||
      safeStr(pmByUser?.full_name).trim() ||
      safeStr(pmByUser?.email).trim() ||
      safeStr(pmById?.full_name).trim() ||
      safeStr(pmById?.email).trim() ||
      null;

    return {
      id: projectId,
      title: String(p.title ?? "Untitled"),
      project_code: p.project_code ?? null,
      colour: p.colour ?? null,
      status: p.status ?? null,
      resource_status: p.resource_status ?? null,
      start_date: p.start_date ?? null,
      finish_date: p.finish_date ?? null,
      created_at: String(p.created_at),
      pm_user_id: pmUserId,
      project_manager_id: projectMgrId,
      pm_name: resolvedPmName,
      health: ragMap.get(projectId)?.health ?? null,
      rag: ragMap.get(projectId)?.rag ?? null,
      isMember: isOrgAdmin || memberProjectIds.has(projectId),
    };
  });

  // ── 6. URL params ─────────────────────────────────────────────────────────
  const sp         = (await searchParams) ?? {};
  const filter     = (sp.filter    ?? "Active").trim();
  const sortMode   = (sp.sort      ?? "Newest").trim();
  const query      = (sp.q         ?? "").trim().toLowerCase();
  const fromDate   = (sp.from_date ?? "").trim();
  const toDate     = (sp.to_date   ?? "").trim();

  // ── 7. Filtering ─────────────────────────────────────────────────────────
const filtered = projects
    .filter((p) => {
      const st = (p.status ?? "active").toLowerCase();
      const pipeline = (p.resource_status ?? "").toLowerCase() === "pipeline";
      if (filter === "Active")   return st !== "closed" && !pipeline;
      if (filter === "Pipeline") return pipeline;
      if (filter === "Closed")   return st === "closed";
      return true; // "All"
    })
        .filter((p) =>
      !query ||
      p.title.toLowerCase().includes(query) ||
      (p.project_code ?? "").toLowerCase().includes(query) ||
      (p.pm_name ?? "").toLowerCase().includes(query),
    )
    // Date range: include project if it overlaps with [fromDate, toDate]
    .filter((p) => {
      if (!fromDate && !toDate) return true;
      const projStart  = p.start_date  ? p.start_date.slice(0, 10)  : null;
      const projFinish = p.finish_date ? p.finish_date.slice(0, 10) : null;
      // If project has no dates, always include it in a date-filtered view
      if (!projStart && !projFinish) return true;
      if (fromDate && projFinish && projFinish < fromDate) return false;
      if (toDate   && projStart  && projStart  > toDate)   return false;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "A-Z") return a.title.localeCompare(b.title);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  // ── 8. Summary counts ─────────────────────────────────────────────────────
const isPipeline = (p: Project) => (p.resource_status ?? "").toLowerCase() === "pipeline";
  const isActive   = (p: Project) => (p.status ?? "active").toLowerCase() !== "closed" && !isPipeline(p);

  const activeCt   = projects.filter(isActive).length;
  const pipelineCt = projects.filter(isPipeline).length;
  const closedCt   = projects.filter((p) => (p.status ?? "").toLowerCase() === "closed").length;
  const atRiskCt   = projects.filter((p) => isActive(p) && p.rag === "R").length;

  const healthAvg = (() => {
    const scored = projects.filter((p) => isActive(p) && p.health != null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((s, p) => s + (p.health ?? 0), 0) / scored.length);
  })();
  
  // Helper: build href preserving all active params
  function tabHref(overrides: Record<string, string>) {
    const params = new URLSearchParams({
      filter,
      sort: sortMode,
      q: query,
      ...(fromDate ? { from_date: fromDate } : {}),
      ...(toDate   ? { to_date:   toDate }   : {}),
      ...overrides,
    });
    return `/projects?${params.toString()}`;
  }

  const hasDateFilter = Boolean(fromDate || toDate);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --white:      #ffffff;
          --off:        #f7f7f7;
          --off-2:      #fafafa;
          --rule:       #e9e9e9;
          --rule-heavy: #1f1f1f;
          --ink:        #0a0a0a;
          --ink-2:      #333333;
          --ink-3:      #666666;
          --ink-4:      #999999;
          --amber:      #b45309;
          --amber-bg:   #fffbeb;
          --red:        #b91c1c;
          --red-bg:     #fef2f2;
          --green:      #166534;
          --green-bg:   #f0fdf4;
          --font:       'Familjen Grotesk', 'Helvetica Neue', sans-serif;
          --mono:       'DM Mono', 'Courier New', monospace;
          --shadow-soft: 0 10px 30px rgba(0,0,0,0.04);
        }

        html, body {
          background: var(--white);
          color: var(--ink);
          font-family: var(--font);
          -webkit-font-smoothing: antialiased;
        }

        .page {
          min-height: 100vh;
          background: linear-gradient(to bottom, #ffffff 0%, #ffffff 280px, #fcfcfc 100%);
        }

        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 60px;
          height: 52px;
          border-bottom: 1px solid var(--rule);
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(8px);
          position: sticky;
          top: 0;
          z-index: 60;
        }

        .topbar-left { display: flex; align-items: center; gap: 24px; }
        .topbar-title { color: var(--ink); font-weight: 700; font-size: 14px; letter-spacing: -0.01em; }
        .topbar-right { display: flex; gap: 8px; align-items: center; }

        .btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          font-family: var(--font);
          font-size: 12px;
          font-weight: 600;
          border: 1px solid var(--rule);
          color: var(--ink-2);
          background: var(--white);
          text-decoration: none;
          cursor: pointer;
          letter-spacing: 0.01em;
          transition: border-color 0.15s, color 0.15s, background 0.15s, transform 0.15s;
        }

        .btn:hover { border-color: var(--ink-3); color: var(--ink); transform: translateY(-1px); }

        .masthead {
          padding: 18px 60px 0;
          border-bottom: 1px solid var(--rule-heavy);
          background: var(--white);
        }

        .mast-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.85fr);
          gap: 24px;
          padding-bottom: 20px;
          align-items: start;
        }

        .mast-left { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding-top: 4px; }

        .eyebrow {
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--ink-4);
        }

        .page-title {
          font-size: clamp(38px, 5vw, 54px);
          font-weight: 700;
          color: var(--ink);
          letter-spacing: -0.045em;
          line-height: 0.96;
        }

        .page-subtitle {
          font-size: 14px;
          color: var(--ink-3);
          line-height: 1.65;
          max-width: 760px;
        }

        .mast-right { display: flex; flex-direction: column; gap: 12px; align-self: start; }

        .summary-card {
          border: 1px solid var(--rule);
          background: linear-gradient(180deg, #ffffff 0%, #fcfcfc 100%);
          box-shadow: var(--shadow-soft);
        }

        .summary-copy {
          padding: 15px 18px 14px;
          border-bottom: 1px solid var(--rule);
          font-size: 13px;
          font-weight: 400;
          color: var(--ink-3);
          line-height: 1.55;
        }

        .kpi-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }

        .kpi-cell { padding: 14px 18px; border-right: 1px solid var(--rule); min-width: 0; }
        .kpi-cell:last-child { border-right: none; }
        .kpi-num { font-family: var(--mono); font-size: 28px; font-weight: 500; color: var(--ink); line-height: 1; letter-spacing: -0.04em; }
        .kpi-lbl { font-family: var(--mono); font-size: 9px; font-weight: 500; color: var(--ink-4); letter-spacing: 0.18em; text-transform: uppercase; margin-top: 6px; }

        /* ── Toolbar ───────────────────────────────────── */
        .toolbar {
          display: flex;
          align-items: stretch;
          border-bottom: 1px solid var(--rule);
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(10px);
          position: sticky;
          top: 52px;
          z-index: 50;
          flex-wrap: wrap;
        }

        .filter-tabs { display: flex; border-right: 1px solid var(--rule); }

        .f-tab {
          display: flex;
          align-items: center;
          padding: 0 24px;
          height: 50px;
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          text-decoration: none;
          color: var(--ink-4);
          border-right: 1px solid var(--rule);
          transition: color 0.12s, background 0.12s;
          white-space: nowrap;
          position: relative;
        }

        .f-tab:last-child { border-right: none; }
        .f-tab:hover { color: var(--ink-2); background: var(--off-2); }
        .f-tab.active { color: var(--ink); }
        .f-tab.active::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 2px;
          background: var(--ink);
        }

        .f-count { margin-left: 7px; font-size: 9px; color: var(--ink-4); }

        .search-zone {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 20px;
          flex: 1;
          min-width: 0;
        }

        .search-zone input {
          border: none; outline: none; background: transparent;
          font-family: var(--font); font-size: 13px; font-weight: 400;
          color: var(--ink); width: 100%; padding: 15px 0;
        }

        .search-zone input::placeholder { color: var(--ink-4); }

        /* ── Date range zone ────────────────────────────── */
        .date-zone {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 16px;
          border-left: 1px solid var(--rule);
          height: 50px;
        }

        .date-label {
          font-family: var(--mono);
          font-size: 9px;
          font-weight: 500;
          color: var(--ink-4);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .date-input {
          font-family: var(--mono);
          font-size: 11px;
          font-weight: 400;
          color: var(--ink);
          border: 1px solid var(--rule);
          background: var(--white);
          padding: 5px 8px;
          outline: none;
          width: 120px;
          cursor: pointer;
          transition: border-color 0.15s;
          appearance: none;
          -webkit-appearance: none;
        }

        .date-input:focus { border-color: var(--ink-3); }

        .date-input.active {
          border-color: var(--ink);
          background: var(--off);
        }

        .date-sep { font-size: 10px; color: var(--ink-4); }

        .date-clear-btn {
          font-family: var(--mono);
          font-size: 9px;
          font-weight: 500;
          color: var(--ink-4);
          background: none;
          border: 1px solid var(--rule);
          padding: 4px 8px;
          cursor: pointer;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          transition: color 0.12s, border-color 0.12s;
          white-space: nowrap;
        }

        .date-clear-btn:hover { color: var(--ink); border-color: var(--ink-3); }

        .sort-tabs { display: flex; border-left: 1px solid var(--rule); }

        .s-tab {
          display: flex;
          align-items: center;
          padding: 0 20px;
          height: 50px;
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          text-decoration: none;
          color: var(--ink-4);
          border-left: 1px solid var(--rule);
          transition: color 0.12s, background 0.12s;
        }

        .s-tab:hover { color: var(--ink-2); background: var(--off-2); }
        .s-tab.active { color: var(--ink); }

        /* ── Column header ──────────────────────────────── */
        .col-header {
          display: grid;
          grid-template-columns: 1fr 150px 130px 110px 36px;
          padding: 0 60px;
          height: 40px;
          align-items: center;
          background: var(--off);
          border-bottom: 1px solid var(--rule);
        }

        .ch {
          font-family: var(--mono);
          font-size: 9px;
          font-weight: 500;
          color: var(--ink-4);
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .ch-r { text-align: right; }

        /* ── Project rows ───────────────────────────────── */
        .p-row {
          display: grid;
          grid-template-columns: 1fr 150px 130px 110px 36px;
          padding: 0 60px;
          border-bottom: 1px solid var(--rule);
          background: var(--white);
          transition: background 0.12s;
          animation: rowIn 0.25s ease both;
          position: relative;
          text-decoration: none;
          color: inherit;
        }

        /* Member rows: fully interactive */
        .p-row.member { cursor: pointer; }
        .p-row.member:hover { background: #fcfcfc; }
        .p-row.member:hover .row-arrow { opacity: 1; transform: translateX(0); }
        .p-row.member:hover .row-actions-panel { opacity: 1; pointer-events: auto; }

        /* Non-member rows: dimmed, locked */
        .p-row.non-member {
          cursor: default;
          opacity: 0.48;
        }

        .p-row.non-member .row-name {
          pointer-events: none;
          text-decoration: none;
          color: var(--ink-3);
        }

        .p-row::before {
          content: '';
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 3px;
          background: var(--accent, transparent);
        }

        @keyframes rowIn {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .c-main {
          padding: 18px 24px 18px 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
          justify-content: center;
        }

        .row-name-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

        .row-name {
          font-size: 15px;
          font-weight: 650;
          color: var(--ink);
          letter-spacing: -0.01em;
          text-decoration: none;
        }

        .row-name:hover { text-decoration: underline; text-underline-offset: 3px; }

        .row-code {
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 400;
          color: var(--ink-4);
          letter-spacing: 0.04em;
        }

        .row-meta {
          font-size: 11px;
          font-weight: 400;
          color: var(--ink-4);
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .rm-sep { color: var(--rule); }

        /* Lock badge for non-members */
        .lock-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-family: var(--mono);
          font-size: 9px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-4);
          border: 1px solid var(--rule);
          padding: 2px 7px;
          border-radius: 2px;
        }

        .c-tl {
          padding: 0 16px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 5px;
          border-left: 1px solid var(--rule);
        }

        .tl-dates { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 9px; color: var(--ink-4); }
        .tl-bar { height: 2px; background: var(--rule); position: relative; overflow: hidden; }
        .tl-fill { position: absolute; left: 0; top: 0; height: 100%; }
        .tl-days { font-family: var(--mono); font-size: 9px; font-weight: 500; text-align: right; letter-spacing: 0.03em; }
        .tl-ok { color: #0f172a; } .tl-warn { color: var(--amber); }
        .tl-over { color: var(--red); } .tl-nil { color: var(--ink-4); }

        .c-health {
          padding: 0 16px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          border-left: 1px solid var(--rule);
          gap: 8px;
        }

        .h-num { font-family: var(--mono); font-size: 14px; font-weight: 500; }
        .h-g { color: var(--green); } .h-a { color: var(--amber); }
        .h-r { color: var(--red); } .h-n { color: var(--ink-4); }

        .rag-pill {
          font-family: var(--mono); font-size: 9px; font-weight: 500;
          padding: 4px 8px; letter-spacing: 0.08em; border-radius: 999px;
          text-transform: uppercase; line-height: 1;
        }

        .rp-g { background: var(--green-bg); color: var(--green); }
        .rp-a { background: var(--amber-bg); color: var(--amber); }
        .rp-r { background: var(--red-bg); color: var(--red); }

        .c-status {
          padding: 0 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-left: 1px solid var(--rule);
        }

        .st-pill {
          font-family: var(--mono); font-size: 9px; font-weight: 500;
          letter-spacing: 0.1em; text-transform: uppercase;
          padding: 6px 10px; white-space: nowrap; border-radius: 999px;
        }

        .st-active   { background: var(--green-bg); color: var(--green); }
        .st-closed   { background: var(--off); color: var(--ink-4); border: 1px solid var(--rule); }
        .st-pipeline { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; }

        .c-arrow {
          display: flex; align-items: center; justify-content: flex-end;
          border-left: 1px solid var(--rule); padding-left: 10px;
        }

        .row-arrow {
          font-size: 16px; color: var(--ink-3);
          opacity: 0; transform: translateX(-4px);
          transition: opacity 0.12s, transform 0.12s;
        }

        .row-actions-panel {
          position: absolute; right: 60px; top: 50%; transform: translateY(-50%);
          display: flex; gap: 0; opacity: 0; pointer-events: none;
          transition: opacity 0.12s;
        }

        .ra-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 12px; font-family: var(--mono); font-size: 9px;
          font-weight: 400; letter-spacing: 0.09em; text-transform: uppercase;
          border: 1px solid var(--rule); border-right: none;
          color: var(--ink-3); background: var(--white);
          text-decoration: none; cursor: pointer;
          transition: background 0.08s, color 0.08s, border-color 0.08s;
        }

        .ra-btn:last-child { border-right: 1px solid var(--rule); }
        .ra-btn:hover { background: var(--ink); color: var(--white); border-color: var(--ink); z-index: 2; position: relative; }
        .ra-close { color: var(--amber); }
        .ra-close:hover { background: var(--amber); color: var(--white); border-color: var(--amber); }

        .empty { padding: 88px 60px; border-bottom: 1px solid var(--rule); background: var(--white); }
        .empty-rule { width: 32px; height: 2px; background: var(--ink-4); margin-bottom: 20px; }
        .empty-h { font-size: 28px; font-weight: 600; color: var(--ink); letter-spacing: -0.02em; margin-bottom: 10px; }
        .empty-sub { font-size: 13px; color: var(--ink-3); font-weight: 400; }

        .page-footer {
          display: flex; justify-content: space-between; align-items: center;
          padding: 16px 60px; border-top: 1px solid var(--rule); background: var(--white);
        }

        .footer-txt { font-family: var(--mono); font-size: 10px; font-weight: 400; color: var(--ink-4); letter-spacing: 0.08em; }
        .js-hidden { display: none !important; }

        /* Date filter active indicator */
        .date-filter-active {
          display: inline-block;
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--ink);
          margin-left: 6px;
          vertical-align: middle;
        }

        @media (max-width: 1100px) {
          .masthead, .topbar, .page-footer { padding-left: 32px; padding-right: 32px; }
          .col-header, .p-row { padding-left: 32px; padding-right: 32px; grid-template-columns: 1fr 90px 36px; }
          .c-tl, .c-health, .c-status { display: none; }
          .col-header .ch:nth-child(2), .col-header .ch:nth-child(3), .col-header .ch:nth-child(4) { display: none; }
          .row-actions-panel { right: 32px; }
          .mast-grid { grid-template-columns: 1fr; gap: 20px; }
          .mast-right { max-width: none; }
          .date-zone { border-left: none; border-top: 1px solid var(--rule); padding: 10px 16px; height: auto; width: 100%; flex-wrap: wrap; }
        }

        @media (max-width: 768px) {
          .masthead, .topbar, .page-footer { padding-left: 20px; padding-right: 20px; }
          .col-header, .p-row { padding-left: 20px; padding-right: 20px; }
          .page-title { font-size: 38px; }
          .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .row-actions-panel { display: none; }
          .row-arrow { opacity: 1; transform: none; }
          .toolbar { top: 52px; }
        }
      `}</style>

      {/* ── JS: search filter + date range auto-submit ────────────────────── */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              function boot() {
                /* client-side text search */
                var inp = document.getElementById('sq');
                var lbl = document.getElementById('row-count');
                if (inp) {
                  inp.addEventListener('input', function () {
                    var q = this.value.toLowerCase();
                    var rows = document.querySelectorAll('.p-row');
                    var n = 0;
                    rows.forEach(function (r) {
                      var show = !q || (r.dataset.s || '').includes(q);
                      r.classList.toggle('js-hidden', !show);
                      if (show) n++;
                    });
                    if (lbl) lbl.textContent = n + ' project' + (n !== 1 ? 's' : '');
                  });
                }

                /* date range auto-submit */
                var dateForm = document.getElementById('date-form');
                if (dateForm) {
                  dateForm.querySelectorAll('input[type="date"]').forEach(function (el) {
                    el.addEventListener('change', function () {
                      dateForm.submit();
                    });
                  });
                }
              }
              document.readyState === 'loading'
                ? document.addEventListener('DOMContentLoaded', boot)
                : boot();
            })();
          `,
        }}
      />

      <div className="page">
        {/* ── Topbar ─────────────────────────────────────────────────────── */}
        <div className="topbar">
          <div className="topbar-left">
            <span className="topbar-title">Portfolio</span>
          </div>
          <div className="topbar-right">
            <Link href="/artifacts" className="btn">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.8"/>
              </svg>
              Artifacts
            </Link>
            <CreateProjectModal activeOrgId={activeOrgId ?? ""} userId={user.id} />
          </div>
        </div>

        {/* ── Masthead ────────────────────────────────────────────────────── */}
        <div className="masthead">
          <div className="mast-grid">
            <div className="mast-left">
              <div className="eyebrow">Portfolio Command Centre</div>
              <div className="page-title">Portfolio Projects</div>
              <p className="page-subtitle">
                Monitor delivery health, track milestones, and manage governance
                across all active work in one place.
              </p>
            </div>

            <div className="mast-right">
              <div className="summary-card">
                <div className="summary-copy">
                  Portfolio overview for your active organisation. Review live project
                  inventory, scan risk posture, and move directly into execution or
                  governance actions.
                </div>
                <div className="kpi-strip">
                  <div className="kpi-cell">
                    <div className="kpi-num">{projects.length}</div>
                    <div className="kpi-lbl">Total</div>
                  </div>
                  <div className="kpi-cell">
                    <div className="kpi-num">{activeCt}</div>
                    <div className="kpi-lbl">Active</div>
                  </div>
                  <div className="kpi-cell">
                    <div className="kpi-num" style={{ color: "#999999" }}>{closedCt}</div>
                    <div className="kpi-lbl">Closed</div>
                  </div>
                  {atRiskCt > 0 && (
                    <div className="kpi-cell">
                      <div className="kpi-num" style={{ color: "#b91c1c" }}>{atRiskCt}</div>
                      <div className="kpi-lbl">At Risk</div>
                    </div>
                  )}
                  {healthAvg != null && (
                    <div className="kpi-cell" style={{
                      background: healthAvg >= 90 ? "var(--green-bg)" : healthAvg >= 70 ? "var(--amber-bg)" : "var(--red-bg)",
                    }}>
                      <div className="kpi-num" style={{
                        color: healthAvg >= 90 ? "#166534" : healthAvg >= 70 ? "#b45309" : "#b91c1c",
                      }}>
                        {healthAvg}<span style={{ fontSize: 14, fontWeight: 300 }}>%</span>
                      </div>
                      <div className="kpi-lbl">Avg Health</div>
                    </div>
                  )}
                  <div className="kpi-cell">
                    <div className="kpi-num">{memberProjectIds.size}</div>
                    <div className="kpi-lbl">My projects</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div className="toolbar">
          {/* Filter tabs */}
          <div className="filter-tabs">
         {(["Active", "Pipeline", "Closed", "All"] as const).map((f) => (
              <Link
                key={f}
                href={tabHref({ filter: f })}
                className={`f-tab${filter === f ? " active" : ""}`}
              >
                {f}
                <span className="f-count">
                  {f === "Active"   ? activeCt
                  : f === "Pipeline" ? pipelineCt
                  : f === "Closed"   ? closedCt
                  : projects.length}
                </span>
              </Link>
            ))}          </div>

          {/* Search */}
          <div className="search-zone">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="#bbbbbb" strokeWidth="1.5"/>
              <path d="m21 21-4.35-4.35" stroke="#bbbbbb" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              id="sq"
              placeholder="Search projects"
              defaultValue={query}
              autoComplete="off"
            />
          </div>

          {/* ── Date range picker ─────────────────────────────────────── */}
          <form
            id="date-form"
            method="get"
            action="/projects"
            className="date-zone"
          >
            {/* Preserve existing URL params as hidden inputs */}
            <input type="hidden" name="filter"   value={filter} />
            <input type="hidden" name="sort"     value={sortMode} />
            {query && <input type="hidden" name="q" value={query} />}

            <span className="date-label">
              Date range
              {hasDateFilter && <span className="date-filter-active" />}
            </span>

            <input
              type="date"
              name="from_date"
              defaultValue={fromDate}
              className={`date-input${fromDate ? " active" : ""}`}
              title="Start: show projects active from this date"
            />
            <span className="date-sep">—</span>
            <input
              type="date"
              name="to_date"
              defaultValue={toDate}
              className={`date-input${toDate ? " active" : ""}`}
              title="End: show projects active up to this date"
            />

            {hasDateFilter && (
              <Link
                href={tabHref({ from_date: "", to_date: "" })}
                className="date-clear-btn"
                title="Clear date filter"
              >
                ✕ Clear
              </Link>
            )}
          </form>

          {/* Sort tabs */}
          <div className="sort-tabs">
            {(["Newest", "A-Z"] as const).map((s) => (
              <Link
                key={s}
                href={tabHref({ sort: s })}
                className={`s-tab${sortMode === s ? " active" : ""}`}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Column header ───────────────────────────────────────────────── */}
        <div className="col-header">
          <div className="ch">Project</div>
          <div className="ch">Timeline</div>
          <div className="ch ch-r">Health</div>
          <div className="ch" style={{ textAlign: "center" }}>Status</div>
          <div className="ch" />
        </div>

        {/* ── Project rows ─────────────────────────────────────────────────── */}
        {filtered.map((p, i) => {
          const colour    = p.colour || "#111111";
          const isActive  = (p.status ?? "active").toLowerCase() !== "closed";
          const isMember  = p.isMember;
          const health    = p.health;
          const rag       = normaliseRag(p.rag);
          const daysLeft  = daysUntil(p.finish_date);

          let tlPct = 0;
          if (p.start_date && p.finish_date) {
            const s = new Date(p.start_date).getTime();
            const e = new Date(p.finish_date).getTime();
            if (e > s) tlPct = Math.min(100, Math.max(0, Math.round(((Date.now() - s) / (e - s)) * 100)));
          }

          const tlColor = daysLeft == null ? colour : daysLeft < 0 ? "var(--red)" : daysLeft < 30 ? "var(--amber)" : colour;
          const tlCls   = daysLeft == null ? "tl-nil" : daysLeft < 0 ? "tl-over" : daysLeft < 30 ? "tl-warn" : "tl-ok";
          const tlLabel = daysLeft == null ? "" : daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? "Due today" : `${daysLeft}d left`;

          const hCls = health == null
            ? (rag === "G" ? "h-g" : rag === "A" ? "h-a" : rag === "R" ? "h-r" : "h-n")
            : (rag === "G" ? "h-g" : rag === "A" ? "h-a" : rag === "R" ? "h-r" : health >= 85 ? "h-g" : health >= 70 ? "h-a" : "h-r");

          const rpCls  = rag === "G" ? "rp-g" : rag === "A" ? "rp-a" : rag === "R" ? "rp-r" : "";
          const stCls  = !isActive ? "st-closed" : p.resource_status === "pipeline" ? "st-pipeline" : "st-active";
          const stLabel = !isActive ? "Closed" : p.resource_status === "pipeline" ? "Pipeline" : "Active";

          return (
            <div
              key={p.id}
              className={`p-row ${isMember ? "member" : "non-member"}`}
              data-s={`${p.title} ${p.project_code ?? ""} ${p.pm_name ?? ""}`.toLowerCase()}
              style={{
                "--accent": colour,
                animationDelay: `${Math.min(i * 0.03, 0.25)}s`,
              } as any}
            >
              <div className="c-main">
                <div className="row-name-line">
                  {/* Only members get a clickable link */}
                  {isMember ? (
                    <Link href={`/projects/${p.id}`} className="row-name">
                      {p.title}
                    </Link>
                  ) : (
                    <span className="row-name">{p.title}</span>
                  )}
                  {p.project_code && <span className="row-code">{p.project_code}</span>}
                  {!isMember && (
                    <span className="lock-badge">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
                        <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      No access
                    </span>
                  )}
                </div>

                <div className="row-meta">
                  <span>{p.pm_name?.trim() || "Unassigned"}</span>
                  <span className="rm-sep">|</span>
                  <span>{fmtLong(p.created_at)}</span>
                  {isMember && roleMap[p.id] && (
                    <>
                      <span className="rm-sep">|</span>
                      <span style={{ textTransform: "capitalize" }}>
                        {String(roleMap[p.id])}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="c-tl">
                <div className="tl-dates">
                  <span>{fmtShort(p.start_date) ?? ""}</span>
                  <span>{fmtShort(p.finish_date) ?? ""}</span>
                </div>
                <div className="tl-bar">
                  <div className="tl-fill" style={{ width: `${tlPct}%`, background: tlColor }} />
                </div>
                <div className={`tl-days ${tlCls}`}>{tlLabel}</div>
              </div>

              <div className="c-health">
                {health != null ? (
                  <>
                    {rag && <span className={`rag-pill ${rpCls}`}>{ragLabel(rag)}</span>}
                    <span className={`h-num ${hCls}`}>{health}%</span>
                  </>
                ) : rag ? (
                  <span className={`rag-pill ${rpCls}`}>{ragLabel(rag)}</span>
                ) : (
                  <span className="h-num h-n" />
                )}
              </div>

              <div className="c-status">
                <span className={`st-pill ${stCls}`}>{stLabel}</span>
              </div>

              <div className="c-arrow">
                {isMember ? (
                  <span className="row-arrow">&#8594;</span>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.25 }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
              </div>

              {/* Quick-action panel — only for members */}
              {isMember && (
                <div className="row-actions-panel">
                  <Link href={`/projects/${p.id}`} className="ra-btn">Overview &#8594;</Link>
                  <Link href={`/projects/${p.id}/artifacts`} className="ra-btn">Artifacts</Link>
                  <Link href={`/projects/${p.id}/members`} className="ra-btn">Members</Link>
                  <form action={setProjectStatus} style={{ display: "contents" }}>
                    <input type="hidden" name="project_id" value={p.id} />
                    <input type="hidden" name="status"     value={isActive ? "closed" : "active"} />
                    <input type="hidden" name="next"       value="/projects" />
                    <button type="submit" className={`ra-btn ${isActive ? "ra-close" : ""}`}>
                      {isActive ? "Close" : "Reopen"}
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="empty">
            <div className="empty-rule" />
            <div className="empty-h">
              {projects.length === 0 ? "No projects yet." : "Nothing matches your filters."}
            </div>
            <p className="empty-sub">
              {projects.length === 0
                ? "Create your first project to get started."
                : hasDateFilter
                  ? "Try widening the date range or clearing the filter."
                  : "Try adjusting the search term or filter."}
            </p>
          </div>
        )}

        <div className="page-footer">
          <span className="footer-txt" id="row-count">
            {filtered.length} project{filtered.length !== 1 ? "s" : ""}
            {!isOrgAdmin && ` · ${memberProjectIds.size} accessible to you`}
          </span>
          <span className="footer-txt">
            {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
      </div>
    </>
  );
}

