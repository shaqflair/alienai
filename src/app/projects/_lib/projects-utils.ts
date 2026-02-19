// src/app/projects/_lib/projects-utils.ts
import "server-only";

/* =========================
    Types
========================= */

export type MemberProjectRow = {
  project_id: string;
  role: string | null;
  projects: {
    id: string;
    title: string;
    project_code: string | number | null;
    start_date: string | null;
    finish_date: string | null;
    created_at: string;
    organisation_id: string | null;
    status?: string | null;
    lifecycle_status?: string | null;
    closed_at?: string | null;
    deleted_at?: string | null;

    // ✅ Enterprise PMO
    project_manager_id?: string | null;
    project_manager?: {
      id?: string | null;
      full_name?: string | null;
      email?: string | null;
    } | null;
  } | null;
};

export type ProjectListRow = {
  id: string;
  title: string;
  project_code: string | number | null;
  start_date: string | null;
  finish_date: string | null;
  created_at: string;
  organisation_id: string | null;
  status: string;
  myRole: string;

  // ✅ Enterprise PMO
  project_manager_id?: string | null;
  project_manager_name?: string | null;

  // ✅ lifecycle helpers (optional)
  lifecycle_status?: string | null;
  closed_at?: string | null;
};

export type FlashTone = "success" | "warn" | "error" | "info";

/* =========================
    Formatting Utilities
========================= */

export function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function norm(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

/** Formats ISO strings to DD/MM/YYYY */
export function fmtUkDate(x?: string | null) {
  const s = safeStr(x).trim();
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

/** Formats ISO strings to DD/MM/YYYY HH:mm */
export function fmtUkDateTime(x?: string | null) {
  const s = safeStr(x).trim();
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return s;
  }
}

export function fmtCode(x: unknown) {
  const s = safeStr(x).trim();
  return s ? s : "—";
}

/* =========================
    RBAC & UI Logic
========================= */

export function fmtRole(role?: string | null) {
  const v = safeStr(role).trim().toLowerCase();
  if (v === "owner")
    return { label: "Owner", cls: "bg-emerald-500/15 text-emerald-200 border-emerald-500/20" };
  if (v === "editor")
    return { label: "Editor", cls: "bg-cyan-500/15 text-cyan-200 border-cyan-500/20" };
  if (v === "viewer")
    return { label: "Viewer", cls: "bg-amber-500/15 text-amber-200 border-amber-500/20" };
  return {
    label: role ? safeStr(role) : "Member",
    cls: "bg-slate-500/15 text-slate-200 border-slate-500/20",
  };
}

export function canEditProject(role?: string | null) {
  const v = safeStr(role).trim().toLowerCase();
  return v === "owner" || v === "editor";
}

export function isOwner(role?: string | null) {
  return safeStr(role).trim().toLowerCase() === "owner";
}

/* =========================
    Invite Banner
========================= */

export function inviteBanner(invite?: string | null) {
  const v = safeStr(invite).trim().toLowerCase();
  if (!v) return null;

  if (v === "accepted") return { tone: "success" as const, msg: "✅ You’ve joined the organisation." };
  if (v === "expired") return { tone: "warn" as const, msg: "⚠️ Invite expired. Ask the owner to resend the invite." };
  if (v === "invalid") return { tone: "error" as const, msg: "❌ Invite invalid or already used. Ask the owner to resend it." };
  if (v === "email-mismatch")
    return {
      tone: "error" as const,
      msg: "❌ This invite was sent to a different email address. Sign in with the invited email, or ask the owner to re-invite you.",
    };
  if (v === "failed") return { tone: "error" as const, msg: "❌ Invite acceptance failed. Please try again or ask the owner to resend." };

  return null;
}

export function bannerClass(tone?: "success" | "warn" | "error") {
  if (tone === "success") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  if (tone === "warn") return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  if (tone === "error") return "border-rose-500/25 bg-rose-500/10 text-rose-200";
  return "border-slate-800 bg-[#0b1220] text-slate-200";
}

/* =========================
    Querystring Helpers
========================= */

export function buildQs(next: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    const s = safeStr(v).trim();
    if (s) sp.set(k, s);
  }
  const out = sp.toString();
  return out ? `?${out}` : "";
}

export function statusChip(isClosed: boolean) {
  return isClosed
    ? "bg-amber-500/15 text-amber-200 border-amber-500/25"
    : "bg-emerald-500/15 text-emerald-200 border-emerald-500/25";
}

/* =========================
    Flash Messaging Logic
========================= */

export function flashFromQuery(err?: string, msg?: string): { tone: FlashTone; text: string } | null {
  const e = safeStr(err).trim().toLowerCase();
  const m = safeStr(msg).trim().toLowerCase();

  if (e === "delete_confirm") return { tone: "error", text: 'Type "DELETE" to confirm deletion.' };
  if (e === "delete_forbidden") return { tone: "error", text: "Only the project owner can delete a project." };
  if (e === "no_permission") return { tone: "error", text: "You don’t have permission to perform that action." };
  if (e === "missing_project") return { tone: "error", text: "Missing project id." };
  if (e === "missing_title") return { tone: "error", text: "Title is required." };
  if (e === "missing_start") return { tone: "error", text: "Start date is required." };
  if (e === "missing_org") return { tone: "error", text: "Organisation is required." };
  if (e === "bad_org") return { tone: "error", text: "Invalid organisation selected." };
  if (e === "bad_finish") return { tone: "error", text: "Finish date cannot be before start date." };
  if (e === "bad_pm") return { tone: "error", text: "Invalid project manager selected." };

  if (m === "deleted") return { tone: "success", text: "Project deleted." };
  if (m === "closed") return { tone: "success", text: "Project closed. It is now read-only." };
  if (m === "reopened") return { tone: "success", text: "Project reopened. Editing is enabled." };
  if (m === "renamed") return { tone: "success", text: "Project renamed." };
  if (m === "abnormally_closed") return { tone: "warn", text: "Project closed (abnormal). Audit trail preserved." };

  return null;
}

export function flashCls(tone: FlashTone) {
  if (tone === "success") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  if (tone === "warn") return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  if (tone === "error") return "border-rose-500/25 bg-rose-500/10 text-rose-200";
  return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
}

/* =========================
    Navigation Helpers
========================= */

export function charterHref(projectId: string) {
  return `/projects/${projectId}/artifacts?type=PROJECT_CHARTER`;
}
export function changeHref(projectId: string) {
  return `/projects/${projectId}/change`;
}
export function raidHref(projectId: string) {
  return `/projects/${projectId}/raid`;
}
