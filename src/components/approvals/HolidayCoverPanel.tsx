"use client";

import React, { useEffect, useMemo, useState } from "react";

type Member = { user_id: string; full_name?: string; email?: string; label?: string };
type Delegation = { id: string; from_user_id: string; to_user_id: string; starts_at: string; ends_at: string; reason: string | null; is_active: boolean };
type DelegationStatus = "active" | "upcoming" | "expired";

function clean(x: any) { return String(x ?? "").trim(); }
function toIsoFromDate(d: string, endOfDay = false) {
  if (!d) return "";
  try { return new Date(d + (endOfDay ? "T23:59:59.000Z" : "T00:00:00.000Z")).toISOString(); } catch { return ""; }
}
function fmtDate(iso: string) {
  if (!iso) return "--";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return iso; }
}
function getDelegationStatus(d: Delegation): DelegationStatus {
  const now = Date.now();
  const start = new Date(d.starts_at).getTime();
  const end = new Date(d.ends_at).getTime();
  if (now < start) return "upcoming";
  if (now > end) return "expired";
  return "active";
}
function StatusBadge({ status }: { status: DelegationStatus }) {
  const cfg = {
    active:   { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d", dot: "#22c55e", label: "Active" },
    upcoming: { bg: "#fffbeb", border: "#fde68a", color: "#92400e", dot: "#f59e0b", label: "Upcoming" },
    expired:  { bg: "#f4f4f2", border: "#e3e3df", color: "#6b7280", dot: "#9ca3af", label: "Expired" },
  }[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, background: cfg.bg, border: `1px solid ${cfg.border}`, fontSize: 11, fontWeight: 600, color: cfg.color }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}
function pickMembers(json: any): Member[] {
  const arr = (Array.isArray(json?.items) && json.items) || (Array.isArray(json?.users) && json.users) || (Array.isArray(json?.members) && json.members) || [];
  return (arr as Member[]).filter((m) => clean((m as any)?.user_id));
}
function memberLabel(m: Member) { return clean(m.label) || clean(m.full_name) || clean(m.email) || clean(m.user_id) || "Member"; }
function isBadId(x: string) { const v = clean(x).toLowerCase(); return !v || v === "null" || v === "undefined"; }
function authHint(s: number) { return s === 401 ? "Not signed in." : s === 403 ? "Platform admin required." : ""; }

export default function HolidayCoverPanel({
  projectId, orgId, canEdit = false,
}: {
  projectId?: string;
  orgId?: string;
  canEdit?: boolean;
}) {
  // Resolve which ID to use and which param name to send
  const scopeId   = clean(orgId || projectId || "");
  const scopeParam = orgId ? `orgId=${encodeURIComponent(scopeId)}` : `projectId=${encodeURIComponent(scopeId)}`;

  const [members, setMembers] = useState<Member[]>([]);
  const [items, setItems]     = useState<Delegation[]>([]);
  const [err, setErr]         = useState("");
  const [loading, setLoading] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [fromUserId, setFromUserId]   = useState("");
  const [toUserId, setToUserId]       = useState("");
  const [startsDate, setStartsDate]   = useState("");
  const [endsDate, setEndsDate]       = useState("");
  const [reason, setReason]           = useState("");
  const [saving, setSaving]           = useState(false);

  async function load(includeInactive = showExpired) {
    setErr("");
    if (isBadId(scopeId)) { setErr("Missing orgId or projectId"); return; }
    setLoading(true);
    try {
      const [mRes, dRes] = await Promise.all([
        fetch(`/api/approvals/org-users?${scopeParam}`),
        fetch(`/api/approvals/delegations?projectId=${encodeURIComponent(scopeId)}${includeInactive ? "&includeInactive=1" : ""}`),
      ]);
      const mJson = await mRes.json().catch(() => ({}));
      const dJson = await dRes.json().catch(() => ({}));
      if (!mRes.ok || !mJson?.ok) setErr((mJson?.error || "Failed to load members") + (authHint(mRes.status) ? ` (${authHint(mRes.status)})` : ""));
      else setMembers(pickMembers(mJson));
      if (!dRes.ok || !dJson?.ok) setErr(prev => prev || (dJson?.error || "Failed to load cover") + (authHint(dRes.status) ? ` (${authHint(dRes.status)})` : ""));
      else setItems(dJson.items || []);
    } catch (e: any) {
      setErr(String(e?.message || "Failed to load"));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [scopeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ids = new Set(members.map(m => clean(m.user_id)));
    if (fromUserId && !ids.has(clean(fromUserId))) setFromUserId("");
    if (toUserId   && !ids.has(clean(toUserId)))   setToUserId("");
  }, [members.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = useMemo(() => {
    const map = new Map(members.map(m => [clean(m.user_id), memberLabel(m)]));
    return (uid: string) => map.get(clean(uid)) || clean(uid) || "User";
  }, [members]);

  const dateError    = startsDate && endsDate && new Date(endsDate) <= new Date(startsDate) ? "End date must be after start date." : null;
  const samePersonErr = fromUserId && toUserId && clean(fromUserId) === clean(toUserId) ? "Must be different people." : null;
  const saveDisabled  = saving || !canEdit || !fromUserId || !toUserId || !startsDate || !endsDate || !!dateError || !!samePersonErr;

  async function save() {
    setErr("");
    if (!canEdit || !fromUserId || !toUserId || !startsDate || !endsDate || dateError || samePersonErr) return;
    setSaving(true);
    try {
      const res = await fetch("/api/approvals/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: scopeId, from_user_id: fromUserId, to_user_id: toUserId, starts_at: toIsoFromDate(startsDate, false), ends_at: toIsoFromDate(endsDate, true), reason: reason.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) { setErr((json?.error || "Failed to save") + (authHint(res.status) ? ` (${authHint(res.status)})` : "")); return; }
      setFromUserId(""); setToUserId(""); setStartsDate(""); setEndsDate(""); setReason("");
      await load();
    } catch (e: any) { setErr(String(e?.message || "Failed to save")); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    setErr("");
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/approvals/delegations?projectId=${encodeURIComponent(scopeId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) setErr(json?.error || "Failed to remove");
      else await load();
    } catch (e: any) { setErr(String(e?.message || "Failed to remove")); }
  }

  const sorted = useMemo(() => {
    const order: Record<DelegationStatus, number> = { active: 0, upcoming: 1, expired: 2 };
    return [...items].sort((a, b) => {
      const sa = getDelegationStatus(a), sb = getDelegationStatus(b);
      return order[sa] !== order[sb] ? order[sa] - order[sb] : new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
    });
  }, [items]);

  const counts = { active: items.filter(d => getDelegationStatus(d) === "active").length, upcoming: items.filter(d => getDelegationStatus(d) === "upcoming").length, expired: items.filter(d => getDelegationStatus(d) === "expired").length };
  const inp = "width:100%;border-radius:6px;border:1px solid #e2e8f0;padding:6px 10px;font-size:13px;outline:none;";

  return (
    <section style={{ borderRadius: 12, border: "1px solid #e2e8f0", background: "white", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>Holiday Cover</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Delegate approval authority for a date range. Active delegates can approve, request changes or reject on behalf of the original approver.</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {counts.active   > 0 && <span style={{ display:"inline-flex",alignItems:"center",gap:4,padding:"2px 10px",borderRadius:20,background:"#f0fdf4",border:"1px solid #bbf7d0",fontSize:11,fontWeight:600,color:"#15803d" }}><span style={{width:6,height:6,borderRadius:"50%",background:"#22c55e"}} />{counts.active} active</span>}
            {counts.upcoming > 0 && <span style={{ display:"inline-flex",alignItems:"center",gap:4,padding:"2px 10px",borderRadius:20,background:"#fffbeb",border:"1px solid #fde68a",fontSize:11,fontWeight:600,color:"#92400e" }}><span style={{width:6,height:6,borderRadius:"50%",background:"#f59e0b"}} />{counts.upcoming} upcoming</span>}
            {counts.expired  > 0 && <span style={{ display:"inline-flex",alignItems:"center",gap:4,padding:"2px 10px",borderRadius:20,background:"#f4f4f2",border:"1px solid #e3e3df",fontSize:11,fontWeight:600,color:"#6b7280" }}>{counts.expired} expired</span>}
          </div>
          {!canEdit && <div style={{ marginTop:8,padding:"4px 10px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",fontSize:11,color:"#92400e" }}>Read-only — platform admin required</div>}
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
          {loading && <span style={{ fontSize:11,color:"#94a3b8" }}>Loading…</span>}
          <button onClick={() => load()} style={{ border:"1px solid #e2e8f0",background:"white",borderRadius:6,padding:"4px 10px",fontSize:12,color:"#475569",cursor:"pointer" }} type="button">Refresh</button>
        </div>
      </div>

      {err && <div style={{ padding:"10px 20px",background:"#fef2f2",borderBottom:"1px solid #fecaca",fontSize:12,color:"#b91c1c" }}>{err}</div>}

      {canEdit && (
        <div style={{ padding:"16px 20px",borderBottom:"1px solid #f1f5f9" }}>
          <div style={{ fontSize:13,fontWeight:600,color:"#374151",marginBottom:10 }}>Add cover rule</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
            <label style={{ display:"grid",gap:4 }}>
              <span style={{ fontSize:11,fontWeight:500,color:"#6b7280" }}>Delegate from *</span>
              <select value={fromUserId} onChange={e => setFromUserId(e.target.value)} style={{ border:"1px solid #e2e8f0",borderRadius:6,padding:"6px 10px",fontSize:13,width:"100%",background:"white" }}>
                <option value="">Select approver going on leave…</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{memberLabel(m)}</option>)}
              </select>
            </label>
            <label style={{ display:"grid",gap:4 }}>
              <span style={{ fontSize:11,fontWeight:500,color:"#6b7280" }}>Cover person *</span>
              <select value={toUserId} onChange={e => setToUserId(e.target.value)} style={{ border:"1px solid #e2e8f0",borderRadius:6,padding:"6px 10px",fontSize:13,width:"100%",background:"white" }}>
                <option value="">Select cover approver…</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{memberLabel(m)}</option>)}
              </select>
            </label>
            <label style={{ display:"grid",gap:4 }}>
              <span style={{ fontSize:11,fontWeight:500,color:"#6b7280" }}>Starts *</span>
              <input type="date" value={startsDate} onChange={e => setStartsDate(e.target.value)} max={endsDate||undefined} style={{ border:"1px solid #e2e8f0",borderRadius:6,padding:"6px 10px",fontSize:13,width:"100%" }} />
            </label>
            <label style={{ display:"grid",gap:4 }}>
              <span style={{ fontSize:11,fontWeight:500,color:"#6b7280" }}>Ends *</span>
              <input type="date" value={endsDate} onChange={e => setEndsDate(e.target.value)} min={startsDate||undefined} style={{ border:"1px solid #e2e8f0",borderRadius:6,padding:"6px 10px",fontSize:13,width:"100%" }} />
            </label>
            <label style={{ display:"grid",gap:4,gridColumn:"1/-1" }}>
              <span style={{ fontSize:11,fontWeight:500,color:"#6b7280" }}>Reason (optional)</span>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Annual leave, sick cover…" style={{ border:"1px solid #e2e8f0",borderRadius:6,padding:"6px 10px",fontSize:13,width:"100%" }} />
            </label>
            {(dateError || samePersonErr) && <div style={{ gridColumn:"1/-1",fontSize:11,fontWeight:600,color:"#b91c1c" }}>⚠ {dateError || samePersonErr}</div>}
            <div style={{ gridColumn:"1/-1" }}>
              <button onClick={save} disabled={saveDisabled} style={{ border:"1px solid #d1d5db",background:"white",borderRadius:8,padding:"7px 18px",fontSize:13,fontWeight:600,color:"#374151",cursor:saveDisabled?"not-allowed":"pointer",opacity:saveDisabled?0.5:1 }} type="button">
                {saving ? "Saving…" : "Save holiday cover"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding:"16px 20px" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
          <div style={{ fontSize:13,fontWeight:600,color:"#374151" }}>Cover rules {items.length > 0 && <span style={{ marginLeft:6,background:"#f1f5f9",borderRadius:20,padding:"1px 8px",fontSize:11,color:"#64748b",fontWeight:600 }}>{items.length}</span>}</div>
          {counts.expired > 0 && <button type="button" onClick={() => { const next = !showExpired; setShowExpired(next); load(next); }} style={{ fontSize:11,fontWeight:600,color:"#0e7490",background:"none",border:"none",cursor:"pointer",textDecoration:"underline" }}>{showExpired ? `Hide expired (${counts.expired})` : `Show expired (${counts.expired})`}</button>}
        </div>
        {!sorted.length ? (
          <div style={{ padding:"28px 0",textAlign:"center",fontSize:13,color:"#94a3b8",border:"1.5px dashed #e2e8f0",borderRadius:10 }}>No holiday cover configured.</div>
        ) : (
          <div style={{ border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden" }}>
            {sorted.map((d, i) => {
              const status = getDelegationStatus(d);
              const expired = status === "expired";
              return (
                <div key={d.id} style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,padding:"12px 16px",background:expired?"#fafaf9":"white",opacity:expired?0.7:1,borderTop:i>0?"1px solid #f1f5f9":"none" }}>
                  <div style={{ minWidth:0,flex:1 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                      <span style={{ fontSize:13,fontWeight:700,color:"#0f172a" }}>{label(d.from_user_id)}</span>
                      <span style={{ color:"#94a3b8" }}>→</span>
                      <span style={{ fontSize:13,fontWeight:700,color:"#0f172a" }}>{label(d.to_user_id)}</span>
                      <StatusBadge status={status} />
                    </div>
                    <div style={{ fontSize:11,color:"#64748b",marginTop:3 }}>
                      {fmtDate(d.starts_at)} → {fmtDate(d.ends_at)}{d.reason ? ` · ${d.reason}` : ""}
                    </div>
                  </div>
                  {canEdit && !expired && (
                    <button onClick={() => remove(d.id)} style={{ border:"1px solid #fecaca",background:"#fef2f2",borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:600,color:"#b91c1c",cursor:"pointer",flexShrink:0 }} type="button">Remove</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ marginTop:12,padding:"8px 12px",borderRadius:8,background:"#f0f9ff",border:"1px solid #bae6fd",fontSize:11,color:"#0369a1" }}>
          <strong>How it works:</strong> When an approval step is assigned to a delegating approver, the cover person can act on their behalf. All decisions are audit-logged with the delegation reference.
        </div>
      </div>
    </section>
  );
}