"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

const COLOURS = ["#06b6d4","#3b82f6","#8b5cf6","#ec4899","#f59e0b","#10b981","#ef4444","#f97316"];

type Props = { activeOrgId: string; userId: string };

export default function CreateProjectModal({ activeOrgId, userId }: Props) {
  const [open, setOpen]           = useState(false);
  const [step, setStep]           = useState<1 | 2>(1);
  const [name, setName]           = useState("");
  const [pm, setPm]               = useState("");
  const [pmUserId, setPmUserId]   = useState<string | null>(null);
  const [members, setMembers]     = useState<{user_id: string; name: string; email: string}[]>([]);
  const [pmSearch, setPmSearch]   = useState("");
  const [pmOpen, setPmOpen]         = useState(false);
  const [sponsor, setSponsor]       = useState("");
  const [sponsorId, setSponsorId]   = useState<string | null>(null);
  const [sponsorSearch, setSponsorSearch] = useState("");
  const [sponsorOpen, setSponsorOpen]     = useState(false);
  const [projectType, setProjectType]     = useState("");
  const [pmUserId, setPmUserId]   = useState<string | null>(null);
  const [members, setMembers]     = useState<{user_id: string; name: string; email: string}[]>([]);
  const [pmSearch, setPmSearch]   = useState("");
  const [pmOpen, setPmOpen]         = useState(false);
  const [sponsor, setSponsor]       = useState("");
  const [sponsorId, setSponsorId]   = useState<string | null>(null);
  const [sponsorSearch, setSponsorSearch] = useState("");
  const [sponsorOpen, setSponsorOpen]     = useState(false);
  const [projectType, setProjectType]     = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [code, setCode]           = useState("");
  const [dept, setDept]           = useState("");
  const [resStatus, setResStatus] = useState<"confirmed" | "pipeline">("confirmed");
  const [colour, setColour]       = useState(COLOURS[0]);
  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTx]      = useTransition();
  const overlayRef                = useRef<HTMLDivElement>(null);
  const router                    = useRouter();

  // Fetch org members for PM picker
  useEffect(() => {
    if (!open || !activeOrgId) return;
    fetch(`/api/org/members?orgId=${activeOrgId}`)
      .then(r => r.json())
      .then(d => { if (d.members) setMembers(d.members); })
      .catch(() => {});
  }, [open, activeOrgId]);

  // Fetch org members for PM picker
  useEffect(() => {
    if (!open || !activeOrgId) return;
    fetch(`/api/org/members?orgId=${activeOrgId}`)
      .then(r => r.json())
      .then(d => { if (d.members) setMembers(d.members); })
      .catch(() => {});
  }, [open, activeOrgId]);

  // Auto-generate code from name
  useEffect(() => {
    if (!name) { setCode(""); return; }
    const slug = name.replace(/[^a-zA-Z0-9\s]/g, "").trim()
      .split(/\s+/).map(w => w.slice(0, 3).toUpperCase()).join("-");
    setCode(slug || "");
  }, [name]);

  function reset() {
    setStep(1); setName(""); setPm(""); setPmUserId(null); setPmSearch(""); setPmOpen(false);
    setSponsor(""); setSponsorId(null); setSponsorSearch(""); setSponsorOpen(false); setProjectType(""); setStartDate(""); setEndDate("");
    setCode(""); setDept(""); setResStatus("confirmed"); setColour(COLOURS[0]); setError(null);
  }

  function close() { setOpen(false); reset(); }

  function handleSubmit() {
    if (!name.trim()) { setError("Project name is required."); return; }
    setError(null);
    startTx(async () => {
      try {
        const res = await fetch("/api/projects/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title:           name.trim(),
            project_code:    code || null,
            department:      dept || null,
            colour,
            resource_status: resStatus,
            start_date:      startDate || null,
            finish_date:     endDate   || null,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        close();
        router.refresh();
      } catch (e: any) {
        setError(e.message || "Failed to create project.");
      }
    });
  }

  const inputStyle: React.CSSProperties = {
    border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "9px 12px",
    fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
    background: "white", color: "#0f172a", fontFamily: "inherit",
  };
  const hintStyle: React.CSSProperties = { fontSize: 11, color: "#94a3b8", margin: "3px 0 0" };

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#64748b" }}>
          {label}
        </label>
        {children}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ background: "#06b6d4", color: "white", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M7 1v12M1 7h12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        New project
      </button>

      {open && (
        <div
          ref={overlayRef}
          onClick={e => { if (e.target === overlayRef.current) close(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ background: "white", borderRadius: 20, width: "100%", maxWidth: 560, boxShadow: "0 24px 60px rgba(0,0,0,.18)", display: "flex", flexDirection: "column", maxHeight: "90vh", overflow: "hidden" }}>

            {/* Modal header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "24px 28px 0" }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: "-.3px" }}>Create a project</h2>
                <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 10px" }}>
                  Enterprise setup — define ownership and delivery lead.
                </p>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#ecfeff", border: "1px solid #a5f3fc", borderRadius: 20, padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "#0891b2" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="#0891b2" strokeWidth="2"/>
                  </svg>
                  Active organisation
                </div>
              </div>
              <button onClick={close} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6 6 18M6 6l12 12" stroke="#64748b" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Step indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "20px 28px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#06b6d4", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                  {step > 1 ? "✓" : "1"}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: step === 1 ? "#06b6d4" : "#94a3b8", textTransform: "uppercase", letterSpacing: ".05em" }}>Basics</span>
              </div>
              <div style={{ flex: 1, height: 1, background: step > 1 ? "#06b6d4" : "#e2e8f0", transition: "background .3s" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: step >= 2 ? "#06b6d4" : "#f1f5f9", color: step >= 2 ? "white" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, transition: "all .3s" }}>2</div>
                <span style={{ fontSize: 12, fontWeight: 600, color: step === 2 ? "#06b6d4" : "#94a3b8", textTransform: "uppercase", letterSpacing: ".05em" }}>Heatmap</span>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flex: 1 }}>

              {error && (
                <div style={{ padding: "9px 13px", borderRadius: 9, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 13, color: "#dc2626", fontWeight: 600 }}>
                  {error}
                </div>
              )}

              {step === 1 ? (
                <>
                  <Field label="Project name">
                    <input style={inputStyle} placeholder="e.g. Project Venus" value={name}
                      onChange={e => setName(e.target.value)} autoFocus />
                  </Field>
                  <Field label="Project manager">
                    <div style={{ position: "relative" }}>
                      <input
                        style={inputStyle}
                        placeholder="Search by name or email..."
                        value={pmSearch}
                        onChange={e => { setPmSearch(e.target.value); setPmOpen(true); setPmUserId(null); setPm(""); }}
                        onFocus={() => setPmOpen(true)}
                        autoComplete="off"
                      />
                      {pmOpen && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "white", border: "1.5px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.1)", maxHeight: 200, overflowY: "auto", marginTop: 4 }}>
                          {members
                            .filter(m => !pmSearch || m.name.toLowerCase().includes(pmSearch.toLowerCase()) || m.email.toLowerCase().includes(pmSearch.toLowerCase()))
                            .map(m => (
                              <div key={m.user_id}
                                onClick={() => { setPm(m.name || m.email); setPmUserId(m.user_id); setPmSearch(m.name || m.email); setPmOpen(false); }}
                                style={{ padding: "9px 14px", cursor: "pointer", fontSize: 13, display: "flex", flexDirection: "column", gap: 2, borderBottom: "1px solid #f1f5f9" }}
                                onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                                onMouseLeave={e => (e.currentTarget.style.background = "white")}
                              >
                                <span style={{ fontWeight: 600, color: "#0f172a" }}>{m.name || "—"}</span>
                                <span style={{ fontSize: 11, color: "#94a3b8" }}>{m.email}</span>
                              </div>
                            ))}
                          {members.filter(m => !pmSearch || m.name.toLowerCase().includes(pmSearch.toLowerCase()) || m.email.toLowerCase().includes(pmSearch.toLowerCase())).length === 0 && (
                            <div style={{ padding: "10px 14px", fontSize: 13, color: "#94a3b8" }}>No members found</div>
                          )}
                        </div>
                      )}
                    </div>
                    <p style={hintStyle}>Assign now or later — used for delivery accountability.</p>
                  </Field>
                  <Field label="Sponsor">
                    <div style={{ position: "relative" }}>
                      <input
                        style={inputStyle}
                        placeholder="Search by name or email..."
                        value={sponsorSearch}
                        onChange={e => { setSponsorSearch(e.target.value); setSponsorOpen(true); setSponsorId(null); setSponsor(""); }}
                        onFocus={() => setSponsorOpen(true)}
                        autoComplete="off"
                      />
                      {sponsorOpen && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "white", border: "1.5px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.1)", maxHeight: 180, overflowY: "auto", marginTop: 4 }}>
                          {members
                            .filter(m => !sponsorSearch || m.name.toLowerCase().includes(sponsorSearch.toLowerCase()) || m.email.toLowerCase().includes(sponsorSearch.toLowerCase()))
                            .map(m => (
                              <div key={m.user_id}
                                onClick={() => { setSponsor(m.name || m.email); setSponsorId(m.user_id); setSponsorSearch(m.name || m.email); setSponsorOpen(false); }}
                                style={{ padding: "9px 14px", cursor: "pointer", fontSize: 13, display: "flex", flexDirection: "column", gap: 2, borderBottom: "1px solid #f1f5f9" }}
                                onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                                onMouseLeave={e => (e.currentTarget.style.background = "white")}
                              >
                                <span style={{ fontWeight: 600, color: "#0f172a" }}>{m.name || "—"}</span>
                                <span style={{ fontSize: 11, color: "#94a3b8" }}>{m.email}</span>
                              </div>
                            ))}
                          {members.filter(m => !sponsorSearch || m.name.toLowerCase().includes(sponsorSearch.toLowerCase()) || m.email.toLowerCase().includes(sponsorSearch.toLowerCase())).length === 0 && (
                            <div style={{ padding: "10px 14px", fontSize: 13, color: "#94a3b8" }}>No members found</div>
                          )}
                        </div>
                      )}
                    </div>
                    <p style={hintStyle}>Executive accountable for budget and decisions.</p>
                  </Field>
                  <Field label="Project type">
                    <select style={inputStyle} value={projectType} onChange={e => setProjectType(e.target.value)}>
                      <option value="">Select type...</option>
                      <option value="IT">IT</option>
                      <option value="Infrastructure">Infrastructure</option>
                      <option value="Change">Change</option>
                      <option value="BAU Enhancement">BAU Enhancement</option>
                      <option value="Regulatory">Regulatory</option>
                      <option value="Digital Transformation">Digital Transformation</option>
                      <option value="Product">Product</option>
                      <option value="Other">Other</option>
                    </select>
                    <p style={hintStyle}>Used for portfolio filtering and reporting.</p>
                  </Field>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Start date">
                      <input style={inputStyle} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    </Field>
                    <Field label="Finish date">
                      <input style={inputStyle} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#ecfeff", borderRadius: 10, border: "1px solid #a5f3fc" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="3" width="18" height="18" rx="2" stroke="#06b6d4" strokeWidth="2"/>
                      <path d="M3 9h18M9 9v12M15 9v12" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", color: "#06b6d4", textTransform: "uppercase" }}>Resource heatmap settings</span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Project code">
                      <input style={inputStyle} placeholder="e.g. ATL-01" value={code} onChange={e => setCode(e.target.value)} />
                      <p style={hintStyle}><span style={{ color: "#06b6d4", fontWeight: 600 }}>✦ Auto-generated</span> — edit to override.</p>
                    </Field>
                    <Field label="Department">
                      <input style={inputStyle} placeholder="e.g. Engineering" value={dept} onChange={e => setDept(e.target.value)} />
                      <p style={hintStyle}>Used in heatmap filter bar.</p>
                    </Field>
                  </div>

                  <Field label="Resource status">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {(["confirmed", "pipeline"] as const).map(s => (
                        <button key={s} type="button" onClick={() => setResStatus(s)}
                          style={{ border: "1.5px solid", borderRadius: 10, padding: "10px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all .15s",
                            background:  resStatus === s ? (s === "confirmed" ? "#06b6d4" : "#f1f5f9") : "white",
                            color:        resStatus === s ? (s === "confirmed" ? "white"   : "#0f172a") : "#64748b",
                            borderColor: resStatus === s ? (s === "confirmed" ? "#06b6d4" : "#cbd5e1") : "#e2e8f0",
                            fontWeight:  resStatus === s ? 700 : 500 }}>
                          {s === "confirmed"
                            ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12" stroke={resStatus === "confirmed" ? "white" : "#64748b"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Confirmed</>
                            : <>◎ Pipeline</>}
                        </button>
                      ))}
                    </div>
                    <p style={hintStyle}>{resStatus === "confirmed" ? "Affects the live capacity heatmap immediately." : "Appears as demand forecast on the heatmap."}</p>
                  </Field>

                  <Field label="Project colour">
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {COLOURS.map(c => (
                        <button key={c} type="button" onClick={() => setColour(c)} style={{
                          width: 30, height: 30, borderRadius: "50%", background: c,
                          border: "none", cursor: "pointer",
                          outline: colour === c ? `3px solid ${c}` : "none", outlineOffset: 2,
                          transform: colour === c ? "scale(1.15)" : "scale(1)", transition: "transform .15s",
                        }} />
                      ))}
                      <span style={{ fontSize: 11, fontWeight: 700, background: "#f1f5f9", color: "#64748b", borderRadius: 6, padding: "2px 7px", border: "1px solid #e2e8f0", marginLeft: 4, fontFamily: "'DM Mono', monospace" }}>
                        {code || "PRJ"}
                      </span>
                    </div>
                    <p style={hintStyle}>Identifies this project in heatmap swimlane rows.</p>
                  </Field>
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "16px 28px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {step === 1 ? (
                <>
                  <button onClick={close} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#64748b" }}>
                    Cancel
                  </button>
                  <button onClick={() => name.trim() && setStep(2)}
                    style={{ background: "#06b6d4", color: "white", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: name.trim() ? 1 : .45 }}>
                    Next: Heatmap settings →
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setStep(1)} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#64748b" }}>
                    ← Back
                  </button>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>Add role requirements after creation.</span>
                    <button onClick={handleSubmit} disabled={isPending}
                      style={{ background: isPending ? "#94a3b8" : "#06b6d4", color: "white", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: isPending ? "not-allowed" : "pointer" }}>
                      {isPending ? "Creating…" : "+ Create project"}
                    </button>
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      )}
    </>
  );
}
