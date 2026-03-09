"use client";

import React, {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

const COLOURS = [
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#f97316",
] as const;

type Props = { activeOrgId: string; userId: string };

type Member = {
  user_id: string;
  name: string;
  email: string;
};

const UI = {
  white: "#ffffff",
  off: "#f7f7f7",
  off2: "#fafafa",
  ink: "#0a0a0a",
  ink2: "#333333",
  ink3: "#666666",
  ink4: "#999999",
  rule: "#e9e9e9",
  ruleStrong: "#dcdcdc",
  accent: "#0a0a0a",
  cyan: "#06b6d4",
  cyanSoft: "#ecfeff",
  cyanRule: "#a5f3fc",
  red: "#b91c1c",
  redBg: "#fef2f2",
  redRule: "#fecaca",
};

const inputStyle: React.CSSProperties = {
  border: `1px solid ${UI.ruleStrong}`,
  borderRadius: 10,
  padding: "11px 12px",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  background: UI.white,
  color: UI.ink,
  fontFamily: "inherit",
  transition: "border-color .15s ease, box-shadow .15s ease, background .15s ease",
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: UI.ink4,
  margin: "2px 0 0",
  lineHeight: 1.5,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: UI.ink4,
};

const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 50,
  background: UI.white,
  border: `1px solid ${UI.rule}`,
  borderRadius: 12,
  boxShadow: "0 18px 40px rgba(0,0,0,.08)",
  overflowY: "auto",
  marginTop: 6,
};

const Field = memo(function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={fieldLabelStyle}>{label}</label>
      {children}
    </div>
  );
});

function buttonBase(overrides?: React.CSSProperties): React.CSSProperties {
  return {
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 650,
    cursor: "pointer",
    transition: "all .15s ease",
    ...overrides,
  };
}

export default function CreateProjectModal({ activeOrgId, userId }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const [name, setName] = useState("");
  const [pm, setPm] = useState("");
  const [pmUserId, setPmUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pmSearch, setPmSearch] = useState("");
  const [pmOpen, setPmOpen] = useState(false);

  const [sponsor, setSponsor] = useState("");
  const [sponsorId, setSponsorId] = useState<string | null>(null);
  const [sponsorSearch, setSponsorSearch] = useState("");
  const [sponsorOpen, setSponsorOpen] = useState(false);

  const [projectType, setProjectType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [code, setCode] = useState("");
  const [dept, setDept] = useState("");
  const [resStatus, setResStatus] = useState<"confirmed" | "pipeline">(
    "confirmed"
  );
  const [colour, setColour] = useState<string>(COLOURS[0]);
  const [error, setError] = useState<string | null>(null);

  const [isPending, startTx] = useTransition();

  const overlayRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open || !activeOrgId) return;

    let cancelled = false;

    fetch(`/api/org/members?orgId=${encodeURIComponent(activeOrgId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.members)) {
          setMembers(d.members);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open, activeOrgId]);

  useEffect(() => {
    if (!name.trim()) {
      setCode("");
      return;
    }

    const slug = name
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.slice(0, 3).toUpperCase())
      .join("-");

    setCode(slug || "");
  }, [name]);

  const filteredPmMembers = useMemo(() => {
    const q = pmSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.name || "").toLowerCase().includes(q) ||
        (m.email || "").toLowerCase().includes(q)
    );
  }, [members, pmSearch]);

  const filteredSponsorMembers = useMemo(() => {
    const q = sponsorSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.name || "").toLowerCase().includes(q) ||
        (m.email || "").toLowerCase().includes(q)
    );
  }, [members, sponsorSearch]);

  function reset() {
    setStep(1);
    setName("");
    setPm("");
    setPmUserId(null);
    setPmSearch("");
    setPmOpen(false);

    setSponsor("");
    setSponsorId(null);
    setSponsorSearch("");
    setSponsorOpen(false);

    setProjectType("");
    setStartDate("");
    setEndDate("");
    setCode("");
    setDept("");
    setResStatus("confirmed");
    setColour(COLOURS[0]);
    setError(null);
  }

  function handleOpen() {
    setOpen(true);
  }

  function close() {
    setOpen(false);
    reset();
  }

  function handleSubmit() {
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }

    setError(null);

    startTx(async () => {
      try {
        const res = await fetch("/api/projects/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            title: name.trim(),
            project_code: code || null,
            department: dept || null,
            colour,
            resource_status: resStatus,
            start_date: startDate || null,
            finish_date: endDate || null,
            project_manager_name: pm || null,
            project_manager_user_id: pmUserId || null,
            sponsor_name: sponsor || null,
            sponsor_user_id: sponsorId || null,
            project_type: projectType || null,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }

        close();
        router.refresh();
      } catch (e: any) {
        setError(e?.message || "Failed to create project.");
      }
    });
  }

  const stepDotStyle = (active: boolean, complete = false): React.CSSProperties => ({
    width: 24,
    height: 24,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
    border: `1px solid ${active || complete ? UI.ink : UI.ruleStrong}`,
    background: complete || active ? UI.ink : UI.white,
    color: complete || active ? UI.white : UI.ink4,
    transition: "all .2s ease",
  });

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        style={{
          ...buttonBase({
            background: UI.ink,
            color: UI.white,
            border: `1px solid ${UI.ink}`,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 14px",
          }),
        }}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path
            d="M7 1v12M1 7h12"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        New project
      </button>

      {open && (
        <div
          ref={overlayRef}
          onMouseDown={(e) => {
            if (e.target === overlayRef.current) close();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,10,10,.28)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: UI.white,
              borderRadius: 18,
              width: "100%",
              maxWidth: 620,
              boxShadow: "0 30px 80px rgba(0,0,0,.16)",
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
              border: `1px solid ${UI.rule}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                padding: "24px 28px 0",
              }}
            >
              <div style={{ maxWidth: 420 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: UI.ink4,
                    marginBottom: 10,
                  }}
                >
                  Portfolio setup
                </div>

                <h2
                  style={{
                    fontSize: 24,
                    fontWeight: 750,
                    margin: 0,
                    letterSpacing: "-.03em",
                    color: UI.ink,
                    lineHeight: 1,
                  }}
                >
                  Create project
                </h2>

                <p
                  style={{
                    fontSize: 13,
                    color: UI.ink3,
                    margin: "8px 0 0",
                    lineHeight: 1.6,
                  }}
                >
                  Define ownership, timeline and portfolio metadata before the
                  project enters delivery governance.
                </p>
              </div>

              <button
                type="button"
                onClick={close}
                style={{
                  background: UI.white,
                  border: `1px solid ${UI.rule}`,
                  cursor: "pointer",
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M18 6 6 18M6 6l12 12"
                    stroke={UI.ink3}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "20px 28px 0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={stepDotStyle(step === 1, step > 1)}>
                  {step > 1 ? "✓" : "1"}
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: step === 1 ? UI.ink : UI.ink4,
                    textTransform: "uppercase",
                    letterSpacing: ".1em",
                  }}
                >
                  Basics
                </span>
              </div>

              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: step > 1 ? UI.ink : UI.rule,
                  transition: "background .2s ease",
                }}
              />

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={stepDotStyle(step === 2)}>
                  2
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: step === 2 ? UI.ink : UI.ink4,
                    textTransform: "uppercase",
                    letterSpacing: ".1em",
                  }}
                >
                  Heatmap
                </span>
              </div>
            </div>

            <div
              style={{
                padding: "22px 28px",
                display: "flex",
                flexDirection: "column",
                gap: 18,
                overflowY: "auto",
                flex: 1,
                background: UI.white,
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: UI.off2,
                  border: `1px solid ${UI.rule}`,
                  borderRadius: 999,
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 650,
                  color: UI.ink3,
                  width: "fit-content",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                    stroke={UI.ink3}
                    strokeWidth="2"
                  />
                </svg>
                Active organisation
              </div>

              {error && (
                <div
                  style={{
                    padding: "10px 13px",
                    borderRadius: 10,
                    background: UI.redBg,
                    border: `1px solid ${UI.redRule}`,
                    fontSize: 13,
                    color: UI.red,
                    fontWeight: 650,
                  }}
                >
                  {error}
                </div>
              )}

              {step === 1 ? (
                <>
                  <Field label="Project name">
                    <input
                      style={inputStyle}
                      placeholder="e.g. Project Venus"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>

                  <Field label="Project manager">
                    <div style={{ position: "relative" }}>
                      <input
                        style={inputStyle}
                        placeholder="Search by name or email..."
                        value={pmSearch}
                        onChange={(e) => {
                          const next = e.target.value;
                          setPmSearch(next);
                          setPmOpen(next.trim().length > 0);
                          setPmUserId(null);
                          setPm("");
                        }}
                        onFocus={() => {
                          if (pmSearch.trim().length > 0) setPmOpen(true);
                        }}
                        onBlur={() => {
                          window.setTimeout(() => setPmOpen(false), 150);
                        }}
                        autoComplete="off"
                      />

                      {pmOpen && members.length > 0 && (
                        <div style={{ ...menuStyle, maxHeight: 220 }}>
                          {filteredPmMembers.length > 0 ? (
                            filteredPmMembers.map((m) => (
                              <div
                                key={m.user_id}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  const selected = m.name || m.email;
                                  setPm(selected);
                                  setPmUserId(m.user_id);
                                  setPmSearch(selected);
                                  setPmOpen(false);
                                }}
                                style={{
                                  padding: "10px 14px",
                                  cursor: "pointer",
                                  fontSize: 13,
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 2,
                                  borderBottom: `1px solid ${UI.off}`,
                                  background: UI.white,
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.background = UI.off2)
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background = UI.white)
                                }
                              >
                                <span style={{ fontWeight: 650, color: UI.ink }}>
                                  {m.name || "—"}
                                </span>
                                <span style={{ fontSize: 11, color: UI.ink4 }}>
                                  {m.email}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div
                              style={{
                                padding: "10px 14px",
                                fontSize: 13,
                                color: UI.ink4,
                              }}
                            >
                              No members found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <p style={hintStyle}>
                      Assign now or later for delivery accountability.
                    </p>
                  </Field>

                  <Field label="Sponsor">
                    <div style={{ position: "relative" }}>
                      <input
                        style={inputStyle}
                        placeholder="Search by name or email..."
                        value={sponsorSearch}
                        onChange={(e) => {
                          const next = e.target.value;
                          setSponsorSearch(next);
                          setSponsorOpen(next.trim().length > 0);
                          setSponsorId(null);
                          setSponsor("");
                        }}
                        onFocus={() => {
                          if (sponsorSearch.trim().length > 0) {
                            setSponsorOpen(true);
                          }
                        }}
                        onBlur={() => {
                          window.setTimeout(() => setSponsorOpen(false), 150);
                        }}
                        autoComplete="off"
                      />

                      {sponsorOpen && members.length > 0 && (
                        <div style={{ ...menuStyle, maxHeight: 220 }}>
                          {filteredSponsorMembers.length > 0 ? (
                            filteredSponsorMembers.map((m) => (
                              <div
                                key={m.user_id}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  const selected = m.name || m.email;
                                  setSponsor(selected);
                                  setSponsorId(m.user_id);
                                  setSponsorSearch(selected);
                                  setSponsorOpen(false);
                                }}
                                style={{
                                  padding: "10px 14px",
                                  cursor: "pointer",
                                  fontSize: 13,
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 2,
                                  borderBottom: `1px solid ${UI.off}`,
                                  background: UI.white,
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.background = UI.off2)
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background = UI.white)
                                }
                              >
                                <span style={{ fontWeight: 650, color: UI.ink }}>
                                  {m.name || "—"}
                                </span>
                                <span style={{ fontSize: 11, color: UI.ink4 }}>
                                  {m.email}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div
                              style={{
                                padding: "10px 14px",
                                fontSize: 13,
                                color: UI.ink4,
                              }}
                            >
                              No members found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <p style={hintStyle}>
                      Executive accountable for budget and decision control.
                    </p>
                  </Field>

                  <Field label="Project type">
                    <select
                      style={inputStyle}
                      value={projectType}
                      onChange={(e) => setProjectType(e.target.value)}
                    >
                      <option value="">Select type...</option>
                      <option value="IT">IT</option>
                      <option value="Infrastructure">Infrastructure</option>
                      <option value="Change">Change</option>
                      <option value="BAU Enhancement">BAU Enhancement</option>
                      <option value="Regulatory">Regulatory</option>
                      <option value="Digital Transformation">
                        Digital Transformation
                      </option>
                      <option value="Product">Product</option>
                      <option value="Other">Other</option>
                    </select>
                    <p style={hintStyle}>
                      Used for reporting, filtering and portfolio segmentation.
                    </p>
                  </Field>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                    }}
                  >
                    <Field label="Start date">
                      <input
                        style={inputStyle}
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </Field>
                    <Field label="Finish date">
                      <input
                        style={inputStyle}
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 12px",
                      background: UI.off2,
                      borderRadius: 12,
                      border: `1px solid ${UI.rule}`,
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <rect
                        x="3"
                        y="3"
                        width="18"
                        height="18"
                        rx="2"
                        stroke={UI.ink3}
                        strokeWidth="2"
                      />
                      <path
                        d="M3 9h18M9 9v12M15 9v12"
                        stroke={UI.ink3}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: ".1em",
                        color: UI.ink3,
                        textTransform: "uppercase",
                      }}
                    >
                      Resource heatmap settings
                    </span>
                  </div>

                  <Field label="Department">
                    <input
                      style={inputStyle}
                      placeholder="e.g. Engineering"
                      value={dept}
                      onChange={(e) => setDept(e.target.value)}
                    />
                    <p style={hintStyle}>Used in heatmap filtering.</p>
                  </Field>

                  <Field label="Resource status">
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                      }}
                    >
                      {(["confirmed", "pipeline"] as const).map((s) => {
                        const active = resStatus === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setResStatus(s)}
                            style={{
                              border: `1px solid ${active ? UI.ink : UI.ruleStrong}`,
                              borderRadius: 10,
                              padding: "11px 14px",
                              fontSize: 13,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                              background: active ? UI.ink : UI.white,
                              color: active ? UI.white : UI.ink3,
                              fontWeight: active ? 700 : 600,
                              transition: "all .15s ease",
                            }}
                          >
                            {s === "confirmed" ? (
                              <>
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                >
                                  <polyline
                                    points="20 6 9 17 4 12"
                                    stroke={active ? "white" : UI.ink3}
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                Confirmed
                              </>
                            ) : (
                              <>◎ Pipeline</>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <p style={hintStyle}>
                      {resStatus === "confirmed"
                        ? "This appears in live portfolio capacity immediately."
                        : "This appears as forecast demand in the heatmap."}
                    </p>
                  </Field>

                  <Field label="Project colour">
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      {COLOURS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColour(c)}
                          title={c}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: c,
                            border:
                              colour === c
                                ? "2px solid #111111"
                                : "1px solid rgba(0,0,0,.08)",
                            cursor: "pointer",
                            transform: colour === c ? "scale(1.08)" : "scale(1)",
                            transition: "transform .15s ease, border-color .15s ease",
                          }}
                        />
                      ))}
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          background: UI.off2,
                          color: UI.ink3,
                          borderRadius: 8,
                          padding: "4px 8px",
                          border: `1px solid ${UI.rule}`,
                          marginLeft: 4,
                          fontFamily: "'DM Mono', monospace",
                        }}
                      >
                        {code || "PRJ"}
                      </span>
                    </div>
                    <p style={hintStyle}>
                      Used to identify the project visually in portfolio views.
                    </p>
                  </Field>
                </>
              )}
            </div>

            <div
              style={{
                padding: "16px 28px",
                borderTop: `1px solid ${UI.rule}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: UI.white,
              }}
            >
              {step === 1 ? (
                <>
                  <button
                    type="button"
                    onClick={close}
                    style={buttonBase({
                      background: UI.white,
                      border: `1px solid ${UI.ruleStrong}`,
                      color: UI.ink3,
                    })}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => name.trim() && setStep(2)}
                    style={buttonBase({
                      background: UI.ink,
                      color: UI.white,
                      border: `1px solid ${UI.ink}`,
                      opacity: name.trim() ? 1 : 0.45,
                    })}
                  >
                    Next: Heatmap settings →
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    style={buttonBase({
                      background: UI.white,
                      border: `1px solid ${UI.ruleStrong}`,
                      color: UI.ink3,
                    })}
                  >
                    ← Back
                  </button>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 11, color: UI.ink4 }}>
                      Add role requirements after creation.
                    </span>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isPending}
                      style={buttonBase({
                        background: isPending ? UI.ink4 : UI.ink,
                        color: UI.white,
                        border: `1px solid ${isPending ? UI.ink4 : UI.ink}`,
                        cursor: isPending ? "not-allowed" : "pointer",
                      })}
                    >
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