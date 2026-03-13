"use client";

import React, { useEffect, useMemo, useState } from "react";
import RulesPanel from "./RulesPanel";

/**
 * ✅ Only approvals for now:
 * - Project Charter
 * - Change Request
 * - Project Closure Report
 *
 * (Change submits via its own route, but it still uses the same org rules + org panel.)
 */
const ARTIFACTS = [
  { key: "project_charter", label: "Project Charter" },
  { key: "change", label: "Change Request" },
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

function pill(active: boolean) {
  return `px-3 py-1.5 text-sm ${
    active ? "bg-gray-100 font-semibold" : "bg-white hover:bg-gray-50"
  } disabled:opacity-50`;
}

function clean(x: any) {
  const t = String(x ?? "").trim();
  return t || "";
}

function cleanOrgId(x: any) {
  const s = clean(x);
  if (!s || s === "undefined" || s === "null") return "";
  return s;
}

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

  const [tab, setTab] = useState<"approvers" | "groups" | "rules">("rules");
  const [artifactType, setArtifactType] =
    useState<ArtifactKey>("project_charter");

  useEffect(() => {
    if (!orgId) return;
    const allowed = new Set<string>(ARTIFACTS.map((a) => a.key));
    if (!allowed.has(artifactType)) setArtifactType("project_charter");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const canEdit = !!isAdmin;

  return (
    <section className="rounded-xl border bg-white">
      <div className="p-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Organisation approvals</div>
          <div className="text-sm text-gray-600">
            Configure approvers + groups + rules per artifact type.
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Client:{" "}
            <span className="font-medium">{organisationName || "—"}</span>
            {!canEdit ? (
              <span className="ml-2 text-amber-700">
                Read-only (platform admin only)
              </span>
            ) : (
              <span className="ml-2 text-emerald-700">Admin mode</span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <select
            className="border rounded-md px-2 py-1 text-sm"
            value={artifactType}
            onChange={(e) => setArtifactType(e.target.value as ArtifactKey)}
            disabled={!orgId}
          >
            {ARTIFACTS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-md border overflow-hidden">
            <button
              className={pill(tab === "rules")}
              onClick={() => setTab("rules")}
              type="button"
              disabled={!orgId}
            >
              Rules
            </button>
            <button
              className={pill(tab === "groups")}
              onClick={() => setTab("groups")}
              type="button"
              disabled={!orgId}
            >
              Groups
            </button>
            <button
              className={pill(tab === "approvers")}
              onClick={() => setTab("approvers")}
              type="button"
              disabled={!orgId}
            >
              Approvers
            </button>
          </div>
        </div>
      </div>

      <div className="border-t p-4">
        {!orgId ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Missing organisationId (got:{" "}
            <span className="font-mono">{String(organisationId)}</span>).
            <br />
            Set an active organisation or ensure the page passes organisationId
            correctly.
          </div>
        ) : tab === "approvers" ? (
          <ApproversTab orgId={orgId} canEdit={canEdit} />
        ) : tab === "groups" ? (
          <GroupsTab orgId={orgId} artifactType={artifactType} canEdit={canEdit} />
        ) : (
          <RulesPanel orgId={orgId} artifactType={artifactType} canEdit={canEdit} />
        )}
      </div>
    </section>
  );
}

/* ------------------------------
   Approvers Tab
------------------------------ */

function ApproversTab({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [approvers, setApprovers] = useState<any[]>([]);

  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidates, setCandidates] = useState<ApproverCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [approverRole, setApproverRole] = useState("");
  const [department, setDepartment] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");

  function resetForm() {
    setCandidateQuery("");
    setCandidates([]);
    setSelectedCandidateId("");
    setSelectedUserId("");
    setEmail("");
    setName("");
    setApproverRole("");
    setDepartment("");
  }

  function applyCandidate(candidate: ApproverCandidate) {
    setSelectedCandidateId(candidate.user_id);
    setSelectedUserId(candidate.user_id);
    setEmail(candidate.email ?? "");
    setName(candidate.full_name ?? "");
    setDepartment(candidate.department ?? "");
    setCandidateQuery(candidate.label || candidate.email || "");
  }

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(
        `/api/approvals/approvers?orgId=${encodeURIComponent(orgId)}&q=${encodeURIComponent(
          q
        )}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load approvers");
      }
      setApprovers(json.approvers ?? []);
    } catch (e: any) {
      setErr(String(e?.message || e || "Error"));
      setApprovers([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadCandidates(search: string) {
    const trimmed = search.trim();
    if (!trimmed) {
      setCandidates([]);
      setSelectedCandidateId("");
      return;
    }

    setCandidatesLoading(true);
    try {
      const res = await fetch(
        `/api/approvals/approver-candidates?orgId=${encodeURIComponent(
          orgId
        )}&q=${encodeURIComponent(trimmed)}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load organisation members");
      }

      const items: ApproverCandidate[] = json.candidates ?? [];
      setCandidates(items);

      setSelectedCandidateId((prev) => {
        if (prev && items.some((x) => String(x.user_id) === String(prev))) {
          return prev;
        }
        return "";
      });
    } catch (e: any) {
      setErr(String(e?.message || e || "Error"));
      setCandidates([]);
      setSelectedCandidateId("");
    } finally {
      setCandidatesLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, q]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadCandidates(candidateQuery);
    }, 250);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateQuery, orgId]);

  async function add() {
    setErr("");

    const payload = {
      orgId,
      user_id: selectedUserId || null,
      email: email.trim() || null,
      name: name.trim() || null,
      approver_role: approverRole.trim() || null,
      department: department.trim() || null,
    };

    if (!payload.user_id && !payload.email) {
      setErr("Select an organisation member or enter an email.");
      return;
    }

    try {
      const res = await fetch("/api/approvals/approvers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed");
      }

      resetForm();
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e || "Error"));
    }
  }

  async function removeById(id: string) {
    const okConfirm = window.confirm("Remove approver for this organisation?");
    if (!okConfirm) return;

    setErr("");

    try {
      const url = new URL("/api/approvals/approvers", window.location.origin);
      url.searchParams.set("orgId", orgId);
      url.searchParams.set("id", id);

      const res = await fetch(url.toString(), { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed");
      }
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e || "Error"));
    }
  }

  return (
    <div className="space-y-3">
      {err ? <div className="text-sm text-red-600">{err}</div> : null}
      {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">
          Search
          <input
            className="block border rounded-md px-2 py-1 text-sm w-[320px]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="email / name / department / role"
          />
        </label>
        <button
          className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50"
          type="button"
          onClick={load}
        >
          Refresh
        </button>
      </div>

      {canEdit ? (
        <div className="border rounded-lg p-3 space-y-3">
          <div className="text-sm font-semibold">Add approver</div>

          <div className="grid md:grid-cols-2 gap-2">
            <label className="text-xs text-gray-600 md:col-span-2">
              Search organisation members
              <input
                className="block border rounded-md px-2 py-1 text-sm w-full"
                value={candidateQuery}
                onChange={(e) => {
                  setCandidateQuery(e.target.value);
                  setSelectedCandidateId("");
                  setSelectedUserId("");
                }}
                placeholder="Type name or email to pick an existing organisation member"
              />
            </label>

            <label className="text-xs text-gray-600 md:col-span-2">
              Matching organisation members
              <select
                className="block border rounded-md px-2 py-1 text-sm w-full"
                value={selectedCandidateId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedCandidateId(id);
                  const found = candidates.find(
                    (c) => String(c.user_id) === String(id)
                  );
                  if (found) applyCandidate(found);
                }}
              >
                <option value="">
                  {candidatesLoading
                    ? "Loading members..."
                    : candidates.length > 0
                    ? "Select a member"
                    : candidateQuery.trim()
                    ? "No matching members"
                    : "Type above to search members"}
                </option>
                {candidates.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-gray-600">
              Email
              <input
                className="block border rounded-md px-2 py-1 text-sm"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (selectedUserId) {
                    setSelectedUserId("");
                    setSelectedCandidateId("");
                  }
                }}
                placeholder="person@company.com"
              />
            </label>

            <label className="text-xs text-gray-600">
              Name
              <input
                className="block border rounded-md px-2 py-1 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional display name"
              />
            </label>

            <label className="text-xs text-gray-600">
              Approver role
              <input
                className="block border rounded-md px-2 py-1 text-sm"
                value={approverRole}
                onChange={(e) => setApproverRole(e.target.value)}
                placeholder="Commercial / Delivery Director / CFO…"
              />
            </label>

            <label className="text-xs text-gray-600">
              Department
              <input
                className="block border rounded-md px-2 py-1 text-sm"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Finance / Legal / Commercial…"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50"
              type="button"
              onClick={add}
            >
              Add approver
            </button>

            <button
              className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50"
              type="button"
              onClick={resetForm}
            >
              Clear
            </button>
          </div>

          <div className="text-[11px] text-gray-500">
            Pick from organisation members for a linked approver, or type an
            external email manually.
          </div>
        </div>
      ) : null}

      <div className="divide-y border rounded-lg">
        {approvers.length === 0 ? (
          <div className="p-3 text-sm text-gray-600">
            No organisation approvers yet.
          </div>
        ) : (
          approvers.map((a) => (
            <div key={a.id} className="p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {a.label || a.email || a.name || a.id}
                </div>

                <div className="mt-1 text-xs text-gray-600 truncate">
                  {a.email ? <span className="mr-2">{a.email}</span> : null}
                  {a.department ? <span className="mr-2">Dept: {a.department}</span> : null}
                  {a.approver_role ? <span>Role: {a.approver_role}</span> : null}
                </div>

                <div className="text-[11px] text-gray-500 truncate">
                  {a.link_state === "linked" || a.user_id ? (
                    <span className="text-emerald-700">Linked member</span>
                  ) : (
                    <span className="text-amber-700">External / not linked</span>
                  )}
                </div>
              </div>

              {canEdit ? (
                <button
                  className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50"
                  type="button"
                  onClick={() => removeById(a.id)}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------
   Groups Tab
------------------------------ */

function GroupsTab({
  orgId,
  artifactType,
  canEdit,
}: {
  orgId: string;
  artifactType: string;
  canEdit: boolean;
}) {
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>("");

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(
        `/api/approvals/groups?orgId=${encodeURIComponent(
          orgId
        )}&artifactType=${encodeURIComponent(artifactType)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok)
        throw new Error(json?.error || "Failed to load groups");
      setGroups(json.groups ?? []);
      setSelected((prev) => prev || (json.groups?.[0]?.id ?? ""));
    } catch (e: any) {
      setErr(String(e?.message || e || "Error"));
      setGroups([]);
      setSelected("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, artifactType]);

  useEffect(() => {
    if (!selected) return;
    const exists = (groups ?? []).some((g: any) => String(g?.id) === String(selected));
    if (!exists) setSelected(groups?.[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length]);

  async function createGroup() {
    if (!name.trim()) return;
    const res = await fetch("/api/approvals/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, artifactType, name: name.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) return alert(json?.error || "Failed");
    setName("");
    load();
  }

  return (
    <div className="space-y-3">
      {err ? <div className="text-sm text-red-600">{err}</div> : null}
      {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">
            New group name
            <input
              className="block border rounded-md px-2 py-1 text-sm w-[360px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50"
            type="button"
            onClick={createGroup}
          >
            Create
          </button>
        </div>
      ) : null}

      <div className="grid md:grid-cols-2 gap-3">
        <div className="border rounded-lg overflow-hidden">
          <div className="p-3 border-b text-sm font-semibold">Groups</div>
          <div className="divide-y">
            {groups.length === 0 ? (
              <div className="p-3 text-sm text-gray-600">
                No groups for this artifact type.
              </div>
            ) : (
              groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelected(g.id)}
                  className={`w-full text-left p-3 text-sm hover:bg-gray-50 ${
                    selected === g.id ? "bg-gray-100" : ""
                  }`}
                >
                  {g.name || "Unnamed group"}
                </button>
              ))
            )}
          </div>
        </div>

        <GroupMembersPanel orgId={orgId} groupId={selected} canEdit={canEdit} />
      </div>
    </div>
  );
}

/* ------------------------------
   GroupMembersPanel
------------------------------ */

function GroupMembersPanel({
  orgId,
  groupId,
  canEdit,
}: {
  orgId: string;
  groupId: string;
  canEdit: boolean;
}) {
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<any[]>([]);

  const [q, setQ] = useState("");
  const [approvers, setApprovers] = useState<any[]>([]);
  const [approverId, setApproverId] = useState("");

  const memberKey = useMemo(() => {
    return (m: any) =>
      String(m?.approver_id || m?.user_id || m?.email || m?.label || "");
  }, []);

  async function loadMembers() {
    setErr("");
    if (!groupId) {
      setMembers([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/approvals/groups/members?groupId=${encodeURIComponent(groupId)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok)
        throw new Error(json?.error || "Failed to load members");
      setMembers(json.members ?? []);
    } catch (e: any) {
      setErr(String(e?.message || e || "Error"));
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadApprovers() {
    try {
      const res = await fetch(
        `/api/approvals/approvers?orgId=${encodeURIComponent(
          orgId
        )}&q=${encodeURIComponent(q)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) return;
      const items = json.approvers ?? [];
      setApprovers(items);
      setApproverId((prev) => {
        if (prev && items.some((a: any) => String(a.id) === String(prev))) {
          return prev;
        }
        return items?.[0]?.id ?? "";
      });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    loadApprovers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, q]);

  async function add() {
    if (!groupId) return;
    if (!approverId) return;

    const res = await fetch("/api/approvals/groups/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, groupId, approverId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) return alert(json?.error || "Failed");
    loadMembers();
  }

  async function remove(m: any) {
    if (!groupId) return;
    const okConfirm = window.confirm("Remove member from group?");
    if (!okConfirm) return;

    const url = new URL("/api/approvals/groups/members", window.location.origin);
    url.searchParams.set("groupId", groupId);

    if (m?.approver_id) url.searchParams.set("approverId", m.approver_id);
    else if (m?.user_id) url.searchParams.set("userId", m.user_id);
    else return;

    const res = await fetch(url.toString(), { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) return alert(json?.error || "Failed");
    loadMembers();
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="p-3 border-b text-sm font-semibold">Members</div>

      {!groupId ? (
        <div className="p-3 text-sm text-gray-600">Select a group.</div>
      ) : (
        <div className="p-3 space-y-3">
          {err ? <div className="text-sm text-red-600">{err}</div> : null}
          {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}

          {canEdit ? (
            <div className="space-y-2">
              <label className="text-xs text-gray-600">
                Search approvers
                <input
                  className="block border rounded-md px-2 py-1 text-sm w-full"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="email / name / department / role"
                />
              </label>

              <div className="flex items-end gap-2">
                <label className="text-xs text-gray-600 flex-1">
                  Select approver
                  <select
                    className="block border rounded-md px-2 py-1 text-sm w-full"
                    value={approverId}
                    onChange={(e) => setApproverId(e.target.value)}
                  >
                    {approvers.length === 0 ? (
                      <option value="">No approvers</option>
                    ) : (
                      approvers.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.label || a.email || a.name || a.id}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <button
                  className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                  type="button"
                  onClick={add}
                  disabled={!approverId}
                >
                  Add
                </button>
              </div>
            </div>
          ) : null}

          <div className="divide-y border rounded-lg">
            {members.length === 0 ? (
              <div className="p-3 text-sm text-gray-600">No members.</div>
            ) : (
              members.map((m: any) => {
                const key =
                  memberKey(m) ||
                  `m_${String(m?.created_at || "")}_${Math.random()}`;
                return (
                  <div key={key} className="p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {m.email || m.label || m.name || "Member"}
                      </div>
                      <div className="text-xs text-gray-600 truncate">
                        {m.department ? (
                          <span className="mr-2">Dept: {m.department}</span>
                        ) : null}
                        {m.approver_role ? <span>Role: {m.approver_role}</span> : null}
                      </div>
                    </div>

                    {canEdit ? (
                      <button
                        className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50"
                        type="button"
                        onClick={() => remove(m)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}