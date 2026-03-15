"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SwitcherProject = {
  id: string;
  title: string;
  project_code: string | null;
  colour: string | null;
};

type ProjectTab = {
  id: string;
  label: string;
  href: string;
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default function ProjectHeader({
  projectId,
  projectTitle,
  projectCode,
  projectColour,
  isActive,
  switcherProjects,
  tabs,
}: {
  projectId: string;
  projectTitle: string;
  projectCode: string | null;
  projectColour: string;
  isActive: boolean;
  switcherProjects: SwitcherProject[];
  tabs: ProjectTab[];
}) {
  const pathname = usePathname();

  function isActiveTab(tab: ProjectTab): boolean {
    // Overview tab: exact match only
    if (tab.href === `/projects/${projectId}`) {
      return pathname === `/projects/${projectId}`;
    }
    // All other tabs: prefix match
    return pathname.startsWith(tab.href);
  }

  return (
    <>
      <style>{`
        .project-shell-header {
          --accent: ${projectColour || "#22c55e"};
          --surface: #ffffff;
          --surface-2: #f6f8fa;
          --border: #e8ecf0;
          --border-2: #d0d7de;
          --text-1: #0d1117;
          --text-2: #57606a;
          --text-3: #8b949e;
          --r: 12px;
        }
        .project-shell-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r);
          margin-bottom: 20px;
        }
        .project-shell-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-2);
          text-decoration: none;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          transition: border-color 0.15s, background 0.15s, color 0.15s, box-shadow 0.15s;
        }
        .project-shell-back:hover {
          color: var(--text-1);
          background: var(--surface-2);
          border-color: var(--border-2);
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        }
        .project-shell-crumb-link {
          color: var(--text-3);
          text-decoration: none;
          transition: color 0.15s;
        }
        .project-shell-crumb-link:hover { color: var(--text-2); }
        .project-shell-title-link {
          color: inherit;
          text-decoration: none;
        }
        .project-shell-title-link:hover {
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .project-sw-wrap { position: relative; }
        .project-sw-trigger {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 7px 13px;
          border-radius: 9px;
          border: 1px solid var(--border);
          background: var(--surface);
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-2);
          transition: border-color 0.15s, box-shadow 0.15s;
          white-space: nowrap;
        }
        .project-sw-trigger:hover {
          border-color: var(--border-2);
          box-shadow: 0 1px 4px rgba(0,0,0,0.07);
        }
        .project-sw-dropdown {
          display: none;
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          width: 300px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r);
          box-shadow: 0 10px 40px rgba(0,0,0,0.13);
          z-index: 200;
          overflow: hidden;
        }
        .project-sw-wrap:focus-within .project-sw-dropdown { display: block; }
        .project-sw-search-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--surface-2);
        }
        .project-sw-search-row input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 13px;
          color: var(--text-1);
          background: transparent;
          font-family: inherit;
        }
        .project-sw-search-row input::placeholder { color: var(--text-3); }
        .project-sw-list {
          max-height: 260px;
          overflow-y: auto;
          padding: 6px;
        }
        .project-sw-item {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 8px 10px;
          border-radius: 8px;
          text-decoration: none;
          color: var(--text-1);
          font-size: 13px;
          font-weight: 500;
          transition: background 0.1s;
        }
        .project-sw-item:hover { background: var(--surface-2); }
        .project-sw-item.cur { background: #f0f6ff; font-weight: 700; }
        .project-sw-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .project-sw-code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          color: var(--text-3);
          margin-left: auto;
          padding-left: 8px;
        }
        .project-tab-link {
          padding: 11px 2px;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-2);
          text-decoration: none;
          border-bottom: 2px solid transparent;
          transition: color 0.15s, border-color 0.15s;
          white-space: nowrap;
        }
        .project-tab-link:hover { color: var(--text-1); }
        .project-tab-link.active {
          color: var(--text-1);
          border-bottom-color: var(--text-1);
          font-weight: 600;
        }
      `}</style>

      <div className="project-shell-header">
        {/* Breadcrumb + switcher row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Link href="/projects" className="project-shell-back" aria-label="Back to projects">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </Link>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>
              <Link href="/projects" className="project-shell-crumb-link">Projects</Link>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <Link href={`/projects/${projectId}`} className="project-shell-crumb-link" style={{ color: "var(--text-1)", fontWeight: 600 }}>
                {projectTitle}
              </Link>
            </div>
          </div>

          {/* Project switcher */}
          <div className="project-sw-wrap" tabIndex={0} style={{ outline: "none" }}>
            <button className="project-sw-trigger" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M4 6h16M4 12h16M4 18h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Switch project
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div className="project-sw-dropdown">
              <div className="project-sw-search-row">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="8" stroke="var(--text-3)" strokeWidth="2"/>
                  <path d="m21 21-4.35-4.35" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <input
                  placeholder="Search projects"
                  autoComplete="off"
                  onChange={(e) => {
                    const q = e.target.value.toLowerCase();
                    document.querySelectorAll<HTMLElement>(".project-sw-item").forEach((el) => {
                      el.style.display = (el.textContent ?? "").toLowerCase().includes(q) ? "" : "none";
                    });
                  }}
                />
              </div>
              <div className="project-sw-list">
                {switcherProjects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className={`project-sw-item${p.id === projectId ? " cur" : ""}`}
                  >
                    <span className="project-sw-dot" style={{ background: safeStr(p.colour ?? "#22c55e") }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.title}
                    </span>
                    {p.project_code && <span className="project-sw-code">{p.project_code}</span>}
                  </Link>
                ))}
                {switcherProjects.length === 0 && (
                  <div style={{ padding: "16px", textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
                    No projects found
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Header card: title + tabs */}
        <div className="project-shell-card">
          <div style={{ padding: "22px 28px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: projectColour || "#22c55e",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", letterSpacing: "-0.3px", margin: 0 }}>
                <Link href={`/projects/${projectId}`} className="project-shell-title-link">
                  {projectTitle}
                </Link>
              </h1>
              {projectCode && (
                <span
                  style={{
                    padding: "2px 9px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    background: "#f6f8fa",
                    color: "var(--text-3)",
                    border: "1px solid var(--border)",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {projectCode}
                </span>
              )}
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  background: isActive ? "#dcfce7" : "#f1f5f9",
                  color: isActive ? "#15803d" : "var(--text-3)",
                }}
              >
                {isActive ? "Active" : "Closed"}
              </span>
            </div>
          </div>

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 22, padding: "0 28px", borderTop: "1px solid var(--border)", overflowX: "auto" }}>
            {tabs.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                className={`project-tab-link${isActiveTab(t) ? " active" : ""}`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}