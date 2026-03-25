// src/app/onboarding/_components/ProfileSetupForm.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { saveOnboardingProfile } from "../actions";

type EmploymentType = "full_time" | "part_time" | "contractor";
type ManagerOption = {
  user_id: string;
  full_name: string;
  job_title: string | null;
  department: string | null;
};

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.96)",
        borderRadius: "20px",
        border: "1px solid rgba(255,255,255,0.18)",
        padding: "28px",
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        boxShadow: "0 20px 60px rgba(2,6,23,0.32)",
        backdropFilter: "blur(16px)",
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        fontSize: "10px",
        fontWeight: 800,
        color: "#64748b",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        display: "block",
        marginBottom: "6px",
      }}
    >
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: "12px",
  border: "1.5px solid #dbe4ee",
  fontSize: "13px",
  fontFamily: "inherit",
  outline: "none",
  color: "#0f172a",
  background: "white",
};

function Btn({
  children,
  disabled,
  secondary,
  type = "button",
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  secondary?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "11px 24px",
        borderRadius: "12px",
        background: disabled ? "#e2e8f0" : secondary ? "white" : "#0e7490",
        color: disabled ? "#94a3b8" : secondary ? "#475569" : "white",
        fontSize: "13px",
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        border: secondary ? "1.5px solid #e2e8f0" : "none",
        boxShadow:
          disabled || secondary ? "none" : "0 8px 24px rgba(14,116,144,0.28)",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

const DEPTS = [
  "Technology",
  "Product",
  "Engineering",
  "Design",
  "Finance",
  "Commercial",
  "Operations",
  "HR",
  "Legal",
  "Marketing",
  "PMO",
  "Other",
];

function ManagerSearch({
  value,
  onChange,
}: {
  value: { id: string; name: string };
  onChange: (id: string, name: string) => void;
}) {
  const [q, setQ] = useState(value.name);
  const [opts, setOpts] = useState<ManagerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function search(term: string) {
    if (term.trim().length < 2) {
      setOpts([]);
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        "/api/line-manager?q=" + encodeURIComponent(term.trim()) + "&limit=8"
      );
      const j = await res.json().catch(() => ({ ok: false }));
      if (j?.ok && Array.isArray(j.users)) {
        setOpts(j.users);
        setOpen(true);
      } else {
        setOpts([]);
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        value={q}
        onChange={(e) => {
          const next = e.target.value;
          setQ(next);
          if (!next) onChange("", "");
          search(next);
        }}
        onFocus={() => {
          if (opts.length > 0 && !value.id) setOpen(true);
        }}
        placeholder="Search by name..."
        style={inputStyle}
        autoComplete="off"
      />

      {busy && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "#94a3b8",
            fontWeight: 600,
          }}
        >
          Searching…
        </div>
      )}

      {value.id && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(14,116,144,0.08)",
            border: "1.5px solid rgba(14,116,144,0.2)",
            fontSize: 12,
            fontWeight: 700,
            color: "#0e7490",
          }}
        >
          {value.name} selected
          <button
            type="button"
            onClick={() => {
              onChange("", "");
              setQ("");
              setOpts([]);
              setOpen(false);
            }}
            style={{
              marginLeft: 8,
              color: "#94a3b8",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Clear
          </button>
        </div>
      )}

      {open && opts.length > 0 && !value.id && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              zIndex: 20,
              top: "100%",
              marginTop: 6,
              width: "100%",
              background: "white",
              borderRadius: 14,
              border: "1.5px solid #e2e8f0",
              boxShadow: "0 16px 40px rgba(15,23,42,0.14)",
              overflow: "hidden",
            }}
          >
            {opts.map((o) => (
              <button
                key={o.user_id}
                type="button"
                onClick={() => {
                  onChange(o.user_id, o.full_name || "");
                  setQ(o.full_name || "");
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "11px 14px",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#0f172a",
                  }}
                >
                  {o.full_name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#94a3b8",
                    marginTop: 2,
                  }}
                >
                  {[o.job_title, o.department].filter(Boolean).join(" · ")}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const STEPS = ["Your details", "Your organisation", "Finish"];

function WelcomeBanner({
  orgName,
  invitedRole,
}: {
  orgName?: string;
  invitedRole?: string;
}) {
  if (!orgName && !invitedRole) return null;

  return (
    <div
      style={{
        marginBottom: 18,
        padding: "16px 18px",
        borderRadius: 16,
        background:
          "linear-gradient(135deg, rgba(14,116,144,0.16), rgba(15,23,42,0.10))",
        border: "1px solid rgba(125,211,252,0.22)",
        color: "white",
        boxShadow: "0 16px 40px rgba(2,6,23,0.18)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "rgba(186,230,253,0.95)",
          marginBottom: 6,
        }}
      >
        Welcome to Aliena
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 900,
          lineHeight: 1.2,
          marginBottom: 6,
        }}
      >
        {orgName ? `You’ve joined ${orgName}` : "Your account is ready"}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(226,232,240,0.92)",
          lineHeight: 1.55,
        }}
      >
        {invitedRole
          ? `Your organisation invite has already been accepted. Finish your profile to start as ${invitedRole.replaceAll("_", " ")}.`
          : "Your organisation access is already connected. Finish your profile to get started."}
      </div>
    </div>
  );
}

function StepDetails({
  name,
  setName,
  jobTitle,
  setJobTitle,
  employmentType,
  setEmploymentType,
  onNext,
  orgName,
}: {
  name: string;
  setName: (v: string) => void;
  jobTitle: string;
  setJobTitle: (v: string) => void;
  employmentType: EmploymentType;
  setEmploymentType: (v: EmploymentType) => void;
  onNext: () => void;
  orgName?: string;
}) {
  const canNext = name.trim().length >= 2 && jobTitle.trim().length >= 2;

  return (
    <Section>
      <div>
        <h2
          style={{
            fontSize: "20px",
            fontWeight: 900,
            color: "#0f172a",
            margin: "0 0 6px",
          }}
        >
          Tell us about yourself
        </h2>
        <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
          {orgName
            ? `This is how you’ll appear inside ${orgName}.`
            : "This appears in project assignments and portfolio reporting."}
        </p>
      </div>

      <div>
        <Label>Full name *</Label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          style={inputStyle}
          autoFocus
        />
      </div>

      <div>
        <Label>Job title *</Label>
        <input
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="e.g. Senior Project Manager"
          style={inputStyle}
        />
      </div>

      <div>
        <Label>Employment type</Label>
        <div style={{ display: "flex", gap: 8 }}>
          {(
            [
              ["full_time", "Full time"],
              ["part_time", "Part time"],
              ["contractor", "Contractor"],
            ] as [EmploymentType, string][]
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setEmploymentType(v)}
              style={{
                flex: 1,
                padding: "10px 8px",
                borderRadius: 10,
                border: "1.5px solid",
                cursor: "pointer",
                borderColor: employmentType === v ? "#0e7490" : "#e2e8f0",
                background:
                  employmentType === v ? "rgba(14,116,144,0.08)" : "white",
                color: employmentType === v ? "#0e7490" : "#64748b",
                fontSize: 12,
                fontWeight: employmentType === v ? 800 : 500,
                fontFamily: "inherit",
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn disabled={!canNext} onClick={onNext}>
          Continue
        </Btn>
      </div>
    </Section>
  );
}

function StepOrg({
  dept,
  setDept,
  location,
  setLocation,
  manager,
  setManager,
  onBack,
  onNext,
  invitedRole,
}: {
  dept: string;
  setDept: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  manager: { id: string; name: string };
  setManager: (id: string, name: string) => void;
  onBack: () => void;
  onNext: () => void;
  invitedRole?: string;
}) {
  const canNext = dept.trim().length >= 1;

  return (
    <Section>
      <div>
        <h2
          style={{
            fontSize: "20px",
            fontWeight: 900,
            color: "#0f172a",
            margin: "0 0 6px",
          }}
        >
          Your organisation details
        </h2>
        <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
          {invitedRole
            ? `We’ll tailor your workspace as ${invitedRole.replaceAll("_", " ")}.`
            : "Helps route approvals and portfolio reporting correctly."}
        </p>
      </div>

      <div>
        <Label>Department *</Label>
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          <option value="">Select department</option>
          {DEPTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label>Line manager</Label>
        <ManagerSearch value={manager} onChange={setManager} />
      </div>

      <div>
        <Label>Office / location</Label>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. London"
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn secondary onClick={onBack}>
          Back
        </Btn>
        <Btn disabled={!canNext} onClick={onNext}>
          Continue
        </Btn>
      </div>
    </Section>
  );
}

function StepFinish({
  name,
  jobTitle,
  dept,
  employmentType,
  location,
  managerName,
  bio,
  setBio,
  onBack,
  onSubmit,
  pending,
  error,
  orgName,
  invitedRole,
}: {
  name: string;
  jobTitle: string;
  dept: string;
  employmentType: string;
  location: string;
  managerName: string;
  bio: string;
  setBio: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  pending: boolean;
  error: string | null;
  orgName?: string;
  invitedRole?: string;
}) {
  return (
    <Section>
      <div>
        <h2
          style={{
            fontSize: "20px",
            fontWeight: 900,
            color: "#0f172a",
            margin: "0 0 6px",
          }}
        >
          Almost done
        </h2>
        <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
          {orgName
            ? `Complete this last step and start inside ${orgName}.`
            : "Optional bio, then you're in."}
        </p>
      </div>

      <div
        style={{
          borderRadius: 14,
          border: "1.5px solid #e2e8f0",
          background: "#f8fafc",
          padding: "14px 16px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            marginBottom: 10,
          }}
        >
          Profile summary
        </div>

        {orgName && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
              fontSize: 12,
            }}
          >
            <span style={{ color: "#94a3b8" }}>Organisation</span>
            <span style={{ fontWeight: 700, color: "#0f172a" }}>{orgName}</span>
          </div>
        )}

        {invitedRole && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
              fontSize: 12,
            }}
          >
            <span style={{ color: "#94a3b8" }}>Role</span>
            <span
              style={{
                fontWeight: 700,
                color: "#0f172a",
                textTransform: "capitalize",
              }}
            >
              {invitedRole.replaceAll("_", " ")}
            </span>
          </div>
        )}

        {[
          ["Name", name],
          ["Job title", jobTitle],
          ["Department", dept],
          ["Employment", employmentType.replace("_", " ")],
          ["Location", location || "Not set"],
          ["Line manager", managerName || "Not set"],
        ].map(([label, val]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
              fontSize: 12,
            }}
          >
            <span style={{ color: "#94a3b8" }}>{label}</span>
            <span
              style={{
                fontWeight: 700,
                color: "#0f172a",
                textTransform: "capitalize",
              }}
            >
              {val}
            </span>
          </div>
        ))}
      </div>

      <div>
        <Label>Bio (optional)</Label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="2-3 sentences about your background..."
          rows={3}
          style={{ ...inputStyle, resize: "vertical" as const }}
        />
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(239,68,68,0.08)",
            border: "1.5px solid rgba(239,68,68,0.2)",
            color: "#dc2626",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn secondary onClick={onBack}>
          Back
        </Btn>
        <Btn disabled={pending} onClick={onSubmit}>
          {pending ? "Saving..." : "Go to dashboard"}
        </Btn>
      </div>
    </Section>
  );
}

export default function ProfileSetupForm({
  initialName,
  orgName,
  invitedRole,
}: {
  initialName: string;
  orgName?: string;
  invitedRole?: string;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [jobTitle, setJobTitle] = useState("");
  const [dept, setDept] = useState("");
  const [employmentType, setEmploymentType] =
    useState<EmploymentType>("full_time");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [manager, setManagerState] = useState({ id: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setManager(id: string, name: string) {
    setManagerState({ id, name });
  }

  function handleSubmit() {
    setError(null);

    const fd = new FormData();
    fd.set("full_name", name.trim());
    fd.set("job_title", jobTitle.trim());
    fd.set("department", dept.trim());
    fd.set("employment_type", employmentType);
    fd.set("location", location.trim());
    fd.set("bio", bio.trim());
    fd.set("line_manager_id", manager.id);

    startTransition(async () => {
      const result = await saveOnboardingProfile(fd);
      if (!result?.ok) {
        setError(result?.error ?? "Failed to save profile. Please try again.");
        return;
      }
      window.location.href = "/";
    });
  }

  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  const subtitle = useMemo(() => {
    if (orgName && invitedRole) {
      return `Joined ${orgName} as ${invitedRole.replaceAll("_", " ")}.`;
    }
    if (orgName) return `Joined ${orgName}.`;
    return "Complete your profile to start using Aliena.";
  }, [orgName, invitedRole]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(14,116,144,0.22), transparent 30%), linear-gradient(135deg, #0a0f1e 0%, #0e1628 50%, #0a1628 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "560px" }}>
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.12em",
              color: "rgba(186,230,253,0.92)",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Aliena onboarding
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 900,
              lineHeight: 1.1,
              color: "white",
              marginBottom: 8,
            }}
          >
            Complete your profile
          </div>
          <div
            style={{
              fontSize: 13,
              color: "rgba(226,232,240,0.82)",
              lineHeight: 1.6,
            }}
          >
            {subtitle}
          </div>
        </div>

        <WelcomeBanner orgName={orgName} invitedRole={invitedRole} />

        <div
          style={{
            height: 4,
            background: "rgba(255,255,255,0.1)",
            marginBottom: 24,
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              background: "linear-gradient(90deg, #22d3ee, #0e7490)",
              width: `${pct}%`,
              transition: "width 0.3s",
            }}
          />
        </div>

        {step === 0 && (
          <StepDetails
            name={name}
            setName={setName}
            jobTitle={jobTitle}
            setJobTitle={setJobTitle}
            employmentType={employmentType}
            setEmploymentType={setEmploymentType}
            onNext={() => setStep(1)}
            orgName={orgName}
          />
        )}

        {step === 1 && (
          <StepOrg
            dept={dept}
            setDept={setDept}
            location={location}
            setLocation={setLocation}
            manager={manager}
            setManager={setManager}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            invitedRole={invitedRole}
          />
        )}

        {step === 2 && (
          <StepFinish
            name={name}
            jobTitle={jobTitle}
            dept={dept}
            employmentType={employmentType}
            location={location}
            managerName={manager.name}
            bio={bio}
            setBio={setBio}
            onBack={() => setStep(1)}
            onSubmit={handleSubmit}
            pending={pending}
            error={error}
            orgName={orgName}
            invitedRole={invitedRole}
          />
        )}

        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 11,
            color: "rgba(255,255,255,0.48)",
          }}
        >
          Complete your profile · Step {step + 1} of {STEPS.length}
        </div>
      </div>
    </div>
  );
}