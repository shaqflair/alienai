"use client";

import { useState, useTransition } from "react";
import {
  createOrgAction,
  savePersonaliseAction,
  saveCapacityAction,
  createFirstProjectAction,
  inviteTeamAction,
} from "../actions";

/* =============================================================================
   CONSTANTS
============================================================================= */

const TIMEZONES = [
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Rome",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "America/Toronto",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
  "UTC",
];

const INDUSTRIES = [
  "Consulting",
  "Technology",
  "Financial Services",
  "Healthcare",
  "Engineering",
  "Architecture",
  "Marketing & Creative",
  "Legal",
  "Construction",
  "Education",
  "Media & Entertainment",
  "Retail",
  "Government",
  "Non-profit",
  "Other",
];

const STEPS = [
  { id: "org", label: "Your organisation", icon: "O" },
  { id: "brand", label: "Personalise", icon: "P" },
  { id: "capacity", label: "Team capacity", icon: "C" },
  { id: "project", label: "First project", icon: "Pr" },
  { id: "invite", label: "Invite team", icon: "I" },
];

/* =============================================================================
   HELPERS
============================================================================= */

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: "16px",
        border: "1.5px solid #e2e8f0",
        padding: "28px",
        display: "flex",
        flexDirection: "column",
        gap: "18px",
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
        color: "#94a3b8",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        display: "block",
        marginBottom: "5px",
      }}
    >
      {children}
    </label>
  );
}

function Input({
  name,
  defaultValue,
  placeholder,
  type = "text",
  required,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <input
      name={name}
      type={type}
      defaultValue={defaultValue ?? ""}
      placeholder={placeholder ?? ""}
      required={required}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "10px 12px",
        borderRadius: "9px",
        border: "1.5px solid #e2e8f0",
        fontSize: "13px",
        fontFamily: "inherit",
        outline: "none",
        color: "#0f172a",
        background: "white",
      }}
    />
  );
}

function Select({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: string[];
  defaultValue?: string;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "10px 12px",
        borderRadius: "9px",
        border: "1.5px solid #e2e8f0",
        fontSize: "13px",
        fontFamily: "inherit",
        outline: "none",
        color: "#0f172a",
        background: "white",
        cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Btn({
  children,
  disabled,
  secondary,
  type = "button",
  onClick,
  style: extra,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  secondary?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "11px 24px",
        borderRadius: "10px",
        border: "none",
        background: disabled ? "#e2e8f0" : secondary ? "white" : "#0e7490",
        color: disabled ? "#94a3b8" : secondary ? "#475569" : "white",
        fontSize: "13px",
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        borderColor: secondary ? "#e2e8f0" : undefined,
        borderStyle: secondary ? "solid" : undefined,
        borderWidth: secondary ? "1.5px" : undefined,
        boxShadow:
          disabled || secondary ? "none" : "0 2px 12px rgba(14,116,144,0.25)",
        transition: "all 0.15s",
        ...extra,
      }}
    >
      {children}
    </button>
  );
}

function ErrorBox({ error }: { error: string }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: "8px",
        background: "rgba(239,68,68,0.08)",
        border: "1.5px solid rgba(239,68,68,0.2)",
        color: "#dc2626",
        fontSize: "12px",
        fontWeight: 600,
      }}
    >
      {error}
    </div>
  );
}

/* =============================================================================
   STEP COMPONENTS
============================================================================= */

function StepOrg({ onNext }: { onNext: (orgId: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        const res = await createOrgAction(fd);
        if (!res?.organisationId) {
          throw new Error("Organisation ID was not returned.");
        }
        onNext(res.organisationId);
      } catch (err: any) {
        setError(err?.message ?? "Failed to create organisation");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
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
            Create your organisation
          </h2>
          <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
            This is the workspace your team will share.
          </p>
        </div>

        {error && <ErrorBox error={error} />}

        <div>
          <Label>Organisation name *</Label>
          <Input name="name" placeholder="e.g. Acme Consulting" required />
        </div>

        <div>
          <Label>Industry</Label>
          <Select name="industry" options={["", ...INDUSTRIES]} />
        </div>

        <div>
          <Label>Timezone</Label>
          <Select
            name="timezone"
            options={TIMEZONES}
            defaultValue="Europe/London"
          />
          <p style={{ fontSize: "11px", color: "#94a3b8", margin: "5px 0 0" }}>
            Used for capacity calculations and weekly digests.
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn type="submit" disabled={pending}>
            {pending ? "Creating..." : "Continue"}
          </Btn>
        </div>
      </Section>
    </form>
  );
}

function StepBrand({
  orgId,
  onNext,
  onSkip,
}: {
  orgId: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [colour, setColour] = useState("#0e7490");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("organisation_id", orgId);

    startTransition(async () => {
      try {
        const res = await savePersonaliseAction(fd);
        if (!res?.ok) {
          throw new Error(res?.error ?? "Failed to save");
        }
        onNext();
      } catch (err: any) {
        setError(err?.message ?? "Failed to save");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
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
            Make it yours
          </h2>
          <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
            Add a logo and brand colour — used in emails and exports.
          </p>
        </div>

        {error && <ErrorBox error={error} />}

        <div>
          <Label>Logo URL</Label>
          <Input
            name="logo_url"
            placeholder="https://... (Supabase Storage public URL)"
          />
          <p style={{ fontSize: "11px", color: "#94a3b8", margin: "5px 0 0" }}>
            Paste a public image URL. You can add this later in Settings.
          </p>
        </div>

        <div>
          <Label>Brand colour</Label>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              name="brand_colour"
              type="color"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              style={{
                width: 44,
                height: 36,
                borderRadius: "8px",
                border: "1.5px solid #e2e8f0",
                cursor: "pointer",
                padding: "2px",
                background: "white",
              }}
            />
            <span
              style={{
                fontSize: "13px",
                color: "#475569",
                fontFamily: "monospace",
                fontWeight: 600,
              }}
            >
              {colour}
            </span>
          </div>
        </div>

        <div>
          <Label>Website</Label>
          <Input name="website" placeholder="https://company.com" type="url" />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Btn secondary onClick={onSkip}>
            Skip for now
          </Btn>
          <Btn type="submit" disabled={pending}>
            {pending ? "Saving..." : "Continue"}
          </Btn>
        </div>
      </Section>
    </form>
  );
}

function StepCapacity({
  orgId,
  onNext,
  onSkip,
}: {
  orgId: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [hours, setHours] = useState(8);
  const [days, setDays] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("organisation_id", orgId);

    startTransition(async () => {
      try {
        const res = await saveCapacityAction(fd);
        if (!res?.ok) {
          throw new Error(res?.error ?? "Failed to save");
        }
        onNext();
      } catch (err: any) {
        setError(err?.message ?? "Failed to save");
      }
    });
  }

  const weeklyCapacity = hours * days;

  const DAYS_OPTS = [
    { v: 3, l: "3 days / week" },
    { v: 4, l: "4 days / week" },
    { v: 5, l: "5 days / week (standard)" },
  ];

  return (
    <form onSubmit={handleSubmit}>
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
            Set team capacity defaults
          </h2>
          <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
            These defaults apply to new team members. You can override per
            person later.
          </p>
        </div>

        {error && <ErrorBox error={error} />}

        <div>
          <Label>Working days per week</Label>
          <div style={{ display: "flex", gap: "8px" }}>
            {DAYS_OPTS.map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setDays(opt.v)}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  borderRadius: "9px",
                  border: "1.5px solid",
                  borderColor: days === opt.v ? "#0e7490" : "#e2e8f0",
                  background:
                    days === opt.v ? "rgba(14,116,144,0.08)" : "white",
                  color: days === opt.v ? "#0e7490" : "#64748b",
                  fontSize: "12px",
                  fontWeight: days === opt.v ? 800 : 500,
                  cursor: "pointer",
                }}
              >
                {opt.l}
              </button>
            ))}
          </div>
          <input type="hidden" name="working_days" value={days} />
        </div>

        <div>
          <Label>Daily hours</Label>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              type="range"
              name="daily_hours"
              min={4}
              max={10}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#0e7490" }}
            />
            <span
              style={{
                fontSize: "16px",
                fontWeight: 900,
                color: "#0f172a",
                minWidth: 48,
                textAlign: "right",
              }}
            >
              {hours}h
            </span>
          </div>
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: "10px",
            background: "rgba(14,116,144,0.06)",
            border: "1.5px solid rgba(14,116,144,0.15)",
          }}
        >
          <div style={{ fontSize: "12px", color: "#0e7490", fontWeight: 700 }}>
            Weekly capacity per person
          </div>
          <div
            style={{
              fontSize: "22px",
              fontWeight: 900,
              color: "#0e7490",
              marginTop: "4px",
            }}
          >
            {weeklyCapacity} hours
          </div>
          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
            {days} days x {hours} hours/day
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Btn secondary onClick={onSkip}>
            Skip for now
          </Btn>
          <Btn type="submit" disabled={pending}>
            {pending ? "Saving..." : "Continue"}
          </Btn>
        </div>
      </Section>
    </form>
  );
}

function StepProject({
  orgId,
  onNext,
  onSkip,
}: {
  orgId: string;
  onNext: (projectId: string) => void;
  onSkip: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("organisation_id", orgId);

    startTransition(async () => {
      try {
        const res = await createFirstProjectAction(fd);
        if (!res?.projectId) {
          throw new Error("Project ID was not returned.");
        }
        onNext(res.projectId);
      } catch (err: any) {
        setError(err?.message ?? "Failed to create project");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
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
            Add your first project
          </h2>
          <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
            You can add more projects and set up allocations after onboarding.
          </p>
        </div>

        {error && <ErrorBox error={error} />}

        <div>
          <Label>Project title *</Label>
          <Input
            name="title"
            placeholder="e.g. Digital Transformation"
            required
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
          }}
        >
          <div>
            <Label>Project code</Label>
            <Input name="project_code" placeholder="e.g. DTP-001" />
          </div>
          <div>
            <Label>Status</Label>
            <select
              name="status"
              defaultValue="confirmed"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "9px",
                border: "1.5px solid #e2e8f0",
                fontSize: "13px",
                fontFamily: "inherit",
                outline: "none",
                color: "#0f172a",
                background: "white",
              }}
            >
              <option value="confirmed">Confirmed</option>
              <option value="pipeline">Pipeline</option>
            </select>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
          }}
        >
          <div>
            <Label>Start date</Label>
            <Input name="start_date" type="date" />
          </div>
          <div>
            <Label>End date</Label>
            <Input name="finish_date" type="date" />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Btn secondary onClick={onSkip}>
            Skip for now
          </Btn>
          <Btn type="submit" disabled={pending}>
            {pending ? "Creating..." : "Continue"}
          </Btn>
        </div>
      </Section>
    </form>
  );
}

function StepInvite({
  orgId,
  onFinish,
}: {
  orgId: string;
  onFinish: () => void;
}) {
  const [emails, setEmails] = useState("");
  const [result, setResult] = useState<{
    sent: number;
    errors?: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("organisation_id", orgId);

    startTransition(async () => {
      try {
        const res = await inviteTeamAction(fd);
        if (!res?.ok) {
          throw new Error(res?.error ?? "Failed to send invites");
        }

        const payload = {
          sent: Number(res?.sent ?? 0),
          errors: Array.isArray(res?.errors) ? res.errors : [],
        };

        setResult(payload);
        if (payload.sent > 0) setEmails("");
      } catch (err: any) {
        setError(err?.message ?? "Failed to send invites");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
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
            Invite your team
          </h2>
          <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
            They'll receive a branded invite email with a link to join.
          </p>
        </div>

        {error && <ErrorBox error={error} />}

        {result && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "8px",
              background:
                result.sent > 0
                  ? "rgba(16,185,129,0.08)"
                  : "rgba(245,158,11,0.08)",
              border: `1.5px solid ${
                result.sent > 0
                  ? "rgba(16,185,129,0.2)"
                  : "rgba(245,158,11,0.2)"
              }`,
              fontSize: "12px",
              fontWeight: 600,
              color: result.sent > 0 ? "#059669" : "#d97706",
            }}
          >
            {result.sent > 0
              ? `${result.sent} invite${result.sent !== 1 ? "s" : ""} sent!`
              : "No invites sent"}
          </div>
        )}

        <div>
          <Label>Email addresses</Label>
          <textarea
            name="emails"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder={"alice@company.com\nbob@company.com"}
            rows={5}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              borderRadius: "9px",
              border: "1.5px solid #e2e8f0",
              fontSize: "13px",
              fontFamily: "inherit",
              outline: "none",
              resize: "vertical",
              color: "#0f172a",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Btn secondary onClick={onFinish} type="button">
            {result?.sent ? "Go to dashboard" : "Skip for now"}
          </Btn>
          <Btn type="submit" disabled={pending || !emails.trim()}>
            {pending ? "Sending..." : "Send invites"}
          </Btn>
        </div>
      </Section>
    </form>
  );
}

/* =============================================================================
   MAIN WIZARD
============================================================================= */

export default function OnboardingWizard({
  userEmail,
  userName,
}: {
  userEmail: string;
  userName: string;
}) {
  const [step, setStep] = useState(0);
  const [orgId, setOrgId] = useState<string | null>(null);

  function finish() {
    window.location.href = "/";
  }

  const pct = Math.round((step / STEPS.length) * 100);

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, #0a0f1e 0%, #0e1628 50%, #0a1628 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "560px" }}>
        <div
          style={{
            height: 3,
            background: "rgba(255,255,255,0.1)",
            marginBottom: 24,
            borderRadius: 2,
          }}
        >
          <div
            style={{
              height: "100%",
              background: "#0e7490",
              width: `${pct}%`,
              transition: "width 0.3s",
            }}
          />
        </div>

        {step === 0 && (
          <StepOrg
            onNext={(id) => {
              setOrgId(id);
              setStep(1);
            }}
          />
        )}

        {step === 1 && orgId && (
          <StepBrand
            orgId={orgId}
            onNext={() => setStep(2)}
            onSkip={() => setStep(2)}
          />
        )}

        {step === 2 && orgId && (
          <StepCapacity
            orgId={orgId}
            onNext={() => setStep(3)}
            onSkip={() => setStep(3)}
          />
        )}

        {step === 3 && orgId && (
          <StepProject
            orgId={orgId}
            onNext={() => setStep(4)}
            onSkip={() => setStep(4)}
          />
        )}

        {step === 4 && orgId && <StepInvite orgId={orgId} onFinish={finish} />}

        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 11,
            color: "rgba(255,255,255,0.4)",
          }}
        >
          Step {step + 1} of {STEPS.length}
          {userName ? ` · ${userName}` : ""}
          {userEmail ? ` · ${userEmail}` : ""}
        </div>
      </div>
    </div>
  );
}