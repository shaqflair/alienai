"use client";
import { useState, useTransition, useMemo } from "react";
import type { OrgPerson } from "../page";

/* =============================================================================
   HELPERS
============================================================================= */
function Avatar({ name, avatarUrl, size = 36 }: {
  name: string; avatarUrl: string | null; size?: number;
}) {
  const hue = Math.abs([...name].reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  if (avatarUrl) return (
    <img src={avatarUrl} alt={name} style={{
      width: size, height: size, borderRadius: "50%",
      objectFit: "cover", border: "2px solid #e2e8f0", flexShrink: 0,
    }} />
  );
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: `hsl(${hue},55%,88%)`, color: `hsl(${hue},55%,30%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 800, flexShrink: 0,
      border: "2px solid white",
    }}>{name[0]?.toUpperCase() ?? "?"}</div>
  );
}

const ROLE_STYLE: Record<string, { bg: string; color: string }> = {
  owner:  { bg: "rgba(124,58,237,0.1)",  color: "#7c3aed" },
  admin:  { bg: "rgba(14,116,144,0.1)",  color: "#0e7490" },
  member: { bg: "rgba(100,116,139,0.08)", color: "#64748b" },
};

/* =============================================================================
   TREE BUILDER
============================================================================= */
type TreeNode = OrgPerson & { reports: TreeNode[] };

function buildTree(people: OrgPerson[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(
    people.map(p => [p.userId, { ...p, reports: [] }])
  );

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.lineManagerId && byId.has(node.lineManagerId)) {
      byId.get(node.lineManagerId)!.reports.push(node);
    } else {
      roots.push(node);
    }
  }

  function sortNode(n: TreeNode) {
    n.reports.sort((a, b) => a.fullName.localeCompare(b.fullName));
    n.reports.forEach(sortNode);
  }
  roots.sort((a, b) => a.fullName.localeCompare(b.fullName));
  roots.forEach(sortNode);
  return roots;
}

/* =============================================================================
   PERSON CARD
============================================================================= */
function PersonCard({
  person, people, isAdmin, onManagerChange, selectedId, onSelect,
}: {
  person:          OrgPerson;
  people:          OrgPerson[];
  isAdmin:          boolean;
  onManagerChange: (targetId: string, managerId: string | null) => void;
  selectedId:      string | null;
  onSelect:        (id: string) => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [saving,  startSave]    = useTransition();
  const [error,   setError]     = useState<string | null>(null);
  const isSelected = selectedId === person.userId;

  const roleMeta = ROLE_STYLE[person.role] ?? ROLE_STYLE.member;
  const managerName = person.lineManagerId
    ? people.find(p => p.userId === person.lineManagerId)?.fullName ?? "Unknown"
    : null;

  const eligible = people.filter(p => p.userId !== person.userId);

  function handleManagerSave(newManagerId: string | null) {
    setError(null);
    startSave(async () => {
      try {
        const res = await fetch("/api/line-manager", {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            target_user_id:  person.userId,
            manager_user_id: newManagerId,
          }),
          cache: "no-store",
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error);
        onManagerChange(person.userId, newManagerId);
        setEditing(false);
      } catch (e: any) {
        setError(e?.message ?? "Failed to update");
      }
    });
  }

  return (
    <div
      onClick={() => onSelect(person.userId)}
      style={{
        background: isSelected ? "rgba(14,116,144,0.06)" : "white",
        border: `1.5px solid ${isSelected ? "#0e7490" : "#e2e8f0"}`,
        borderRadius: "12px", padding: "12px 14px",
        cursor: "pointer", transition: "all 0.15s",
        minWidth: "200px", maxWidth: "240px",
        boxShadow: isSelected ? "0 4px 16px rgba(14,116,144,0.15)" : "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <Avatar name={person.fullName} avatarUrl={person.avatarUrl} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a", lineHeight: 1.2, marginBottom: "2px" }}>
            {person.fullName}
          </div>
          {person.jobTitle && (
            <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "3px" }}>
              {person.jobTitle}
            </div>
          )}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            <span style={{
              fontSize: "9px", fontWeight: 800, padding: "1px 5px",
              borderRadius: "4px", textTransform: "capitalize",
              background: roleMeta.bg, color: roleMeta.color,
            }}>{person.role}</span>
            {person.department && (
              <span style={{
                fontSize: "9px", fontWeight: 600, padding: "1px 5px",
                borderRadius: "4px", background: "#f1f5f9", color: "#64748b",
              }}>{person.department}</span>
            )}
          </div>
        </div>
      </div>

      {isSelected && (
        <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #f1f5f9", fontSize: "11px" }}>
          {error && <div style={{ color: "#dc2626", marginBottom: "6px", fontSize: "10px" }}>{error}</div>}
          <div style={{ color: "#94a3b8", marginBottom: "4px" }}>
            Reports to: <strong style={{ color: "#0f172a" }}>{managerName ?? "No manager"}</strong>
          </div>
          {isAdmin && !editing && (
            <button type="button" onClick={e => { e.stopPropagation(); setEditing(true); }}
              style={{ fontSize: "10px", fontWeight: 700, color: "#0e7490", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
              Change manager
            </button>
          )}
          {isAdmin && editing && (
            <div style={{ marginTop: "6px" }} onClick={e => e.stopPropagation()}>
              <select defaultValue={person.lineManagerId ?? ""} onChange={e => handleManagerSave(e.target.value || null)} disabled={saving}
                style={{ width: "100%", padding: "5px 8px", borderRadius: "7px", border: "1.5px solid #e2e8f0", fontSize: "11px", fontFamily: "inherit", outline: "none", cursor: "pointer", color: "#0f172a", background: "white" }}>
                <option value="">-- No manager --</option>
                {eligible.map(p => <option key={p.userId} value={p.userId}>{p.fullName}</option>)}
              </select>
              <button type="button" onClick={() => setEditing(false)} style={{ marginTop: "4px", fontSize: "10px", color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   TREE NODE (recursive)
============================================================================= */
function TreeNodeComp({
  node, depth, people, isAdmin, onManagerChange, selectedId, onSelect,
}: {
  node:             TreeNode;
  depth:            number;
  people:           OrgPerson[];
  isAdmin:           boolean;
  onManagerChange: (targetId: string, managerId: string | null) => void;
  selectedId:       string | null;
  onSelect:         (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasReports = node.reports.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0" }}>
        {depth > 0 && (
          <div style={{ width: "32px", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: "100%", height: "28px", borderBottom: "2px solid #e2e8f0", borderLeft: "2px solid #e2e8f0", borderBottomLeftRadius: "8px" }} />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <PersonCard person={node} people={people} isAdmin={isAdmin} onManagerChange={onManagerChange} selectedId={selectedId} onSelect={onSelect} />
            {hasReports && (
              <button type="button" onClick={() => setCollapsed(c => !c)}
                style={{ width: 22, height: 22, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "white", fontSize: "11px", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {collapsed ? "+" : "-"}
              </button>
            )}
          </div>
          {hasReports && !collapsed && (
            <div style={{ marginLeft: "32px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px", paddingLeft: "8px", borderLeft: "2px solid #e2e8f0" }}>
              {node.reports.map(child => (
                <TreeNodeComp key={child.userId} node={child} depth={depth + 1} people={people} isAdmin={isAdmin} onManagerChange={onManagerChange} selectedId={selectedId} onSelect={onSelect} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   DIRECT REPORTS SIDEBAR
============================================================================= */
function DirectReportsSidebar({ person, people, myUserId }: {
  person:    OrgPerson;
  people:    OrgPerson[];
  myUserId:  string;
}) {
  const directReports = people.filter(p => p.lineManagerId === person.userId);
  const capacityUrl   = `/heatmap?manager=${person.userId}`;
  const timesheetUrl  = `/timesheet/review?manager=${person.userId}`;

  return (
    <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: "280px", background: "white", borderLeft: "1.5px solid #e2e8f0", overflowY: "auto", padding: "20px 16px", zIndex: 50, boxShadow: "-4px 0 24px rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <Avatar name={person.fullName} avatarUrl={person.avatarUrl} size={40} />
        <div>
          <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>{person.fullName}</div>
          <div style={{ fontSize: "11px", color: "#94a3b8" }}>{person.jobTitle ?? person.role}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
        <a href={capacityUrl} style={sidebarLinkStyle}>View capacity (manager filter)</a>
        {person.userId === myUserId && <a href={timesheetUrl} style={sidebarLinkStyle}>Review direct report timesheets</a>}
      </div>
      <div style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
        Direct reports ({directReports.length})
      </div>
      {directReports.length === 0 ? <div style={{ fontSize: "12px", color: "#94a3b8" }}>No direct reports</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {directReports.map(dr => (
            <div key={dr.userId} style={{ display: "flex", gap: "8px", alignItems: "center", padding: "8px 10px", borderRadius: "9px", border: "1.5px solid #f1f5f9", background: "#fafafa" }}>
              <Avatar name={dr.fullName} avatarUrl={dr.avatarUrl} size={28} />
              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>{dr.fullName}</div>
                {dr.jobTitle && <div style={{ fontSize: "10px", color: "#94a3b8" }}>{dr.jobTitle}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const sidebarLinkStyle: React.CSSProperties = {
  display: "block", padding: "8px 12px", borderRadius: "8px", border: "1.5px solid rgba(14,116,144,0.2)", background: "rgba(14,116,144,0.05)", color: "#0e7490", fontSize: "11px", fontWeight: 700, textDecoration: "none",
};

/* =============================================================================
   MAIN CLIENT
============================================================================= */
export default function OrgChartClient({
  people: initial, myUserId, isAdmin, organisationId,
}: {
  people:          OrgPerson[];
  myUserId:        string;
  isAdmin:          boolean;
  organisationId:  string;
}) {
  const [people,     setPeople]     = useState<OrgPerson[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search,     setSearch]     = useState("");
  const [view,        setView]       = useState<"tree" | "list">("tree");

  const selectedPerson = selectedId ? people.find(p => p.userId === selectedId) ?? null : null;

  function handleManagerChange(targetId: string, newManagerId: string | null) {
    setPeople(ps => ps.map(p => p.userId === targetId ? { ...p, lineManagerId: newManagerId } : p));
  }

  const filtered = search ? people.filter(p => p.fullName.toLowerCase().includes(search.toLowerCase()) || (p.jobTitle ?? "").toLowerCase().includes(search.toLowerCase()) || (p.department ?? "").toLowerCase().includes(search.toLowerCase())) : people;
  const tree = useMemo(() => buildTree(people), [people]);

  const deptGroups = useMemo(() => {
    const map = new Map<string, OrgPerson[]>();
    for (const p of filtered) {
      const dept = p.department ?? "No department";
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(p);
    }
    return map;
  }, [filtered]);

  const totalReports = people.filter(p => p.lineManagerId === myUserId).length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
        @keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', sans-serif", paddingRight: selectedPerson ? "296px" : "0", transition: "padding-right 0.2s ease" }}>
        <div style={{ background: "white", borderBottom: "1.5px solid #e2e8f0", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a", margin: "0 0 2px", letterSpacing: "-0.2px" }}>Org Chart</h1>
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>
              {people.length} people &middot; {totalReports > 0 ? `${totalReports} report to you` : "No direct reports"}
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people..."
              style={{ padding: "7px 12px", borderRadius: "8px", border: "1.5px solid #e2e8f0", fontSize: "12px", fontFamily: "inherit", outline: "none", color: "#0f172a", width: "180px" }} />
            {(["tree", "list"] as const).map(v => (
              <button key={v} type="button" onClick={() => setView(v)} style={{ padding: "7px 14px", borderRadius: "8px", border: "1.5px solid", borderColor: view === v ? "#0e7490" : "#e2e8f0", background: view === v ? "rgba(14,116,144,0.08)" : "white", color: view === v ? "#0e7490" : "#64748b", fontSize: "11px", fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>{v}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: "24px 28px", overflowX: "auto" }}>
          {view === "tree" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {tree.map(root => (
                <TreeNodeComp key={root.userId} node={root} depth={0} people={people} isAdmin={isAdmin} onManagerChange={handleManagerChange} selectedId={selectedId} onSelect={id => setSelectedId(prev => prev === id ? null : id)} />
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {[...deptGroups.entries()].map(([dept, deptPeople]) => (
                <div key={dept}>
                  <div style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>{dept} ({deptPeople.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                    {deptPeople.map(p => <PersonCard key={p.userId} person={p} people={people} isAdmin={isAdmin} onManagerChange={handleManagerChange} selectedId={selectedId} onSelect={id => setSelectedId(prev => prev === id ? null : id)} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedPerson && (
        <div style={{ animation: "slideIn 0.2s ease" }}>
          <DirectReportsSidebar person={selectedPerson} people={people} myUserId={myUserId} />
        </div>
      )}
    </>
  );
}
