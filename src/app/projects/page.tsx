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
  health?: number | null;
  rag?: "G" | "A" | "R" | null;
};

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function formatDateShort(d: string | null | undefined) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }); }
  catch { return null; }
}
function formatDateLong(d: string | null | undefined) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return null; }
}
function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  try { return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000); }
  catch { return null; }
}
function projectRef(p: Project) { return p.id; }

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
    .from("project_members")
    .select("project_id, role, removed_at")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .limit(20000);
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
    let ragMap = new Map<string, { health: number; rag: string }>();
    if (projectIds.length > 0) {
      const { data: ragData } = await supabase
        .from("project_rag_scores")
        .select("project_id, health, rag")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false });
      if (ragData) {
        for (const r of ragData) {
          if (!ragMap.has(r.project_id)) ragMap.set(r.project_id, { health: Number(r.health), rag: r.rag });
        }
      }
    }

    projects = (pData ?? []).map((p: any) => ({
      id: String(p.id),
      title: String(p.title ?? "Untitled"),
      project_code: p.project_code ?? null,
      colour: p.colour ?? null,
      status: p.status ?? null,
      resource_status: p.resource_status ?? null,
      start_date: p.start_date ?? null,
      finish_date: p.finish_date ?? null,
      created_at: String(p.created_at),
      health: ragMap.get(p.id)?.health ?? null,
      rag: (ragMap.get(p.id)?.rag as any) ?? null,
    }));
  }

  const sp = (await searchParams) ?? {};
  const filter   = (sp.filter ?? "Active").trim();
  const sortMode = (sp.sort ?? "Newest").trim();
  const query    = (sp.q ?? "").trim().toLowerCase();

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
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:         #07090f;
          --bg-2:       #0d1117;
          --surface:    #111620;
          --surface-2:  #161d2e;
          --border:     rgba(255,255,255,0.07);
          --border-2:   rgba(255,255,255,0.12);
          --text:       #f0f4ff;
          --text-2:     #8892a4;
          --text-3:     #4a5568;
          --teal:       #2dd4bf;
          --teal-dim:   rgba(45,212,191,0.12);
          --teal-glow:  rgba(45,212,191,0.25);
        }

        html, body { background: var(--bg); color: var(--text); font-family: 'Instrument Sans', sans-serif; }

        /* ── PAGE WRAPPER ── */
        .page { min-height: 100vh; background: var(--bg); }

        /* ── HEADER ── */
        .header {
          padding: 52px 56px 0;
          position: relative;
          background: linear-gradient(180deg, #0a0f1e 0%, var(--bg) 100%);
        }
        .header::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0; height: 1px;
          background: var(--border);
        }

        /* Noise texture overlay */
        .header::before {
          content: '';
          position: absolute; inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
          background-size: 200px 200px;
          opacity: 0.4; pointer-events: none; z-index: 0;
        }

        .header-inner { position: relative; z-index: 1; }

        /* Glow orbs */
        .orb-teal {
          position: absolute; top: -60px; right: 200px;
          width: 400px; height: 300px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(45,212,191,0.07) 0%, transparent 70%);
          pointer-events: none; z-index: 0;
        }
        .orb-blue {
          position: absolute; top: 20px; right: -100px;
          width: 500px; height: 400px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(59,130,246,0.05) 0%, transparent 70%);
          pointer-events: none; z-index: 0;
        }

        /* ── TITLE ROW ── */
        .title-row {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 20px; flex-wrap: wrap; margin-bottom: 36px;
        }
        .page-title {
          font-family: 'Syne', sans-serif;
          font-size: 42px; font-weight: 800; color: var(--text);
          letter-spacing: -1.5px; line-height: 1; margin-bottom: 8px;
        }
        .page-sub { font-size: 14px; color: var(--text-2); font-weight: 400; }

        /* ── HEADER ACTIONS ── */
        .header-actions { display: flex; gap: 10px; align-items: center; padding-top: 6px; }
        .btn-ghost {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 18px; border-radius: 10px; font-size: 13px; font-weight: 600;
          border: 1px solid var(--border-2); color: var(--text-2);
          background: rgba(255,255,255,0.03); text-decoration: none;
          transition: all 0.15s; font-family: 'Instrument Sans', sans-serif;
          white-space: nowrap;
        }
        .btn-ghost:hover { background: rgba(255,255,255,0.07); color: var(--text); border-color: rgba(255,255,255,0.18); }
        .btn-primary {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 18px; border-radius: 10px; font-size: 13px; font-weight: 700;
          background: var(--teal); color: #0a0e17; border: none; cursor: pointer;
          text-decoration: none; transition: opacity 0.15s; white-space: nowrap;
          font-family: 'Instrument Sans', sans-serif;
          box-shadow: 0 0 24px rgba(45,212,191,0.3);
        }
        .btn-primary:hover { opacity: 0.88; }

        /* ── STATS ROW ── */
        .stats-row {
          display: flex; gap: 0; margin-bottom: 0;
          border-top: 1px solid var(--border);
          border-bottom: none;
        }
        .stat-item {
          display: flex; flex-direction: column; gap: 3px;
          padding: 18px 28px; border-right: 1px solid var(--border);
          position: relative;
        }
        .stat-item:first-child { padding-left: 0; }
        .stat-item:last-child { border-right: none; }
        .stat-val {
          font-family: 'Syne', sans-serif;
          font-size: 22px; font-weight: 700; color: var(--text);
          letter-spacing: -0.5px; line-height: 1;
        }
        .stat-lbl { font-size: 11px; color: var(--text-3); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
        .stat-indicator { display: inline-flex; align-items: center; gap: 5px; }
        .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }

        /* ── TOOLBAR ── */
        .toolbar {
          display: flex; align-items: center; gap: 8px;
          padding: 16px 56px; flex-wrap: wrap;
          border-bottom: 1px solid var(--border);
          background: var(--bg);
          position: sticky; top: 0; z-index: 50;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }
        .filter-group { display: flex; gap: 2px; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 3px; border: 1px solid var(--border); }
        .f-tab {
          padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
          text-decoration: none; color: var(--text-3); transition: all 0.15s;
          white-space: nowrap; font-family: 'Instrument Sans', sans-serif;
        }
        .f-tab:hover  { color: var(--text-2); background: rgba(255,255,255,0.05); }
        .f-tab.active { background: rgba(255,255,255,0.1); color: var(--text); }
        .f-tab-count  { margin-left: 5px; font-size: 10px; opacity: 0.5; }

        .search-wrap {
          display: flex; align-items: center; gap: 8px;
          background: rgba(255,255,255,0.04); border: 1px solid var(--border);
          border-radius: 10px; padding: 7px 13px; flex: 1; max-width: 280px;
          transition: all 0.15s;
        }
        .search-wrap:focus-within { border-color: var(--border-2); background: rgba(255,255,255,0.07); box-shadow: 0 0 0 3px rgba(45,212,191,0.06); }
        .search-wrap input {
          border: none; outline: none; background: transparent; font-size: 13px;
          color: var(--text); font-family: 'Instrument Sans', sans-serif; width: 100%;
        }
        .search-wrap input::placeholder { color: var(--text-3); }

        .sort-group { display: flex; gap: 2px; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 3px; border: 1px solid var(--border); margin-left: auto; }
        .s-tab {
          padding: 6px 12px; border-radius: 7px; font-size: 12px; font-weight: 600;
          text-decoration: none; color: var(--text-3); transition: all 0.15s;
          font-family: 'Instrument Sans', sans-serif;
        }
        .s-tab:hover  { color: var(--text-2); }
        .s-tab.active { background: rgba(255,255,255,0.1); color: var(--text); }

        /* ── LIST ── */
        .list-wrap { padding: 28px 56px 80px; }
        .list-meta { font-size: 11px; font-weight: 600; color: var(--text-3); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 16px; }

        /* ── PROJECT CARD ── */
        .p-card {
          position: relative;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px; margin-bottom: 8px;
          overflow: hidden;
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
          animation: riseIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .p-card:hover {
          border-color: var(--border-2);
          box-shadow: 0 4px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
          transform: translateY(-1px);
        }
        .p-card:hover .card-glow { opacity: 1; }

        @keyframes riseIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Left colour accent */
        .card-stripe {
          position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
          border-radius: 16px 0 0 16px;
        }

        /* Hover glow from stripe colour */
        .card-glow {
          position: absolute; left: 0; top: 0; bottom: 0; width: 200px;
          opacity: 0; transition: opacity 0.3s; pointer-events: none;
          border-radius: 16px 0 0 16px;
        }

        .card-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          align-items: center;
          gap: 20px; padding: 18px 20px 18px 24px;
        }

        /* ── LEFT: project info ── */
        .card-info { min-width: 0; }
        .card-title-row { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; flex-wrap: wrap; }
        .card-name {
          font-size: 15px; font-weight: 700; color: var(--text); text-decoration: none;
          letter-spacing: -0.2px; transition: color 0.15s;
        }
        .card-name:hover { color: var(--teal); }
        .code-pill {
          font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 500;
          padding: 2px 7px; border-radius: 5px;
          background: rgba(255,255,255,0.05); color: var(--text-3);
          border: 1px solid var(--border); letter-spacing: 0.03em;
        }
        .status-pill {
          font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
          letter-spacing: 0.03em;
        }
        .status-active { background: rgba(34,197,94,0.12); color: #4ade80; }
        .status-closed { background: rgba(148,163,184,0.1); color: #64748b; }
        .status-pipeline { background: rgba(167,139,250,0.12); color: #a78bfa; }

        .card-meta { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-3); flex-wrap: wrap; }
        .meta-dot  { width: 2px; height: 2px; background: var(--text-3); border-radius: 50%; opacity: 0.4; flex-shrink: 0; }
        .pm-link   { color: #60a5fa; font-weight: 600; text-decoration: none; }
        .pm-link:hover { color: #93c5fd; }

        /* ── MIDDLE: timeline bar ── */
        .card-timeline { width: 200px; flex-shrink: 0; }
        .timeline-dates { display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-3); margin-bottom: 5px; }
        .timeline-track { height: 4px; background: rgba(255,255,255,0.06); border-radius: 99px; overflow: hidden; position: relative; }
        .timeline-fill  { height: 100%; border-radius: 99px; position: absolute; left: 0; top: 0; transition: width 0.5s cubic-bezier(0.16,1,0.3,1); }
        .timeline-label { margin-top: 5px; display: flex; align-items: center; justify-content: flex-end; }
        .days-badge {
          font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
          font-family: 'Instrument Sans', sans-serif;
        }
        .days-ok      { background: rgba(34,197,94,0.12);  color: #4ade80; }
        .days-warn    { background: rgba(251,191,36,0.12);  color: #fbbf24; }
        .days-overdue { background: rgba(248,113,113,0.12); color: #f87171; }
        .days-none    { background: rgba(255,255,255,0.05); color: var(--text-3); }

        /* ── RIGHT: actions ── */
        .card-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .act {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 7px 13px; border-radius: 9px; font-size: 12px; font-weight: 600;
          text-decoration: none; border: 1px solid var(--border); color: var(--text-2);
          background: rgba(255,255,255,0.03); transition: all 0.15s; white-space: nowrap;
          font-family: 'Instrument Sans', sans-serif; cursor: pointer;
        }
        .act:hover { background: rgba(255,255,255,0.07); border-color: var(--border-2); color: var(--text); }
        .act-overview:hover { border-color: rgba(45,212,191,0.3); color: var(--teal); }
        .act-close { border-color: rgba(251,191,36,0.2); color: #fbbf24; background: rgba(251,191,36,0.05); }
        .act-close:hover { background: rgba(251,191,36,0.1); border-color: rgba(251,191,36,0.4); }
        .act-reopen { }
        .v-line { width: 1px; height: 14px; background: var(--border); flex-shrink: 0; }

        /* ── HEALTH SCORE inline ── */
        .health-inline {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 700;
          padding: 3px 9px; border-radius: 7px;
        }
        .health-g { background: rgba(34,197,94,0.1);  color: #4ade80; }
        .health-a { background: rgba(251,191,36,0.1);  color: #fbbf24; }
        .health-r { background: rgba(248,113,113,0.1); color: #f87171; }
        .health-n { background: rgba(255,255,255,0.05); color: var(--text-3); }

        /* ── EMPTY ── */
        .empty { padding: 80px 0; text-align: center; }
        .empty-icon { font-size: 40px; margin-bottom: 14px; }
        .empty-title { font-size: 15px; font-weight: 700; color: var(--text-2); margin-bottom: 6px; }
        .empty-sub   { font-size: 13px; color: var(--text-3); }

        /* ── HIDDEN ── */
        .js-hidden { display: none !important; }

        @media (max-width: 1024px) {
          .header     { padding: 36px 24px 0; }
          .toolbar    { padding: 12px 24px; }
          .list-wrap  { padding: 20px 24px 60px; }
          .card-timeline { display: none; }
        }
        @media (max-width: 768px) {
          .page-title { font-size: 28px; }
          .stats-row  { flex-wrap: wrap; }
          .act span   { display: none; }
          .card-row   { grid-template-columns: 1fr auto; gap: 12px; }
        }
      `}</style>

      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          function boot(){
            var inp = document.getElementById('live-q');
            if(!inp) return;
            var lbl = document.getElementById('list-count');
            inp.addEventListener('input', function(){
              var q = this.value.toLowerCase();
              var cards = document.querySelectorAll('.p-card');
              var n = 0;
              cards.forEach(function(c){
                var show = !q || (c.dataset.s||'').includes(q);
                c.classList.toggle('js-hidden', !show);
                if(show) n++;
              });
              if(lbl) lbl.textContent = n + ' project' + (n!==1?'s':'');
            });
          }
          document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',boot) : boot();
        })();
      `}} />

      <div className="page">

        {/* ── HEADER ── */}
        <div className="header">
          <div className="orb-teal" />
          <div className="orb-blue" />
          <div className="header-inner">

            <div className="title-row">
              <div>
                <div className="page-title">Projects</div>
                <div className="page-sub">Portfolio command centre — monitor health, track delivery, manage governance.</div>
              </div>
              <div className="header-actions">
                <Link href="/artifacts" className="btn-ghost">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2"/>
                    <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Global artifacts
                </Link>
                <CreateProjectModal activeOrgId={activeOrgId ?? ""} userId={user.id} />
              </div>
            </div>

            {/* Stats row */}
            <div className="stats-row">
              <div className="stat-item">
                <div className="stat-val">{projects.length}</div>
                <div className="stat-lbl">Total</div>
              </div>
              <div className="stat-item">
                <div className="stat-indicator">
                  <span className="dot" style={{ background: "#4ade80" }} />
                  <span className="stat-val" style={{ color: "#4ade80" }}>{activeCt}</span>
                </div>
                <div className="stat-lbl">Active</div>
              </div>
              <div className="stat-item">
                <div className="stat-indicator">
                  <span className="dot" style={{ background: "#64748b" }} />
                  <span className="stat-val" style={{ color: "#64748b" }}>{closedCt}</span>
                </div>
                <div className="stat-lbl">Closed</div>
              </div>
              {atRiskCt > 0 && (
                <div className="stat-item">
                  <div className="stat-indicator">
                    <span className="dot" style={{ background: "#f87171" }} />
                    <span className="stat-val" style={{ color: "#f87171" }}>{atRiskCt}</span>
                  </div>
                  <div className="stat-lbl">At risk</div>
                </div>
              )}
              {healthAvg != null && (
                <div className="stat-item">
                  <div className="stat-val" style={{ color: healthAvg >= 85 ? "#4ade80" : healthAvg >= 70 ? "#fbbf24" : "#f87171" }}>
                    {healthAvg}%
                  </div>
                  <div className="stat-lbl">Avg health</div>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── TOOLBAR ── */}
        <div className="toolbar">
          <div className="filter-group">
            {(["Active","Closed","All"] as const).map((f) => (
              <Link
                key={f}
                href={`/projects?filter=${f}&sort=${sortMode}&q=${encodeURIComponent(query)}`}
                className={`f-tab${filter === f ? " active" : ""}`}
              >
                {f}
                <span className="f-tab-count">
                  {f === "Active" ? activeCt : f === "Closed" ? closedCt : projects.length}
                </span>
              </Link>
            ))}
          </div>

          <div className="search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="#4a5568" strokeWidth="2"/>
              <path d="m21 21-4.35-4.35" stroke="#4a5568" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input id="live-q" placeholder="Search by name or code…" defaultValue={query} autoComplete="off" />
          </div>

          <div className="sort-group">
            {(["Newest","A-Z"] as const).map((s) => (
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

        {/* ── LIST ── */}
        <div className="list-wrap">
          <div className="list-meta" id="list-count">
            {filtered.length} project{filtered.length !== 1 ? "s" : ""}
          </div>

          {filtered.map((p, i) => {
            const ref      = projectRef(p);
            const colour   = p.colour || "#2dd4bf";
            const isActive = (p.status ?? "active").toLowerCase() !== "closed";
            const health   = p.health;
            const rag      = p.rag;
            const daysLeft = daysUntil(p.finish_date);

            // Timeline progress (0–100%)
            let timelineProgress = 0;
            if (p.start_date && p.finish_date) {
              const s = new Date(p.start_date).getTime();
              const e = new Date(p.finish_date).getTime();
              const n = Date.now();
              timelineProgress = Math.min(100, Math.max(0, Math.round(((n - s) / (e - s)) * 100)));
            }

            const timelineColor = daysLeft == null ? colour
              : daysLeft < 0 ? "#f87171"
              : daysLeft < 30 ? "#fbbf24"
              : colour;

            const daysCls = daysLeft == null ? "days-none"
              : daysLeft < 0 ? "days-overdue"
              : daysLeft < 30 ? "days-warn"
              : "days-ok";

            const daysLabel = daysLeft == null ? "No end date"
              : daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue`
              : daysLeft === 0 ? "Due today"
              : `${daysLeft}d left`;

            const healthCls = health == null ? "health-n"
              : rag === "G" || health >= 85 ? "health-g"
              : rag === "A" || health >= 70 ? "health-a"
              : "health-r";

            const searchAttr = `${p.title} ${p.project_code ?? ""}`.toLowerCase();

            return (
              <div
                key={p.id}
                className="p-card"
                data-s={searchAttr}
                style={{ animationDelay: `${Math.min(i * 0.05, 0.4)}s` }}
              >
                {/* Colour stripe */}
                <div className="card-stripe" style={{ background: colour }} />

                {/* Hover glow */}
                <div
                  className="card-glow"
                  style={{ background: `linear-gradient(to right, ${colour}10, transparent)` }}
                />

                <div className="card-row">
                  {/* ── Info ── */}
                  <div className="card-info">
                    <div className="card-title-row">
                      <Link href={`/projects/${ref}`} className="card-name">{p.title}</Link>
                      {p.project_code && <span className="code-pill">{p.project_code}</span>}
                      <span className={`status-pill ${isActive ? "status-active" : "status-closed"}`}>
                        {isActive ? "Active" : "Closed"}
                      </span>
                      {p.resource_status === "pipeline" && (
                        <span className="status-pill status-pipeline">Pipeline</span>
                      )}
                      {health != null && (
                        <span className={`health-inline ${healthCls}`}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                          </svg>
                          {health}%
                        </span>
                      )}
                    </div>

                    <div className="card-meta">
                      <span>PM: <a href={`/projects/${ref}/members`} className="pm-link">
                        {(p as any).pm_name ?? "Unassigned"}
                      </a></span>
                      <span className="meta-dot" />
                      <span>Created {formatDateLong(p.created_at)}</span>
                      {roleMap[p.id] && (
                        <>
                          <span className="meta-dot" />
                          <span style={{ textTransform: "capitalize", color: "var(--text-3)" }}>{String(roleMap[p.id])}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── Timeline ── */}
                  <div className="card-timeline">
                    <div className="timeline-dates">
                      <span>{formatDateShort(p.start_date) ?? "—"}</span>
                      <span>{formatDateShort(p.finish_date) ?? "—"}</span>
                    </div>
                    <div className="timeline-track">
                      <div
                        className="timeline-fill"
                        style={{ width: `${timelineProgress}%`, background: timelineColor }}
                      />
                    </div>
                    <div className="timeline-label">
                      <span className={`days-badge ${daysCls}`}>{daysLabel}</span>
                    </div>
                  </div>

                  {/* ── Actions ── */}
                  <div className="card-actions">
                    <Link href={`/projects/${ref}`} className="act act-overview">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                      <span>Overview</span>
                    </Link>
                    <Link href={`/projects/${ref}/artifacts`} className="act">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2"/>
                        <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                      <span>Artifacts</span>
                    </Link>
                    <Link href={`/projects/${ref}/members`} className="act">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                        <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      <span>Members</span>
                    </Link>

                    <div className="v-line" />

                    <form action={setProjectStatus} style={{ display: "contents" }}>
                      <input type="hidden" name="project_id" value={p.id} />
                      <input type="hidden" name="status" value={isActive ? "closed" : "active"} />
                      <input type="hidden" name="next" value="/projects" />
                      <button type="submit" className={`act ${isActive ? "act-close" : "act-reopen"}`}>
                        {isActive ? "Close" : "Reopen"}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="empty">
              <div className="empty-icon">🌌</div>
              <div className="empty-title">
                {projects.length === 0 ? "No projects yet" : "Nothing matches your filters"}
              </div>
              <div className="empty-sub">
                {projects.length === 0
                  ? "Create your first project to get started."
                  : "Try a different search term or filter."}
              </div>
            </div>
          )}
        </div>

      </div>
    </>
  );
}