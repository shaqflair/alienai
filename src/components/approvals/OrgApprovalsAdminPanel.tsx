"use client";

import React, { useEffect, useMemo, useState } from "react";
import RulesPanel from "./RulesPanel";

const ARTIFACTS = [
  { key: "project_charter",        label: "Project Charter" },
  { key: "change",                 label: "Change Request" },
  { key: "project_closure_report", label: "Project Closure Report" },
] as const;

type ArtifactKey = (typeof ARTIFACTS)[number]["key"];

type ApproverCandidate = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  department: string | null;
  job_title: string | null;
  role: string | null;
  label: string;
};

/* -- Helpers --------------------------------------------------------------- */

function pill(active: boolean) {
  return [
    "px-3 py-1.5 text-sm transition-colors",
    active ? "bg-gray-100 font-semibold text-gray-900" : "bg-white hover:bg-gray-50 text-gray-700",
    "disabled:opacity-50",
  ].join(" ");
}

function clean(x: any) {
  const t = String(x ?? "").trim();
  return t || "";
}

function cleanOrgId(x: any) {
  const s = clean(x);
  return !s || s === "undefined" || s === "null" ? "" : s;
}

function badgeTone(kind: "shared" | "scoped" | "admin" | "readonly") {
  if (kind === "shared")   return "border border-sky-200 bg-sky-50 text-sky-700";
  if (kind === "scoped")   return "border border-violet-200 bg-violet-50 text-violet-700";
  if (kind === "admin")    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border border-amber-200 bg-amber-50 text-amber-700";
}

function ScopeBadge({ children, kind }: { children: React.ReactNode; kind: "shared" | "scoped" | "admin" | "readonly" }) {
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium " + badgeTone(kind)}>
      {children}
    </span>
  );
}

/* Shared class strings */
const inputCls  = "block border rounded-md px-2 py-1 text-sm text-gray-900 disabled:opacity-50";
const selectCls = "block border rounded-md px-2 py-1 text-sm text-gray-900 disabled:opacity-50";
const btnCls    = "border rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50";

/* -- Main panel ------------------------------------------------------------ */

export default function OrgApprovalsAdminPanel({
  organisationId,
  organisationName,
  isAdmin,
}: {
  organisationId: string;
  organisationName?: string;
  isAdmin: boolean;
}) {
  const orgId = cleanOrgId(organisationId);
  const [tab, setTab]                   = useState<"approvers" | "groups" | "rules">("rules");
  const [artifactType, setArtifactType] = useState<ArtifactKey>("project_charter");

  useEffect(() => {
    if (!orgId) return;
    const allowed = new Set<string>(ARTIFACTS.map((a) => a.key));
    if (!allowed.has(artifactType)) setArtifactType("project_charter");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const canEdit         = !!isAdmin;
  const selectedArtifact = ARTIFACTS.find((a) => a.key === artifactType) ?? ARTIFACTS[0];
  const scopeLabel       = tab === "approvers" ? "Shared across all artifact types" : "Scoped to " + selectedArtifact.label;

  return (
    <section className="rounded-xl border bg-white shadow-sm">
      <div className="p-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-base font-semibold text-gray-900">Organisation approvals</div>
            <ScopeBadge kind={tab === "approvers" ? "shared" : "scoped"}>{scopeLabel}</ScopeBadge>
          </div>
          <div className="mt-1 text-sm text-gray-600">
            Configure approvers, approval groups, and routing rules for governance control.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>
              Client:{" "}
              <span className="font-medium text-gray-700">{organisationName || "\u2014"}</span>
            </span>
            {canEdit
              ? <ScopeBadge kind="admin">Admin mode</ScopeBadge>
              : <ScopeBadge kind="readonly">Read-only</ScopeBadge>
            }
          </div>
          <div className="mt-3 text-xs text-gray-500">
            <span className="font-medium text-gray-700">Control-plane model:</span>{" "}
            Approvers are shared across the organisation. Groups and Rules decide which approvers apply to each artifact type.
          </div>
        </div>

        <div className="flex min-w-[220px] flex-col items-end gap-2">
          <label className="w-full">
            <span className="sr-only">Artifact type</span>
            <select
              className="w-full border rounded-md px-2 py-1.5 text-sm bg-white text-gray-900"
              value={artifactType}
              onChange={(e) => setArtifactType(e.target.value as ArtifactKey)}
              disabled={!orgId}
            >
              {ARTIFACTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
          <div className="inline-flex rounded-md border overflow-hidden bg-white">
            <button className={pill(tab === "rules")}    onClick={() => setTab("rules")}     type="button" disabled={!orgId}>Rules</button>
            <button className={pill(tab === "groups")}   onClick={() => setTab("groups")}    type="button" disabled={!orgId}>Groups</button>
            <button className={pill(tab === "approvers")} onClick={() => setTab("approvers")} type="button" disabled={!orgId}>Approvers</button>
          </div>
        </div>
      </div>

      <div className="border-t p-4">
        {!orgId ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Missing organisationId (got: <span className="font-mono">{String(organisationId)}</span>).
          </div>
        ) : tab === "approvers" ? (
          <ApproversTab orgId={orgId} canEdit={canEdit} selectedArtifactLabel={selectedArtifact.label} />
        ) : tab === "groups" ? (
          <GroupsTab orgId={orgId} artifactType={artifactType} artifactLabel={selectedArtifact.label} canEdit={canEdit} />
        ) : (
          <RulesPanel orgId={orgId} artifactType={artifactType} canEdit={canEdit} />
        )}
      </div>
    </section>
  );
}

/* -- Approvers Tab --------------------------------------------------------- */

function ApproversTab({ orgId, canEdit, selectedArtifactLabel }: { orgId: string; canEdit: boolean; selectedArtifactLabel: string }) {
  const [q, setQ]                             = useState("");
  const [err, setErr]                         = useState("");
  const [loading, setLoading]                 = useState(false);
  const [approvers, setApprovers]             = useState<any[]>([]);
  const [candidateQuery, setCandidateQuery]   = useState("");
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidates, setCandidates]           = useState<ApproverCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [email, setEmail]                     = useState("");
  const [name, setName]                       = useState("");
  const [approverRole, setApproverRole]       = useState("");
  const [department, setDepartment]           = useState("");
  const [selectedUserId, setSelectedUserId]   = useState("");

  function resetForm() {
    setCandidateQuery(""); setCandidates([]); setSelectedCandidateId("");
    setSelectedUserId(""); setEmail(""); setName(""); setApproverRole(""); setDepartment("");
  }

  function applyCandidate(c: ApproverCandidate) {
    setSelectedCandidateId(c.user_id); setSelectedUserId(c.user_id);
    setEmail(c.email ?? ""); setName(c.full_name ?? "");
    setDepartment(c.department ?? ""); setApproverRole(c.job_title ?? c.role ?? "");
    setCandidateQuery(c.label || c.email || "");
  }

  async function load() {
    setErr(""); setLoading(true);
    try {
      const res  = await fetch(`/api/approvals/approvers?orgId=${encodeURIComponent(orgId)}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load approvers");
      setApprovers(json.approvers ?? []);
    } catch (e: any) { setErr(String(e?.message || e || "Error")); setApprovers([]); }
    finally { setLoading(false); }
  }

  async function loadCandidates(search: string) {
    const trimmed = search.trim();
    if (!trimmed) { setCandidates([]); setSelectedCandidateId(""); return; }
    setCandidatesLoading(true);
    try {
      const res  = await fetch(`/api/approvals/approver-candidates?orgId=${encodeURIComponent(orgId)}&q=${encodeURIComponent(trimmed)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load organisation members");
      const items: ApproverCandidate[] = json.candidates ?? [];
      setCandidates(items);
      setSelectedCandidateId((prev) => (prev && items.some((x) => String(x.user_id) === String(prev))) ? prev : "");
    } catch (e: any) { setErr(String(e?.message || e || "Error")); setCandidates([]); setSelectedCandidateId(""); }
    finally { setCandidatesLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orgId, q]);
  useEffect(() => {
    const h = window.setTimeout(() => loadCandidates(candidateQuery), 250);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line
  }, [candidateQuery, orgId]);

  async function add() {
    setErr("");
    const payload = { orgId, user_id: selectedUserId || null, email: email.trim() || null, name: name.trim() || null, approver_role: approverRole.trim() || null, department: department.trim() || null };
    if (!payload.user_id && !payload.email) { setErr("Select an organisation member or enter an email."); return; }
    try {
      const res  = await fetch("/api/approvals/approvers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed");
      resetForm(); await load();
    } catch (e: any) { setErr(String(e?.message || e || "Error")); }
  }

  async function removeById(id: string) {
    if (!window.confirm("Remove approver for this organisation?")) return;
    setErr("");
    try {
      const url = new URL("/api/approvals/approvers", window.location.origin);
      url.searchParams.set("orgId", orgId); url.searchParams.set("id", id);
      const res  = await fetch(url.toString(), { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed");
      await load();
    } catch (e: any) { setErr(String(e?.message || e || "Error")); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-sky-900">Organisation approver directory</div>
          <ScopeBadge kind="shared">Shared across all artifact types</ScopeBadge>
        </div>
        <div className="mt-1 text-sm text-sky-800">
          The people listed here are not tied directly to <span className="font-medium">{selectedArtifactLabel}</span>.
          Use <span className="font-medium">Groups</span> and <span className="font-medium">Rules</span> to decide which of these approvers are used for each artifact workflow.
        </div>
      </div>

      {err     && <div className="text-sm text-red-600">{err}</div>}
      {loading && <div className="text-sm text-gray-500">Loading...</div>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">
          Search approver directory
          <input className={inputCls + " w-[320px]"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="email / name / department / role" />
        </label>
        <button className={btnCls} type="button" onClick={load}>Refresh</button>
      </div>

      {canEdit && (
        <div className="border rounded-lg p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-gray-900">Add approver</div>
            <ScopeBadge kind="shared">Directory entry</ScopeBadge>
          </div>
          <div className="text-xs text-gray-500">Add a linked organisation member or create an external approver.</div>
          <div className="grid md:grid-cols-2 gap-2">
            <label className="text-xs text-gray-600 md:col-span-2">
              Search organisation members
              <input className={inputCls + " w-full"} value={candidateQuery}
                onChange={(e) => { setCandidateQuery(e.target.value); setSelectedCandidateId(""); setSelectedUserId(""); }}
                placeholder="Type name or email to pick an existing organisation member" />
            </label>
            <label className="text-xs text-gray-600 md:col-span-2">
              Matching organisation members
              <select className={selectCls + " w-full"} value={selectedCandidateId}
                onChange={(e) => { const id = e.target.value; setSelectedCandidateId(id); const found = candidates.find((c) => String(c.user_id) === String(id)); if (found) applyCandidate(found); }}>
                <option value="">{candidatesLoading ? "Loading members..." : candidates.length > 0 ? "Select a member" : candidateQuery.trim() ? "No matching members" : "Type above to search members"}</option>
                {candidates.map((c) => <option key={c.user_id} value={c.user_id}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Email
              <input className={inputCls} value={email} onChange={(e) => { setEmail(e.target.value); if (selectedUserId) { setSelectedUserId(""); setSelectedCandidateId(""); } }} placeholder="person@company.com" />
            </label>
            <label className="text-xs text-gray-600">
              Name
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional display name" />
            </label>
            <label className="text-xs text-gray-600">
              Approver role
              <input className={inputCls} value={approverRole} onChange={(e) => setApproverRole(e.target.value)} placeholder="Commercial / Delivery Director / CFO" />
            </label>
            <label className="text-xs text-gray-600">
              Department
              <input className={inputCls} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Finance / Legal / Commercial" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={btnCls} type="button" onClick={add}>Add approver</button>
            <button className={btnCls} type="button" onClick={resetForm}>Clear</button>
          </div>
          <div className="text-[11px] text-gray-500">Pick from organisation members for a linked approver, or type an external email manually.</div>
        </div>
      )}

      <div className="divide-y border rounded-lg">
        {approvers.length === 0
          ? <div className="p-3 text-sm text-gray-600">No organisation approvers yet.</div>
          : approvers.map((a) => (
            <div key={a.id} className="p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium text-gray-900 truncate">{a.label || a.email || a.name || a.id}</div>
                  <ScopeBadge kind={a.link_state === "linked" || a.user_id ? "shared" : "readonly"}>
                    {a.link_state === "linked" || a.user_id ? "Linked member" : "External"}
                  </ScopeBadge>
                </div>
                <div className="mt-1 text-xs text-gray-600 truncate">
                  {a.email     && <span className="mr-2">{a.email}</span>}
                  {a.department && <span className="mr-2">Dept: {a.department}</span>}
                  {a.approver_role && <span>Role: {a.approver_role}</span>}
                </div>
              </div>
              {canEdit && <button className={btnCls} type="button" onClick={() => removeById(a.id)}>Remove</button>}
            </div>
          ))
        }
      </div>
    </div>
  );
}

/* -- Groups Tab ------------------------------------------------------------ */

function GroupsTab({ orgId, artifactType, artifactLabel, canEdit }: { orgId: string; artifactType: string; artifactLabel: string; canEdit: boolean }) {
  const [err, setErr]       = useState("");
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [name, setName]     = useState("");
  const [selected, setSelected] = useState<string>("");

  async function load() {
    setErr(""); setLoading(true);
    try {
      const res  = await fetch(`/api/approvals/groups?orgId=${encodeURIComponent(orgId)}&artifactType=${encodeURIComponent(artifactType)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load groups");
      setGroups(json.groups ?? []);
      setSelected((prev) => prev || (json.groups?.[0]?.id ?? ""));
    } catch (e: any) { setErr(String(e?.message || e || "Error")); setGroups([]); setSelected(""); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orgId, artifactType]);
  useEffect(() => {
    if (!selected) return;
    if (!(groups ?? []).some((g: any) => String(g?.id) === String(selected))) setSelected(groups?.[0]?.id ?? "");
    // eslint-disable-next-line
  }, [groups.length]);

  async function createGroup() {
    if (!name.trim()) return;
    const res  = await fetch("/api/approvals/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, artifactType, name: name.trim() }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) { alert(json?.error || "Failed"); return; }
    setName(""); load();
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-violet-900">Artifact approval groups</div>
          <ScopeBadge kind="scoped">Scoped to {artifactLabel}</ScopeBadge>
        </div>
        <div className="mt-1 text-sm text-violet-800">
          These groups only apply to <span className="font-medium">{artifactLabel}</span>. Group members are selected from the shared organisation approver directory.
        </div>
      </div>

      {err     && <div className="text-sm text-red-600">{err}</div>}
      {loading && <div className="text-sm text-gray-500">Loading...</div>}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">
            New group name
            <input className={inputCls + " w-[360px]"} value={name} onChange={(e) => setName(e.target.value)} placeholder={"e.g. " + artifactLabel + " Executive Approvers"} />
          </label>
          <button className={btnCls} type="button" onClick={createGroup}>Create</button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <div className="border rounded-lg overflow-hidden">
          <div className="p-3 border-b text-sm font-semibold text-gray-900">Groups</div>
          <div className="divide-y">
            {groups.length === 0
              ? <div className="p-3 text-sm text-gray-600">No groups for this artifact type.</div>
              : groups.map((g) => (
                <button key={g.id} type="button" onClick={() => setSelected(g.id)}
                  className={"w-full text-left p-3 text-sm text-gray-900 hover:bg-gray-50 " + (selected === g.id ? "bg-gray-100 font-semibold" : "")}>
                  {g.name || "Unnamed group"}
                </button>
              ))
            }
          </div>
        </div>
        <GroupMembersPanel orgId={orgId} groupId={selected} canEdit={canEdit} artifactLabel={artifactLabel} />
      </div>
    </div>
  );
}

/* -- Group Members Panel --------------------------------------------------- */

function GroupMembersPanel({ orgId, groupId, canEdit, artifactLabel }: { orgId: string; groupId: string; canEdit: boolean; artifactLabel: string }) {
  const [err, setErr]         = useState("");
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [q, setQ]             = useState("");
  const [approvers, setApprovers] = useState<any[]>([]);
  const [approverId, setApproverId] = useState("");

  const memberKey = useMemo(() => (m: any) => String(m?.approver_id || m?.user_id || m?.email || m?.label || ""), []);

  async function loadMembers() {
    setErr("");
    if (!groupId) { setMembers([]); return; }
    setLoading(true);
    try {
      const res  = await fetch(`/api/approvals/groups/members?groupId=${encodeURIComponent(groupId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load members");
      setMembers(json.members ?? []);
    } catch (e: any) { setErr(String(e?.message || e || "Error")); setMembers([]); }
    finally { setLoading(false); }
  }

  async function loadApprovers() {
    try {
      const res  = await fetch(`/api/approvals/approvers?orgId=${encodeURIComponent(orgId)}&q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) return;
      const items = json.approvers ?? [];
      setApprovers(items);
      setApproverId((prev) => (prev && items.some((a: any) => String(a.id) === String(prev))) ? prev : (items?.[0]?.id ?? ""));
    } catch {}
  }

  useEffect(() => { loadMembers(); /* eslint-disable-next-line */ }, [groupId]);
  useEffect(() => { loadApprovers(); /* eslint-disable-next-line */ }, [orgId, q]);

  async function add() {
    if (!groupId || !approverId) return;
    const res  = await fetch("/api/approvals/groups/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, groupId, approverId }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) { alert(json?.error || "Failed"); return; }
    loadMembers();
  }

  async function remove(m: any) {
    if (!groupId || !window.confirm("Remove member from group?")) return;
    const url = new URL("/api/approvals/groups/members", window.location.origin);
    url.searchParams.set("groupId", groupId);
    if (m?.approver_id) url.searchParams.set("approverId", m.approver_id);
    else if (m?.user_id) url.searchParams.set("userId", m.user_id);
    else return;
    const res  = await fetch(url.toString(), { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) { alert(json?.error || "Failed"); return; }
    loadMembers();
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="p-3 border-b">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-gray-900">Members</div>
          <ScopeBadge kind="scoped">{artifactLabel} group membership</ScopeBadge>
        </div>
      </div>

      {!groupId ? (
        <div className="p-3 text-sm text-gray-600">Select a group.</div>
      ) : (
        <div className="p-3 space-y-3">
          {err     && <div className="text-sm text-red-600">{err}</div>}
          {loading && <div className="text-sm text-gray-500">Loading...</div>}

          {canEdit && (
            <div className="space-y-2">
              <label className="text-xs text-gray-600">
                Search organisation approvers
                <input className={inputCls + " w-full"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="email / name / department / role" />
              </label>
              <div className="flex items-end gap-2">
                <label className="text-xs text-gray-600 flex-1">
                  Select approver
                  <select className={selectCls + " w-full"} value={approverId}
                    onChange={(e) => setApproverId(e.target.value)}>
                    {approvers.length === 0
                      ? <option value="">No approvers</option>
                      : approvers.map((a: any) => <option key={a.id} value={a.id}>{a.label || a.email || a.name || a.id}</option>)
                    }
                  </select>
                </label>
                <button className={btnCls} type="button" onClick={add} disabled={!approverId}>Add</button>
              </div>
            </div>
          )}

          <div className="divide-y border rounded-lg">
            {members.length === 0
              ? <div className="p-3 text-sm text-gray-600">No members.</div>
              : members.map((m: any) => {
                const key = memberKey(m) || "m_" + Math.random();
                return (
                  <div key={key} className="p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{m.email || m.label || m.name || "Member"}</div>
                      <div className="text-xs text-gray-600 truncate">
                        {m.department   && <span className="mr-2">Dept: {m.department}</span>}
                        {m.approver_role && <span>Role: {m.approver_role}</span>}
                      </div>
                    </div>
                    {canEdit && <button className={btnCls} type="button" onClick={() => remove(m)}>Remove</button>}
                  </div>
                );
              })
            }
          </div>
        </div>
      )}
    </div>
  );
}