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
  pm_name: string | null;
  health?: number | null;
  rag?: "G" | "A" | "R" | null;
};

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return d; }
}
function formatDateShort(d: string | null | undefined) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  catch { return d; }
}
function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  try { return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000); }
  catch { return null; }
}
function projectRef(p: Project) { return p.id; }
function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }

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
  searchParams?: Promise<{ filter?: string; sort?: string; q?: string; debug?: string }>;
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

    // Try to get RAG scores
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
      title: String(p.title ?? "Untitled project"),
      project_code: p.project_code ?? null,
      colour: p.colour ?? null,
      status: p.status ?? null,
      resource_status: p.resource_status ?? null,
      start_date: p.start_date ?? null,
      finish_date: p.finish_date ?? null,
      created_at: String(p.created_at),
      pm_name: null,
      health: ragMap.get(p.id)?.health ?? null,
      rag: (ragMap.get(p.id)?.rag as any) ?? null,
    }));
  }

  const sp = (await searchParams) ?? {};
  const filter = (sp.filter ?? "Active").trim();
  const sortMode = (sp.sort ?? "Newest").trim();
  const query = (sp.q ?? "").trim().toLowerCase();

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
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --ink:       #0a0e17;
          --ink-2:     #3d4454;
          --ink-3:     #7c8494;
          --surface:   #ffffff;
          --surface-2: #f5f7fa;
          --border:    #e4e8ef;
          --border-2:  #cdd3de;
          --green:     #16a34a;
          --green-bg:  #dcfce7;
          --amber:     #d97706;
          --amber-bg:  #fef3c7;
          --red:       #dc2626;
          --red-bg:    #fee2e2;
          --blue:      #2563eb;
          --blue-bg:   #eff6ff;
          --teal:      #0d9488;
          --teal-bg:   #f0fdfa;
        }

        body { font-family: 'Plus Jakarta Sans', sans-serif; background: var(--surface-2); color: var(--ink); }

        /* ── Hero banner ── */
        .hero {
          background: linear-gradient(135deg, #0a0e17 0%, #141b2e 50%, #0d1829 100%);
          padding: 40px 48px 0;
          position: relative; overflow: hidden;
        }
        .hero::before {
          content: '';
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse 60% 50% at 80% 20%, rgba(13,148,136,0.12) 0%, transparent 60%),
            radial-gradient(ellipse 40% 60% at 10% 80%, rgba(37,99,235,0.08) 0%, transparent 60%);
          pointer-events: none;
        }
        .hero-grid {
          position: absolute; inset: 0; opacity: 0.04;
          background-image: linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px);
          background-size: 40px 40px;
          pointer-events: none;
        }

        /* ── Stats strip ── */
        .stat-strip { display: flex; gap: 0; margin-bottom: 32px; position: relative; z-index: 1; }
        .stat-pill {
          display: flex; align-items: center; gap: 10px;
          padding: 16px 24px; border-right: 1px solid rgba(255,255,255,0.08);
        }
        .stat-pill:last-child { border-right: none; }
        .stat-pill-val { font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; line-height: 1; }
        .stat-pill-lbl { font-size: 12px; color: rgba(255,255,255,0.45); font-weight: 500; margin-top: 2px; }
        .stat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        /* ── Hero title ── */
        .hero-title { font-size: 32px; font-weight: 800; color: #fff; letter-spacing: -0.5px; margin-bottom: 6px; position: relative; z-index: 1; }
        .hero-sub   { font-size: 14px; color: rgba(255,255,255,0.45); margin-bottom: 28px; position: relative; z-index: 1; }

        /* ── Toolbar ── */
        .toolbar {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          background: rgba(255,255,255,0.04); border-top: 1px solid rgba(255,255,255,0.07);
          padding: 14px 48px; position: relative; z-index: 1;
        }
        .filter-tab {
          padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
          text-decoration: none; cursor: pointer; border: 1px solid transparent;
          color: rgba(255,255,255,0.5); transition: all 0.15s; white-space: nowrap;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .filter-tab:hover  { color: rgba(255,255,255,0.8); background: rgba(255,255,255,0.07); }
        .filter-tab.active { color: #ffffff; background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.15); }
        .search-box {
          display: flex; align-items: center; gap: 8px;
          background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 9px; padding: 7px 13px; flex: 1; max-width: 320px;
          transition: border-color 0.15s, background 0.15s;
        }
        .search-box:focus-within { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); }
        .search-box input {
          border: none; outline: none; background: transparent; font-size: 13px;
          color: #fff; font-family: 'Plus Jakarta Sans', sans-serif; width: 100%;
        }
        .search-box input::placeholder { color: rgba(255,255,255,0.35); }
        .sort-tab {
          padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600;
          text-decoration: none; color: rgba(255,255,255,0.45); border: 1px solid transparent;
          transition: all 0.15s; white-space: nowrap; font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .sort-tab:hover  { color: rgba(255,255,255,0.7); }
        .sort-tab.active { color: #fff; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.15); }
        .new-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 16px; border-radius: 9px; font-size: 13px; font-weight: 700;
          background: var(--teal); color: white; text-decoration: none; border: none;
          cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif;
          transition: opacity 0.15s; white-space: nowrap; margin-left: auto;
        }
        .new-btn:hover { opacity: 0.88; }

        /* ── Content area ── */
        .content { padding: 28px 48px 64px; }
        .count-label { font-size: 12px; font-weight: 600; color: var(--ink-3); margin-bottom: 16px; letter-spacing: 0.04em; text-transform: uppercase; }

        /* ── Project card ── */
        .project-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 14px; padding: 0;
          transition: box-shadow 0.2s, border-color 0.2s, transform 0.2s;
          overflow: hidden; position: relative;
          animation: fadeUp 0.35s ease both;
        }
        .project-card:hover {
          box-shadow: 0 8px 32px rgba(0,0,0,0.1);
          border-color: var(--border-2);
          transform: translateY(-1px);
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .card-accent { width: 4px; position: absolute; left: 0; top: 0; bottom: 0; border-radius: 14px 0 0 14px; }
        .card-inner  { padding: 20px 20px 20px 24px; display: flex; align-items: center; gap: 16px; }

        /* ── Health ring ── */
        .health-ring { flex-shrink: 0; position: relative; width: 52px; height: 52px; }
        .health-ring svg { transform: rotate(-90deg); }
        .health-ring-val {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 800; letter-spacing: -0.3px;
        }

        /* ── Card body ── */
        .card-body { flex: 1; min-width: 0; }
        .card-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }
        .card-title {
          font-size: 15px; font-weight: 700; color: var(--ink); text-decoration: none;
          transition: color 0.15s;
        }
        .card-title:hover { color: var(--teal); }
        .code-badge {
          font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 500;
          padding: 2px 7px; border-radius: 5px; background: var(--surface-2);
          color: var(--ink-3); border: 1px solid var(--border); letter-spacing: 0.02em;
        }
        .status-badge {
          font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
        }
        .card-meta { font-size: 12px; color: var(--ink-3); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .meta-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--border-2); flex-shrink: 0; }

        /* ── Progress bar ── */
        .progress-wrap { margin-top: 10px; }
        .progress-track { height: 4px; background: var(--surface-2); border-radius: 99px; overflow: hidden; }
        .progress-fill  { height: 100%; border-radius: 99px; transition: width 0.6s cubic-bezier(0.16,1,0.3,1); }

        /* ── Date range ── */
        .date-range {
          display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
          flex-shrink: 0; min-width: 120px;
        }
        .date-range-label { font-size: 11px; color: var(--ink-3); font-weight: 500; text-align: right; }
        .date-range-val   { font-size: 12px; color: var(--ink-2); font-weight: 600; text-align: right; font-family: 'JetBrains Mono', monospace; }
        .days-chip {
          font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
        }

        /* ── Actions ── */
        .card-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }
        .act-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 6px 11px; border-radius: 8px; font-size: 12px; font-weight: 600;
          text-decoration: none; border: 1px solid var(--border); color: var(--ink-2);
          background: var(--surface); transition: all 0.15s; white-space: nowrap;
          font-family: 'Plus Jakarta Sans', sans-serif; cursor: pointer;
        }
        .act-btn:hover { background: var(--surface-2); border-color: var(--border-2); color: var(--ink); }
        .act-btn.close { background: #fffbeb; border-color: #fde68a; color: #92400e; }
        .act-btn.close:hover { background: #fef3c7; }
        .act-btn.reopen { color: var(--ink-2); }
        .divider { height: 16px; width: 1px; background: var(--border); flex-shrink: 0; }

        /* ── Empty state ── */
        .empty { text-align: center; padding: 72px 0; color: var(--ink-3); }
        .empty-icon { font-size: 48px; margin-bottom: 12px; }
        .empty-title { font-size: 16px; font-weight: 700; color: var(--ink-2); margin-bottom: 6px; }
        .empty-sub   { font-size: 13px; }

        /* ── Pipeline badge ── */
        .pipeline-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; background: rgba(124,58,237,0.08); color: #7c3aed; }

        /* ── Hidden class for JS search ── */
        .js-hidden { display: none !important; }

        @media (max-width: 900px) {
          .hero        { padding: 28px 20px 0; }
          .toolbar     { padding: 12px 20px; }
          .content     { padding: 20px 20px 48px; }
          .date-range  { display: none; }
          .card-actions { gap: 4px; }
          .stat-strip  { flex-wrap: wrap; gap: 0; }
        }
        @media (max-width: 600px) {
          .act-btn span { display: none; }
          .card-inner  { gap: 10px; padding: 14px 14px 14px 18px; }
        }
      `}</style>

      {/* Live search JS */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          function init(){
            var input = document.getElementById('live-search');
            if(!input) return;
            input.addEventListener('input', function(){
              var q = this.value.toLowerCase().trim();
              document.querySelectorAll('.project-card[data-search]').forEach(function(el){
                if(!q || el.dataset.search.includes(q)) el.classList.remove('js-hidden');
                else el.classList.add('js-hidden');
              });
              var vis = document.querySelectorAll('.project-card:not(.js-hidden)').length;
              var lbl = document.getElementById('count-label');
              if(lbl) lbl.textContent = vis + ' project' + (vis !== 1 ? 's' : '');
            });
          }
          if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
          else init();
        })();
      `}} />

      <main>
        {/* ── HERO ── */}
        <div className="hero">
          <div className="hero-grid" />

          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div className="hero-title">Projects</div>
              <div className="hero-sub">Your portfolio command centre — monitor health, manage governance.</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 4 }}>
              <Link
                href="/artifacts"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600, textDecoration: "none", background: "rgba(255,255,255,0.05)", transition: "all 0.15s" }}
              >
                Global artifacts
              </Link>
              <CreateProjectModal activeOrgId={activeOrgId ?? ""} userId={user.id} />
            </div>
          </div>

          {/* Stats strip */}
          <div className="stat-strip">
            <div className="stat-pill">
              <div>
                <div className="stat-pill-val">{projects.length}</div>
                <div className="stat-pill-lbl">Total projects</div>
              </div>
            </div>
            <div className="stat-pill">
              <div className="stat-dot" style={{ background: "#22c55e" }} />
              <div>
                <div className="stat-pill-val">{activeCt}</div>
                <div className="stat-pill-lbl">Active</div>
              </div>
            </div>
            <div className="stat-pill">
              <div className="stat-dot" style={{ background: "#94a3b8" }} />
              <div>
                <div className="stat-pill-val">{closedCt}</div>
                <div className="stat-pill-lbl">Closed</div>
              </div>
            </div>
            {atRiskCt > 0 && (
              <div className="stat-pill">
                <div className="stat-dot" style={{ background: "#ef4444" }} />
                <div>
                  <div className="stat-pill-val" style={{ color: "#fca5a5" }}>{atRiskCt}</div>
                  <div className="stat-pill-lbl">At risk</div>
                </div>
              </div>
            )}
            {healthAvg != null && (
              <div className="stat-pill">
                <div>
                  <div className="stat-pill-val" style={{ color: healthAvg >= 85 ? "#86efac" : healthAvg >= 70 ? "#fcd34d" : "#fca5a5" }}>
                    {healthAvg}%
                  </div>
                  <div className="stat-pill-lbl">Avg health</div>
                </div>
              </div>
            )}
          </div>

          {/* Toolbar */}
          <div className="toolbar">
            <div style={{ display: "flex", gap: 4 }}>
              {["Active", "Closed", "All"].map((f) => (
                <Link
                  key={f}
                  href={`/projects?filter=${f}&sort=${sortMode}&q=${encodeURIComponent(query)}`}
                  className={`filter-tab${filter === f ? " active" : ""}`}
                >
                  {f}
                  <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.6 }}>
                    {f === "Active" ? activeCt : f === "Closed" ? closedCt : projects.length}
                  </span>
                </Link>
              ))}
            </div>

            <div className="search-box">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="rgba(255,255,255,0.4)" strokeWidth="2"/>
                <path d="m21 21-4.35-4.35" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <input
                id="live-search"
                placeholder="Search projects…"
                defaultValue={query}
                autoComplete="off"
              />
            </div>

            <div style={{ display: "flex", gap: 2 }}>
              {["Newest", "A-Z"].map((s) => (
                <Link
                  key={s}
                  href={`/projects?filter=${filter}&sort=${s}&q=${encodeURIComponent(query)}`}
                  className={`sort-tab${sortMode === s ? " active" : ""}`}
                >
                  {s}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── CONTENT ── */}
        <div className="content">
          <div className="count-label" id="count-label">
            {filtered.length} project{filtered.length !== 1 ? "s" : ""}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((p, i) => {
              const ref      = projectRef(p);
              const colour   = p.colour ?? "#0d9488";
              const isActive = (p.status ?? "active").toLowerCase() !== "closed";
              const health   = p.health;
              const rag      = p.rag;
              const daysLeft = daysUntil(p.finish_date);

              // Health ring calc
              const ringRadius = 20;
              const ringCirc   = 2 * Math.PI * ringRadius;
              const ringOffset = health != null ? ringCirc * (1 - health / 100) : ringCirc;
              const ringColor  = health == null ? "#e4e8ef"
                : health >= 85 ? "#16a34a"
                : health >= 70 ? "#d97706"
                : "#dc2626";

              const healthBg = health == null ? "#f5f7fa"
                : health >= 85 ? "#dcfce7"
                : health >= 70 ? "#fef3c7"
                : "#fee2e2";

              const statusBg    = isActive ? "#dcfce7" : "#f1f5f9";
              const statusColor = isActive ? "#15803d" : "#64748b";

              const daysColor = daysLeft == null ? "#64748b"
                : daysLeft < 0  ? "#dc2626"
                : daysLeft < 30 ? "#d97706"
                : "#16a34a";
              const daysBg = daysLeft == null ? "#f1f5f9"
                : daysLeft < 0  ? "#fee2e2"
                : daysLeft < 30 ? "#fef3c7"
                : "#dcfce7";

              const searchAttr = `${p.title} ${p.project_code ?? ""} ${p.pm_name ?? ""}`.toLowerCase();

              return (
                <div
                  key={p.id}
                  className="project-card"
                  data-search={searchAttr}
                  style={{ animationDelay: `${i * 0.04}s` }}
                >
                  <div className="card-accent" style={{ background: colour }} />
                  <div className="card-inner">
                    {/* Health ring */}
                    <div className="health-ring">
                      <svg width="52" height="52" viewBox="0 0 52 52">
                        <circle cx="26" cy="26" r={ringRadius} fill="none" stroke="#f0f2f5" strokeWidth="5" />
                        <circle
                          cx="26" cy="26" r={ringRadius} fill="none"
                          stroke={ringColor} strokeWidth="5"
                          strokeDasharray={ringCirc}
                          strokeDashoffset={ringOffset}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="health-ring-val" style={{ color: ringColor }}>
                        {health != null ? `${health}` : "—"}
                      </div>
                    </div>

                    {/* Main content */}
                    <div className="card-body">
                      <div className="card-title-row">
                        <Link href={`/projects/${ref}`} className="card-title">
                          {p.title}
                        </Link>
                        {p.project_code && (
                          <span className="code-badge">{p.project_code}</span>
                        )}
                        <span className="status-badge" style={{ background: statusBg, color: statusColor }}>
                          {isActive ? "Active" : "Closed"}
                        </span>
                        {p.resource_status === "pipeline" && (
                          <span className="pipeline-badge">Pipeline</span>
                        )}
                      </div>

                      <div className="card-meta">
                        <span>
                          PM: <span style={{ color: "#2563eb", fontWeight: 600 }}>{p.pm_name ?? "Unassigned"}</span>
                        </span>
                        <span className="meta-sep" />
                        <span>Created {formatDate(p.created_at)}</span>
                        {roleMap[p.id] && (
                          <>
                            <span className="meta-sep" />
                            <span style={{ textTransform: "capitalize" }}>{String(roleMap[p.id])}</span>
                          </>
                        )}
                        {p.start_date && p.finish_date && (
                          <>
                            <span className="meta-sep" />
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.5, flexShrink: 0 }}>
                                <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                                <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              </svg>
                              {formatDateShort(p.start_date)} — {formatDateShort(p.finish_date)}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Health bar */}
                      {health != null && (
                        <div className="progress-wrap">
                          <div className="progress-track">
                            <div
                              className="progress-fill"
                              style={{
                                width: `${health}%`,
                                background: ringColor,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Date / days remaining */}
                    <div className="date-range">
                      {daysLeft != null && (
                        <>
                          <span className="days-chip" style={{ background: daysBg, color: daysColor }}>
                            {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                          </span>
                          <span className="date-range-label">Due {formatDateShort(p.finish_date)}</span>
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="card-actions">
                      <Link href={`/projects/${ref}`} className="act-btn">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/>
                          <path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <span>Overview</span>
                      </Link>
                      <Link href={`/projects/${ref}/artifacts`} className="act-btn">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2"/>
                          <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <span>Artifacts</span>
                      </Link>
                      <Link href={`/projects/${ref}/members`} className="act-btn">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                          <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <span>Members</span>
                      </Link>

                      <div className="divider" />

                      <form action={setProjectStatus} style={{ display: "contents" }}>
                        <input type="hidden" name="project_id" value={p.id} />
                        <input type="hidden" name="status" value={isActive ? "closed" : "active"} />
                        <input type="hidden" name="next" value="/projects" />
                        <button type="submit" className={`act-btn ${isActive ? "close" : "reopen"}`}>
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
                <div className="empty-icon">📂</div>
                <div className="empty-title">
                  {projects.length === 0 ? "No projects yet" : "No projects match your filters"}
                </div>
                <div className="empty-sub">
                  {projects.length === 0 ? "Create your first project to get started." : "Try adjusting your search or filters."}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}