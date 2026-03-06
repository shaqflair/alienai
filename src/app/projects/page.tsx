// src/app/projects/page.tsx   world-class light theme redesign
import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import CreateProjectModal from "./_components/CreateProjectModal";

export const runtime   = "nodejs";
export const dynamic   = "force-dynamic";
export const revalidate = 0;

type Project = {
  id: string; title: string; project_code: string | null;
  colour: string | null; status: string | null; resource_status: string | null;
  start_date: string | null; finish_date: string | null; created_at: string;
  health?: number | null; rag?: "G" | "A" | "R" | null;
};

function fmtShort(d: string | null | undefined) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }); }
  catch { return null; }
}
function fmtLong(d: string | null | undefined) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return null; }
}
function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  try { return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000); }
  catch { return null; }
}

async function setProjectStatus(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!user) redirect("/login");
  const projectId = (formData.get("project_id") as string) || "";
  const status    = (formData.get("status")     as string) || "";
  const next      = (formData.get("next")        as string) || "/projects";
  if (!projectId || !["active", "closed"].includes(status)) redirect(next);
  const { error } = await supabase.from("projects").update({ status }).eq("id", projectId);
  if (error) throw error;
  redirect(next);
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string; sort?: string; q?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) redirect("/login");

  const activeOrgId = await getActiveOrgId();
  if (!activeOrgId) redirect("/settings?err=no_active_org");

  const { data: memberRows, error: memErr } = await supabase
    .from("project_members").select("project_id, role, removed_at")
    .eq("user_id", user.id).is("removed_at", null).limit(20000);
  if (memErr) throw memErr;

  const memberProjectIds = (memberRows ?? []).map((r: any) => String(r?.project_id || "").trim()).filter(Boolean);
  const roleMap = Object.fromEntries((memberRows ?? []).map((r: any) => [String(r.project_id), r.role]));

  let projects: Project[] = [];

  if (memberProjectIds.length > 0) {
    const { data: pData, error: pErr } = await supabase
      .from("projects")
      .select("id, title, project_code, colour, status, resource_status, start_date, finish_date, created_at, organisation_id, deleted_at")
      .in("id", memberProjectIds)
      .eq("organisation_id", activeOrgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20000);
    if (pErr) throw pErr;

    const projectIds = (pData ?? []).map((p: any) => p.id);
    const ragMap = new Map<string, { health: number; rag: string }>();
    if (projectIds.length > 0) {
      const { data: ragData } = await supabase
        .from("project_rag_scores").select("project_id, health, rag")
        .in("project_id", projectIds).order("created_at", { ascending: false });
      if (ragData) {
        for (const r of ragData) {
          if (!ragMap.has(r.project_id)) ragMap.set(r.project_id, { health: Number(r.health), rag: r.rag });
        }
      }
    }

    projects = (pData ?? []).map((p: any) => ({
      id: String(p.id), title: String(p.title ?? "Untitled"),
      project_code: p.project_code ?? null, colour: p.colour ?? null,
      status: p.status ?? null, resource_status: p.resource_status ?? null,
      start_date: p.start_date ?? null, finish_date: p.finish_date ?? null,
      created_at: String(p.created_at),
      health: ragMap.get(p.id)?.health ?? null,
      rag: (ragMap.get(p.id)?.rag as any) ?? null,
    }));
  }

  const sp       = (await searchParams) ?? {};
  const filter   = (sp.filter ?? "Active").trim();
  const sortMode = (sp.sort   ?? "Newest").trim();
  const query    = (sp.q      ?? "").trim().toLowerCase();

  const filtered = projects
    .filter((p) => {
      const st = (p.status ?? "active").toLowerCase();
      if (filter === "Active") return st !== "closed";
      if (filter === "Closed") return st === "closed";
      return true;
    })
    .filter((p) => !query || p.title.toLowerCase().includes(query) || (p.project_code ?? "").toLowerCase().includes(query))
    .sort((a, b) => {
      if (sortMode === "A-Z") return a.title.localeCompare(b.title);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const activeCt  = projects.filter((p) => (p.status ?? "active").toLowerCase() !== "closed").length;
  const closedCt  = projects.filter((p) => (p.status ?? "").toLowerCase() === "closed").length;
  const atRiskCt  = projects.filter((p) => (p.status ?? "active").toLowerCase() !== "closed" && p.rag === "R").length;
  const healthAvg = (() => {
    const scored = projects.filter((p) => (p.status ?? "active").toLowerCase() !== "closed" && p.health != null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((s, p) => s + (p.health ?? 0), 0) / scored.length);
  })();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --white:   #ffffff;
          --off:     #f5f5f5;
          --rule:    #e8e8e8;
          --rule-heavy: #222222;
          --ink:     #0a0a0a;
          --ink-2:   #333333;
          --ink-3:   #666666;
          --ink-4:   #999999;
          --ink-1:   #1a1a1a;
          --ink-1-bg: transparent;
          --amber:      #b45309;
          --amber-bg:   #fffbeb;
          --red:        #b91c1c;
          --red-bg:     #fef2f2;
          --font:       'Familjen Grotesk', 'Helvetica Neue', sans-serif;
          --mono:       'DM Mono', 'Courier New', monospace;
        }

        html, body {
          background: var(--white);
          color: var(--ink);
          font-family: var(--font);
          -webkit-font-smoothing: antialiased;
        }

        .page { min-height: 100vh; }

        /* --- TOP BAR --- */
        .topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 60px;
          height: 52px;
          border-bottom: 1px solid var(--rule);
        }
        .topbar-left { display: flex; align-items: center; gap: 24px; }
        .topbar-crumb {
          font-family: var(--mono); font-size: 11px; font-weight: 400;
          color: var(--ink-4); letter-spacing: 0.06em; text-transform: uppercase;
          text-decoration: none;
        }
        .topbar-crumb:hover { color: var(--ink-2); }
        .topbar-slash { color: var(--rule); font-size: 14px; }
        .topbar-current {
          font-family: var(--mono); font-size: 11px; font-weight: 500;
          color: var(--ink-3); letter-spacing: 0.06em; text-transform: uppercase;
        }
        .topbar-right { display: flex; gap: 6px; align-items: center; }

        .btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 14px; font-family: var(--font); font-size: 12px; font-weight: 500;
          border: 1px solid var(--rule); color: var(--ink-2); background: var(--white);
          text-decoration: none; cursor: pointer; letter-spacing: 0.01em;
          transition: border-color 0.1s, color 0.1s, background 0.1s;
        }
        .btn:hover { border-color: var(--ink-3); color: var(--ink); }
        .btn-dark { background: var(--ink); color: var(--white); border-color: var(--ink); }
        .btn-dark:hover { background: #333; border-color: #333; color: var(--white); }

        /* --- MASTHEAD --- */
        .masthead {
          padding: 60px 60px 0;
          border-bottom: 2px solid var(--rule-heavy);
          background: var(--white);
        }
        .mast-grid {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 60px; padding-bottom: 52px;
          align-items: end;
        }
        .page-title {
          font-family: var(--font);
          font-size: 56px; font-weight: 700; color: var(--ink);
          letter-spacing: -2px; line-height: 0.95;
        }
        .page-title em { font-style: italic; font-weight: 400; color: var(--ink-3); }
        .mast-right { display: flex; flex-direction: column; gap: 28px; }
        .page-desc {
          font-size: 14px; font-weight: 400; color: var(--ink-3);
          line-height: 1.6; max-width: 420px;
        }

        /* KPI strip */
        .kpi-strip { display: flex; gap: 0; border-top: 1px solid var(--rule); }
        .kpi-cell {
          padding: 20px 32px 20px 0;
          border-right: 1px solid var(--rule);
          margin-right: 32px;
          flex-shrink: 0;
        }
        .kpi-cell:last-child { border-right: none; margin-right: 0; }
        .kpi-num {
          font-family: var(--mono); font-size: 28px; font-weight: 400;
          color:var(--ink); line-height: 1; letter-spacing: -1px;
        }
        .kpi-lbl {
          font-family: var(--mono); font-size: 9px; font-weight: 400;
          color: var(--ink-4); letter-spacing: 0.18em; text-transform: uppercase;
          margin-top: 5px;
        }

        /* --- TOOLBAR --- */
        .toolbar {
          display: flex; align-items: stretch;
          border-bottom: 1px solid var(--rule);
          background: var(--white);
          position: sticky; top: 0; z-index: 50;
        }
        .filter-tabs { display: flex; border-right: 1px solid var(--rule); }
        .f-tab {
          display: flex; align-items: center;
          padding: 0 24px; height: 48px;
          font-family: var(--mono); font-size: 10px; font-weight: 400;
          letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none;
          color: var(--ink-4); border-right: 1px solid var(--rule);
          transition: color 0.1s, background 0.1s;
          white-space: nowrap; position: relative;
        }
        .f-tab:last-child { border-right: none; }
        .f-tab:hover { color: var(--ink-2); background: var(--off); }
        .f-tab.active { color: var(--ink); font-weight: 500; }
        .f-tab.active::after {
          content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px;
          background: var(--ink);
        }
        .f-count { margin-left: 7px; font-size: 9px; color: var(--ink-4); }

        .search-zone {
          display: flex; align-items: center; gap: 10px;
          padding: 0 20px; flex: 1;
        }
        .search-zone input {
          border: none; outline: none; background: transparent;
          font-family: var(--font); font-size: 13px; font-weight: 400;
          color: var(--ink); width: 100%; padding: 14px 0;
        }
        .search-zone input::placeholder { color: var(--ink-4); }

        .sort-tabs { display: flex; border-left: 1px solid var(--rule); }
        .s-tab {
          display: flex; align-items: center;
          padding: 0 20px; height: 48px;
          font-family: var(--mono); font-size: 10px; font-weight: 400;
          letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none;
          color: var(--ink-4); border-left: 1px solid var(--rule); transition: color 0.1s;
        }
        .s-tab:hover { color: var(--ink-2); }
        .s-tab.active { color: var(--ink); font-weight: 500; }

        /* --- COL HEADER --- */
        .col-header {
          display: grid;
          grid-template-columns: 1fr 130px 90px 100px 36px;
          padding: 0 60px;
          height: 36px; align-items: center;
          background: var(--off);
          border-bottom: 1px solid var(--rule);
        }
        .ch {
          font-family: var(--mono); font-size: 9px; font-weight: 500;
          color: var(--ink-4); letter-spacing: 0.14em; text-transform: uppercase;
        }
        .ch-r { text-align: right; }

        /* --- PROJECT ROW --- */
        .p-row {
          display: grid;
          grid-template-columns: 1fr 130px 90px 100px 36px;
          padding: 0 60px;
          border-bottom: 1px solid var(--rule);
          background: var(--white);
          cursor: pointer;
          transition: background 0.08s;
          animation: rowIn 0.25s ease both;
          position: relative;
          text-decoration: none; color: inherit;
        }
        .p-row:hover { background: var(--off); }
        .p-row:hover .row-arrow { opacity: 1; transform: translateX(0); }

        /* per-project left accent */
        .p-row::before {
          content: '';
          position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
          background: var(--accent, transparent);
        }

        @keyframes rowIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* --- CELL: MAIN --- */
        .c-main {
          padding: 20px 24px 20px 0;
          min-width: 0; display: flex; flex-direction: column; gap: 5px;
          justify-content: center;
        }
        .row-name-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .row-name {
          font-size: 15px; font-weight: 600; color: var(--ink);
          letter-spacing: -0.2px; text-decoration: none;
        }
        .row-code {
          font-family: var(--mono); font-size: 10px; font-weight: 400;
          color: var(--ink-4); letter-spacing: 0.04em;
        }
        .row-meta {
          font-size: 11px; font-weight: 400; color: var(--ink-4);
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .rm-sep { color: var(--rule); }

        /* --- CELL: TIMELINE --- */
        .c-tl {
          padding: 0 16px;
          display: flex; flex-direction: column; justify-content: center; gap: 5px;
          border-left: 1px solid var(--rule);
        }
        .tl-dates {
          display: flex; justify-content: space-between;
          font-family: var(--mono); font-size: 9px; color: var(--ink-4);
        }
        .tl-bar { height: 1px; background: var(--rule); position: relative; }
        .tl-fill { position: absolute; left: 0; top: 0; height: 100%; }
        .tl-days {
          font-family: var(--mono); font-size: 9px; font-weight: 500;
          text-align: right; letter-spacing: 0.03em;
        }
        .tl-ok { color: #0f172a; }
        .tl-warn { color: var(--amber); }
        .tl-over { color: var(--red); }
        .tl-nil { color: var(--ink-4); }

        /* --- CELL: HEALTH --- */
        .c-health {
          padding: 0 16px; display: flex; align-items: center; justify-content: flex-end;
          border-left: 1px solid var(--rule);
          gap: 8px;
        }
        .h-num {
          font-family: var(--mono); font-size: 14px; font-weight: 500;
        }
        .h-g { color: #0f172a; }
        .h-a { color: var(--amber); }
        .h-r { color: var(--red); }
        .h-n { color: var(--ink-4); }
        .rag-pill {
          font-family: var(--mono); font-size: 9px; font-weight: 500;
          padding: 2px 5px; letter-spacing: 0.08em;
        }
        .rp-g { background: transparent; color: #0f172a; }
        .rp-a { background: var(--amber-bg); color: var(--amber); }
        .rp-r { background: var(--red-bg);   color: var(--red); }

        /* --- CELL: STATUS --- */
        .c-status {
          padding: 0 16px; display: flex; align-items: center; justify-content: center;
          border-left: 1px solid var(--rule);
        }
        .st-pill {
          font-family: var(--mono); font-size: 9px; font-weight: 500;
          letter-spacing: 0.1em; text-transform: uppercase; padding: 3px 8px;
        }
        .st-active { background: transparent; color: #111; border: 1px solid #111; letter-spacing: 0.08em; font-size: 10px; text-transform: uppercase; font-weight: 500; }
        .st-closed   { background: var(--off);       color: var(--ink-4); }
        .st-pipeline { background: transparent; color: #555; border: 1px solid #999; letter-spacing: 0.08em; font-size: 10px; text-transform: uppercase; font-weight: 500; }

        /* --- CELL: ARROW --- */
        .c-arrow {
          display: flex; align-items: center; justify-content: flex-end;
          border-left: 1px solid var(--rule); padding-left: 10px;
        }
        .row-arrow {
          font-size: 16px; color: var(--ink-3);
          opacity: 0; transform: translateX(-4px);
          transition: opacity 0.12s, transform 0.12s;
        }

        /* --- ROW HOVER PANEL --- */
        .row-actions-panel {
          position: absolute; right: 60px; top: 50%; transform: translateY(-50%);
          display: flex; gap: 0;
          opacity: 0; pointer-events: none;
          transition: opacity 0.12s;
        }
        .p-row:hover .row-actions-panel { opacity: 1; pointer-events: auto; }

        .ra-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 12px; font-family: var(--mono); font-size: 9px; font-weight: 400;
          letter-spacing: 0.09em; text-transform: uppercase;
          border: 1px solid var(--rule); border-right: none;
          color: var(--ink-3); background: var(--white);
          text-decoration: none; cursor: pointer;
          transition: background 0.08s, color 0.08s;
        }
        .ra-btn:last-child { border-right: 1px solid var(--rule); }
        .ra-btn:hover { background: var(--ink); color: var(--white); border-color: var(--ink); z-index: 2; position: relative; }
        .ra-close { color: var(--amber); }
        .ra-close:hover { background: var(--amber); color: var(--white); border-color: var(--amber); }

        /* --- EMPTY STATE --- */
        .empty {
          padding: 96px 60px;
          border-bottom: 1px solid var(--rule);
        }
        .empty-rule { width: 32px; height: 2px; background: var(--ink-4); margin-bottom: 20px; }
        .empty-h {
          font-size: 28px; font-weight: 600; color: var(--ink);
          letter-spacing: -0.5px; margin-bottom: 10px;
        }
        .empty-sub { font-size: 13px; color: var(--ink-3); font-weight: 400; }

        /* --- FOOTER --- */
        .page-footer {
          display: flex; justify-content: space-between; align-items: center;
          padding: 16px 60px; border-top: 1px solid var(--rule);
        }
        .footer-txt {
          font-family: var(--mono); font-size: 10px; font-weight: 400;
          color: var(--ink-4); letter-spacing: 0.08em;
        }

        .js-hidden { display: none !important; }

        @media (max-width: 1100px) {
          .masthead, .topbar, .page-footer { padding-left: 32px; padding-right: 32px; }
          .col-header, .p-row { padding-left: 32px; padding-right: 32px; grid-template-columns: 1fr 80px 36px; }
          .c-tl, .c-health, .c-status { display: none; }
          .col-header .ch:nth-child(2), .col-header .ch:nth-child(3), .col-header .ch:nth-child(4) { display: none; }
          .row-actions-panel { right: 32px; }
          .mast-grid { grid-template-columns: 1fr; gap: 28px; }
        }
        @media (max-width: 768px) {
          .masthead, .topbar, .page-footer { padding-left: 20px; padding-right: 20px; }
          .col-header, .p-row { padding-left: 20px; padding-right: 20px; }
          .page-title { font-size: 38px; }
          .kpi-strip { flex-wrap: wrap; gap: 0; }
          .row-actions-panel { display: none; }
          .row-arrow { opacity: 1; transform: none; }
        }
      `}</style>

      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          function boot(){
            var inp = document.getElementById('sq');
            var lbl = document.getElementById('row-count');
            if (!inp) return;
            inp.addEventListener('input', function(){
              var q = this.value.toLowerCase();
              var rows = document.querySelectorAll('.p-row');
              var n = 0;
              rows.forEach(function(r){
                var show = !q || (r.dataset.s||'').includes(q);
                r.classList.toggle('js-hidden', !show);
                if (show) n++;
              });
              if (lbl) lbl.textContent = n + ' project' + (n !== 1 ? 's' : '');
            });
          }
          document.readyState === 'loading'
            ? document.addEventListener('DOMContentLoaded', boot) : boot();
        })();
      `}} />

      <div className="page">

        {/* -- TOP BAR -- */}
        <div className="topbar">
          <div className="topbar-left"><span style={{ color: "#0f172a", fontWeight: 700 }}>Portfolio Projects</span></div>
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

        {/* -- MASTHEAD -- */}
        <div className="masthead">
          <div className="mast-grid">
            <div>
              <div className="page-title">
                Portfolio Projects
              </div>
            </div>
            <div className="mast-right">
              <p className="page-desc">
                Portfolio command centre. Monitor health, track delivery milestones,
                and manage governance across all active work.
              </p>
              <div className="kpi-strip">
                <div className="kpi-cell">
                  <div className="kpi-num">{projects.length}</div>
                  <div className="kpi-lbl">Total</div>
                </div>
                <div className="kpi-cell">
                  <div className="kpi-num" style={{ color:var(--ink)"#0f172a" }}>{activeCt}</div>
                  <div className="kpi-lbl">Active</div>
                </div>
                <div className="kpi-cell">
                  <div className="kpi-num" style={{ color:var(--ink)"var(--ink-4)" }}>{closedCt}</div>
                  <div className="kpi-lbl">Closed</div>
                </div>
                {atRiskCt > 0 && (
                  <div className="kpi-cell">
                    <div className="kpi-num" style={{ color:var(--ink)"var(--red)" }}>{atRiskCt}</div>
                    <div className="kpi-lbl">At Risk</div>
                  </div>
                )}
                {healthAvg != null && (
                  <div className="kpi-cell">
                    <div className="kpi-num" style={{ color: var(--ink)"var(--ink-1)" : healthAvg >= 70 ? "var(--amber)" : "var(--red)" }}>
                      {healthAvg}<span style={{ fontSize: 14, fontWeight: 300 }}>%</span>
                    </div>
                    <div className="kpi-lbl">Avg Health</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* -- TOOLBAR -- */}
        <div className="toolbar">
          <div className="filter-tabs">
            {(["Active", "Closed", "All"] as const).map((f) => (
              <Link
                key={f}
                href={`/projects?filter=${f}&sort=${sortMode}&q=${encodeURIComponent(query)}`}
                className={`f-tab${filter === f ? " active" : ""}`}
              >
                {f}<span className="f-count">{f === "Active" ? activeCt : f === "Closed" ? closedCt : projects.length}</span>
              </Link>
            ))}
          </div>
          <div className="search-zone">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="#bbbbbb" strokeWidth="1.5"/>
              <path d="m21 21-4.35-4.35" stroke="#bbbbbb" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input id="sq" placeholder="Search projects" defaultValue={query} autoComplete="off" />
          </div>
          <div className="sort-tabs">
            {(["Newest", "A-Z"] as const).map((s) => (
              <Link
                key={s}
                href={`/projects?filter=${filter}&sort=${s}&q=${encodeURIComponent(query)}`}
                className={`s-tab${sortMode === s ? " active" : ""}`}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        {/* -- COLUMN HEADERS -- */}
        <div className="col-header">
          <div className="ch">Project</div>
          <div className="ch">Timeline</div>
          <div className="ch ch-r">Health</div>
          <div className="ch" style={{ textAlign: "center" }}>Status</div>
          <div className="ch" />
        </div>

        {/* -- ROWS -- */}
        {filtered.map((p, i) => {
          const colour   = p.colour || "#111111";
          const isActive = (p.status ?? "active").toLowerCase() !== "closed";
          const health   = p.health;
          const rag      = p.rag;
          const daysLeft = daysUntil(p.finish_date);

          let tlPct = 0;
          if (p.start_date && p.finish_date) {
            const s = new Date(p.start_date).getTime();
            const e = new Date(p.finish_date).getTime();
            tlPct = Math.min(100, Math.max(0, Math.round(((Date.now() - s) / (e - s)) * 100)));
          }

          const tlColor = daysLeft == null ? colour
            : daysLeft < 0 ? "var(--red)" : daysLeft < 30 ? "var(--amber)" : colour;

          const tlCls = daysLeft == null ? "tl-nil"
            : daysLeft < 0 ? "tl-over" : daysLeft < 30 ? "tl-warn" : "tl-ok";

          const tlLabel = daysLeft == null ? ""
            : daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue`
            : daysLeft === 0 ? "Due today" : `${daysLeft}d left`;

          const hCls = health == null ? "h-n"
            : rag === "G" || health >= 85 ? "h-g"
            : rag === "A" || health >= 70 ? "h-a" : "h-r";

          const rpCls = rag === "G" ? "rp-g" : rag === "A" ? "rp-a" : rag === "R" ? "rp-r" : "";
          const stCls = !isActive ? "st-closed"
            : p.resource_status === "pipeline" ? "st-pipeline" : "st-active";
          const stLabel = !isActive ? "Closed"
            : p.resource_status === "pipeline" ? "Pipeline" : "Active";

          return (
            <div
              key={p.id}
              className="p-row"
              data-s={`${p.title} ${p.project_code ?? ""}`.toLowerCase()}
              style={{ "--accent": colour, animationDelay: `${Math.min(i * 0.03, 0.25)}s` } as any}
            >
              {/* Main */}
              <div className="c-main">
                <div className="row-name-line">
                  <Link href={`/projects/${p.id}`} className="row-name">
                    {p.title}
                  </Link>
                  {p.project_code && <span className="row-code">{p.project_code}</span>}
                </div>
                <div className="row-meta">
                  <span>{(p as any).pm_name ?? "Unassigned"}</span>
                  <span className="rm-sep">|</span>
                  <span>{fmtLong(p.created_at)}</span>
                  {roleMap[p.id] && (
                    <>
                      <span className="rm-sep">|</span>
                      <span style={{ textTransform: "capitalize" }}>{String(roleMap[p.id])}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Timeline */}
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

              {/* Health */}
              <div className="c-health">
                {health != null ? (
                  <>
                    {rag && <span className={`rag-pill ${rpCls}`}>{rag}</span>}
                    <span className={`h-num ${hCls}`}>{health}%</span>
                  </>
                ) : (
                  <span className="h-num h-n"></span>
                )}
              </div>

              {/* Status */}
              <div className="c-status">
                <span className={`st-pill ${stCls}`}>{stLabel}</span>
              </div>

              {/* Arrow */}
              <div className="c-arrow">
                <span className="row-arrow">&#8594;</span>
              </div>

              {/* Hover action panel */}
              <div className="row-actions-panel">
                <Link href={`/projects/${p.id}`} className="ra-btn">Overview &#8594;</Link>
                <Link href={`/projects/${p.id}/artifacts`} className="ra-btn">Artifacts</Link>
                <Link href={`/projects/${p.id}/members`}   className="ra-btn">Members</Link>
                <form action={setProjectStatus} style={{ display: "contents" }}>
                  <input type="hidden" name="project_id" value={p.id} />
                  <input type="hidden" name="status" value={isActive ? "closed" : "active"} />
                  <input type="hidden" name="next" value="/projects" />
                  <button type="submit" className={`ra-btn ${isActive ? "ra-close" : ""}`}>
                    {isActive ? "Close" : "Reopen"}
                  </button>
                </form>
              </div>
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
                : "Try adjusting the search term or filter."}
            </p>
          </div>
        )}

        {/* -- FOOTER -- */}
        <div className="page-footer">
          <span className="footer-txt" id="row-count">
            {filtered.length} project{filtered.length !== 1 ? "s" : ""}
          </span>
          <span className="footer-txt">
            {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>

      </div>
    </>
  );
}
