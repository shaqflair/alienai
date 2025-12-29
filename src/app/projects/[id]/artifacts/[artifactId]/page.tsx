// src/app/projects/[id]/artifacts/[artifactId]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

import { updateArtifact, addArtifactComment } from "../actions";
import ProjectCharterEditorForm from "@/components/editors/ProjectCharterEditorForm";
import { PROJECT_CHARTER_TEMPLATE } from "@/components/editors/charter-template";

import {
  submitArtifactForApproval,
  approveArtifact,
  requestChangesArtifact,
  rejectFinalArtifact,
  addSuggestion,
  applySuggestion,
  dismissSuggestion,
  renameArtifactTitle,
} from "./approval-actions";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function fmtWhen(x: string | null) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return String(x);
  }
}

function derivedStatus(a: any) {
  const s = String(a?.approval_status ?? "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "changes_requested") return "changes_requested";
  if (s === "submitted") return "submitted";

  // legacy fallbacks
  if (a?.approved_by) return "approved";
  if (a?.rejected_by) return "rejected";
  if (a?.is_locked) return "submitted";
  return "draft";
}

function statusPill(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return { label: "✅ Approved", cls: "bg-gray-100 border-gray-200 text-gray-900" };
  if (s === "rejected") return { label: "⛔ Rejected (Final)", cls: "bg-gray-100 border-gray-200 text-gray-900" };
  if (s === "changes_requested")
    return { label: "🛠 Changes requested (CR)", cls: "bg-gray-100 border-gray-200 text-gray-900" };
  if (s === "submitted") return { label: "🟡 Submitted", cls: "bg-gray-100 border-gray-200 text-gray-900" };
  return { label: "📝 Draft", cls: "bg-gray-100 border-gray-200 text-gray-900" };
}

function initialsFrom(nameOrEmail: string) {
  const s = String(nameOrEmail ?? "").trim();
  if (!s) return "—";
  const parts = s.split(/[\s.@_-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (a + b).toUpperCase() || s.slice(0, 2).toUpperCase();
}

function isProjectCharterType(type: any) {
  const t = String(type ?? "").toLowerCase();
  return t === "project_charter" || t === "project charter" || t === "charter" || t === "projectcharter" || t === "pid";
}

// legacy tiptap doc check (kept for backward compatibility)
function safeJsonDoc(x: any) {
  if (!x || typeof x !== "object") return null;
  if ((x as any).type !== "doc" || !Array.isArray((x as any).content)) return null;
  return x;
}

/**
 * ✅ Always force project title into whatever charter JSON we have.
 * - Works for v2, template, legacy objects, or empty.
 * - Prevents meta.project_title showing "(from project)" placeholders in the UI.
 */
function forceProjectTitleIntoCharter(raw: any, projectTitle: string, clientName?: string) {
  const title = String(projectTitle ?? "").trim();
  const client = String(clientName ?? "").trim();

  // If raw is a useful object, clone + set meta
  if (raw && typeof raw === "object") {
    const next = structuredClone(raw) as any;
    next.meta = next.meta && typeof next.meta === "object" ? next.meta : {};
    next.meta.project_title = title; // ✅ force (do not keep placeholder)
    if (client && !next.meta.customer_account) next.meta.customer_account = client;
    return next;
  }

  // raw is null/primitive -> return minimal object the editor will normalize
  return {
    version: 2,
    type: "project_charter",
    meta: { project_title: title, customer_account: client || "" },
    sections: [],
  };
}

/**
 * ✅ Canonicalize to stored v2 shape for the editor.
 * Handles:
 * - proper stored v2: {version:2,type,meta,sections}
 * - common "saved" shape: {meta,sections,legacy_raw} (missing version/type)
 */
function ensureCharterV2Stored(raw: any) {
  if (raw && typeof raw === "object" && Number((raw as any).version) === 2 && Array.isArray((raw as any).sections)) {
    return raw;
  }

  if (raw && typeof raw === "object" && Array.isArray((raw as any).sections)) {
    return {
      version: 2,
      type: "project_charter",
      meta: (raw as any).meta ?? {},
      sections: (raw as any).sections ?? [],
    };
  }

  return raw;
}

/**
 * ✅ Get best possible initial JSON for the editor.
 * Prefers artifacts.content_json.
 * Falls back to legacy artifacts.content if it contains JSON.
 * Otherwise falls back to template.
 */
function getCharterInitialRaw(artifact: any) {
  const cj = artifact?.content_json;

  // content_json as object
  if (cj && typeof cj === "object") return cj;

  // content_json as stringified JSON
  if (typeof cj === "string") {
    try {
      return JSON.parse(cj);
    } catch {
      // ignore
    }
  }

  // legacy: some old records store JSON in content
  const legacy = artifact?.content;

  if (legacy && typeof legacy === "object") return legacy;

  if (typeof legacy === "string") {
    const s = legacy.trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return JSON.parse(s);
      } catch {
        // ignore
      }
    }
  }

  // tiptap object (rare case)
  const tiptap = safeJsonDoc(cj);
  if (tiptap) return tiptap;

  // final fallback
  return PROJECT_CHARTER_TEMPLATE;
}

export default async function ArtifactDetailPage({
  params,
}: {
  params: Promise<{ id?: string; artifactId?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { id, artifactId: aid } = await params;
  const projectId = safeParam(id);
  const artifactId = safeParam(aid);
  if (!projectId || !artifactId || projectId === "undefined" || artifactId === "undefined") notFound();

  // ✅ Fetch project (ONLY real columns you said you have)
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, title, client_name, client_logo_url, brand_primary_color")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!project) notFound();

  const projectTitleFromProject = String((project as any).title ?? "").trim();
  const clientName = String((project as any).client_name ?? "").trim();

  // Member gate
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!mem) notFound();

  const myRole = String((mem as any)?.role ?? "viewer").toLowerCase();
  const canEditByRole = myRole === "owner" || myRole === "editor";

  // Artifact (include content_json for charter + version control columns)
  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select(
      [
        "id",
        "project_id",
        "user_id",
        "type",
        "title",
        "content",
        "content_json",
        "created_at",
        "updated_at",
        "is_locked",
        "locked_at",
        "locked_by",
        "approval_status",
        "approved_by",
        "approved_at",
        "rejected_by",
        "rejected_at",
        "rejection_reason",
        // ✅ versioning columns
        "version",
        "parent_artifact_id",
        "root_artifact_id",
        "is_current",
        "is_baseline",
      ].join(", ")
    )
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (artErr) throw artErr;
  if (!artifact) notFound();

  const status = derivedStatus(artifact);
  const pill = statusPill(status);
  const isAuthor = String((artifact as any).user_id) === auth.user.id;

  // Approver gate (flat approvers v1)
  const { data: approverRow, error: apprErr } = await supabase
    .from("project_approvers")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (apprErr) console.warn("[project_approvers.select] blocked:", apprErr.message);
  const isApprover = !!approverRow;

  // Edit rules
  const isEditable =
    canEditByRole && !(artifact as any).is_locked && (status === "draft" || status === "changes_requested");

  // ✅ Lock layout once submitted/approved/rejected
  const lockLayout = status === "submitted" || status === "approved" || status === "rejected";

  // Submit/resubmit rules
  const canSubmitOrResubmit =
    !(artifact as any).is_locked &&
    (status === "draft" || status === "changes_requested") &&
    (isAuthor || canEditByRole);

  // Decisions
  const canDecide = isApprover && status === "submitted" && !isAuthor;

  // Title rename rule
  const canRenameTitle =
    !(artifact as any).is_locked &&
    (status === "draft" || status === "changes_requested") &&
    (isAuthor || canEditByRole);

  // Exports: safe to allow to any project member
  const canExport = true;

  // ✅ Create revision rule (Option B: from approved/rejected current, non-baseline)
  const canCreateRevision =
    canEditByRole &&
    !!(artifact as any).is_current &&
    !(artifact as any).is_baseline &&
    (status === "approved" || status === "rejected");

  // Suggestions
  const { data: suggestions } = await supabase
    .from("artifact_suggestions")
    .select("id, actor_user_id, anchor, range, suggested_text, style, status, created_at")
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: false })
    .limit(200);

  // Comments
  const { data: comments } = await supabase
    .from("artifact_comments")
    .select("id, actor_user_id, action, body, created_at")
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: true })
    .limit(500);

  // Profiles (best effort)
  const ids = Array.from(
    new Set(
      [
        ...(comments ?? []).map((c: any) => String(c.actor_user_id ?? "")),
        ...(suggestions ?? []).map((s: any) => String(s.actor_user_id ?? "")),
      ].filter(Boolean)
    )
  );

  const { data: profiles, error: profErr } = ids.length
    ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids)
    : ({ data: [] as any[], error: null } as any);
  if (profErr) console.warn("[profiles.select] blocked:", profErr.message);

  const byId = new Map<string, any>();
  for (const pr of profiles ?? []) byId.set(String(pr.user_id), pr);

  function displayUser(uid: string) {
    const pr = byId.get(uid);
    const fullName = String(pr?.full_name ?? "").trim();
    const email = String(pr?.email ?? "").trim();
    const title = fullName || email || uid.slice(0, 8) + "…";
    return { title, initials: initialsFrom(fullName || email || uid) };
  }

  /* ---------------------------
     Inline Server Actions
  ---------------------------- */
  async function submitAction() {
    "use server";
    await submitArtifactForApproval(projectId, artifactId);
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  }

  async function approveAction() {
    "use server";
    await approveArtifact(projectId, artifactId);
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  }

  async function requestChangesAction(formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim() || undefined;
    await requestChangesArtifact(projectId, artifactId, reason);
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  }

  async function rejectFinalAction(formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim() || undefined;
    const confirm = String(formData.get("confirm") ?? "").trim().toUpperCase();
    if (confirm !== "REJECT") throw new Error('Type REJECT to confirm a final rejection.');
    await rejectFinalArtifact(projectId, artifactId, reason);
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  }

  async function renameTitleAction(formData: FormData) {
    "use server";
    await renameArtifactTitle(formData);
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  }

  /**
   * ✅ Create a NEW revision record (draft, current) from this artifact.
   * - Retires current (for this project+type) by setting is_current=false
   * - Inserts a new artifact:
   *    parent_artifact_id = current.id
   *    root_artifact_id = current.root_artifact_id ?? current.id
   *    version = (current.version ?? 1) + 1
   *    approval_status/status = draft
   *    unlocked
   *
   * NOTE: This is implemented without an RPC. If you later add an RPC, you can swap this body out.
   */
  async function createRevisionAction() {
    "use server";

    const supabase2 = await createClient();
    const { data: auth2, error: authErr2 } = await supabase2.auth.getUser();
    if (authErr2) throw authErr2;
    if (!auth2?.user) redirect("/login");

    // Re-check membership role server-side
    const { data: mem2, error: memErr2 } = await supabase2
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", auth2.user.id)
      .maybeSingle();

    if (memErr2) throw memErr2;
    const myRole2 = String((mem2 as any)?.role ?? "viewer").toLowerCase();
    if (!(myRole2 === "owner" || myRole2 === "editor")) throw new Error("Only owners/editors can create revisions.");

    // Load the current artifact fresh (avoid stale UI state)
    const { data: a0, error: aErr } = await supabase2
      .from("artifacts")
      .select(
        [
          "id",
          "project_id",
          "user_id",
          "type",
          "title",
          "content",
          "content_json",
          "approval_status",
          "is_locked",
          "is_current",
          "is_baseline",
          "root_artifact_id",
          "version",
        ].join(", ")
      )
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (aErr) throw aErr;
    if (!a0) throw new Error("Artifact not found.");
    if (!a0.type) throw new Error("Artifact type missing.");

    const st = String(a0.approval_status ?? "draft").toLowerCase();
    const allowed = (st === "approved" || st === "rejected") && !!a0.is_current && !a0.is_baseline;
    if (!allowed) {
      throw new Error("You can only create a revision from a current, non-baseline artifact that is approved or rejected.");
    }

    // 1) retire current for this project+type (prevents unique constraint conflict on (project_id,type) where is_current=true)
    const { error: retireErr } = await supabase2
      .from("artifacts")
      .update({ is_current: false })
      .eq("project_id", projectId)
      .eq("type", a0.type)
      .eq("is_current", true);

    if (retireErr) {
      throw new Error(`[artifacts.update(retire_current)] ${retireErr.code ?? ""} ${retireErr.message}`);
    }

    const rootId = String((a0 as any).root_artifact_id ?? a0.id);
    const nextVersion = Number((a0 as any).version ?? 1) + 1;

    // 2) insert the new revision (draft + current + unlocked)
    const nowIso = new Date().toISOString();
    const { data: inserted, error: insErr } = await supabase2
      .from("artifacts")
      .insert({
        project_id: projectId,
        user_id: auth2.user.id, // author of revision = creator
        type: a0.type,
        title: a0.title ?? null,
        content: String(a0.content ?? ""), // NOT NULL
        content_json: (a0 as any).content_json ?? null,

        version: nextVersion,
        parent_artifact_id: a0.id,
        root_artifact_id: rootId,

        approval_status: "draft",
        status: "draft",

        is_locked: false,
        locked_at: null,
        locked_by: null,

        is_current: true,
        is_baseline: false,

        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .single();

    if (insErr) {
      throw new Error(`[artifacts.insert(revision)] ${insErr.code ?? ""} ${insErr.message}`);
    }

    const newId = String((inserted as any).id);

    revalidatePath(`/projects/${projectId}/artifacts`);
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectId}/artifacts/${newId}`);

    redirect(`/projects/${projectId}/artifacts/${newId}`);
  }

  const charterMode = isProjectCharterType((artifact as any).type);

  // ✅ Build initial JSON, canonicalize to stored v2, then force project title into meta (no placeholders)
  const charterInitialRaw = ensureCharterV2Stored(getCharterInitialRaw(artifact));
  const charterInitial = forceProjectTitleIntoCharter(charterInitialRaw, projectTitleFromProject, clientName);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectId}/artifacts`}>
          ← Back to Artifacts
        </Link>
        <div className="flex items-center gap-3">
          {isApprover ? (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-100 border-gray-200 text-gray-900">
              Approver
            </span>
          ) : null}
          <span>
            Role: <span className="font-mono">{myRole}</span>
          </span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${pill.cls}`}>{pill.label}</span>
        </div>
      </div>

      <header className="space-y-2">
        {canRenameTitle ? (
          <form action={renameTitleAction} className="flex flex-wrap gap-2 items-center">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="artifact_id" value={artifactId} />
            <input
              name="title"
              defaultValue={String((artifact as any).title ?? "")}
              className="w-full md:w-[520px] text-2xl font-semibold border rounded-xl px-3 py-2"
              placeholder="Artifact title…"
            />
            <button type="submit" className="px-4 py-2 rounded-xl bg-black text-white text-sm">
              Save name
            </button>
          </form>
        ) : (
          <h1 className="text-2xl font-semibold">{(artifact as any).title || (artifact as any).type || "Artifact"}</h1>
        )}

        <div className="text-sm text-gray-600 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded border px-2 py-0.5 bg-gray-50">
            Type: <span className="ml-1 font-mono">{String((artifact as any).type ?? "—")}</span>
          </span>
          <span className="opacity-40">•</span>
          <span className="text-xs">
            Updated: {fmtWhen(String((artifact as any).updated_at ?? (artifact as any).created_at ?? null))}
          </span>
          {(artifact as any).locked_at ? (
            <>
              <span className="opacity-40">•</span>
              <span className="text-xs">Submitted: {fmtWhen(String((artifact as any).locked_at))}</span>
            </>
          ) : null}
          {(artifact as any).approved_at ? (
            <>
              <span className="opacity-40">•</span>
              <span className="text-xs">Approved: {fmtWhen(String((artifact as any).approved_at))}</span>
            </>
          ) : null}
          {(artifact as any).rejected_at ? (
            <>
              <span className="opacity-40">•</span>
              <span className="text-xs">Decision: {fmtWhen(String((artifact as any).rejected_at))}</span>
            </>
          ) : null}
        </div>
      </header>

      {/* Actions */}
      <section className="border rounded-2xl bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            {isEditable
              ? "Editable: owners/editors can update and submit/resubmit."
              : status === "submitted"
              ? isAuthor
                ? "Submitted: waiting for another approver (you cannot approve your own artifact)."
                : isApprover
                ? "Submitted: you can approve, request changes (CR) or reject final."
                : "Submitted: waiting for approval."
              : status === "changes_requested"
              ? "Changes requested (CR): owners/editors update, then resubmit."
              : status === "approved"
              ? "Approved + baselined."
              : status === "rejected"
              ? "Rejected (final)."
              : "View-only."}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canSubmitOrResubmit ? (
              <form action={submitAction}>
                <button className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm" type="submit">
                  {status === "changes_requested" ? "Resubmit for approval" : "Submit for approval"}
                </button>
              </form>
            ) : null}

            {/* ✅ Create revision (Option B) */}
            {canCreateRevision ? (
              <form action={createRevisionAction}>
                <button
                  className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
                  type="submit"
                  title="Creates a new draft revision from this approved/rejected current artifact"
                >
                  Create revision
                </button>
              </form>
            ) : null}

            {canExport ? (
              <>
                <a
                  href={`/projects/${projectId}/artifacts/${artifactId}/export/pptx`}
                  className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
                  title="Download PowerPoint"
                >
                  Export PPT
                </a>
                <a
                  href={`/projects/${projectId}/artifacts/${artifactId}/export/pdf`}
                  className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
                  title="Download PDF"
                >
                  Export PDF
                </a>
                <a
                  href={`/projects/${projectId}/artifacts/${artifactId}/export/docx`}
                  className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
                  title="Download Word"
                >
                  Export Word
                </a>
              </>
            ) : null}
          </div>
        </div>

        {canDecide ? (
          <div className="grid gap-3 md:grid-cols-3">
            <form action={approveAction} className="border rounded-2xl p-4 space-y-2">
              <div className="font-medium">Approve</div>
              <div className="text-xs text-gray-500">Approves the current step. Final step promotes baseline.</div>
              <button className="px-4 py-2 rounded-xl bg-black text-white text-sm" type="submit">
                Approve
              </button>
            </form>

            <form action={requestChangesAction} className="border rounded-2xl p-4 space-y-2">
              <div className="font-medium">Request Changes (CR)</div>
              <textarea
                name="reason"
                rows={3}
                placeholder="Reason / what to change…"
                className="w-full border rounded-xl px-3 py-2 text-sm"
                required
              />
              <button
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm hover:bg-gray-50"
                type="submit"
              >
                Request changes
              </button>
            </form>

            <form action={rejectFinalAction} className="border rounded-2xl p-4 space-y-2">
              <div className="font-medium">Reject (Final)</div>
              <textarea
                name="reason"
                rows={2}
                placeholder="Reason (recommended)…"
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
              <input
                name="confirm"
                placeholder='Type "REJECT" to confirm'
                className="w-full border rounded-xl px-3 py-2 text-sm"
                required
              />
              <button
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm hover:bg-gray-50"
                type="submit"
              >
                Reject final
              </button>
            </form>
          </div>
        ) : null}
      </section>

      {/* Content */}
      <section className="border rounded-2xl bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">Content</div>
          {!isEditable ? <div className="text-xs text-gray-500">Read-only</div> : null}
        </div>

        {charterMode ? (
          <ProjectCharterEditorForm
            projectId={projectId}
            artifactId={artifactId}
            initialJson={charterInitial}
            readOnly={!isEditable}
            lockLayout={lockLayout}
          />
        ) : isEditable ? (
          <form action={updateArtifact} className="grid gap-4">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="artifact_id" value={artifactId} />

            <label className="grid gap-2">
              <span className="text-sm font-medium">Title</span>
              <input
                name="title"
                defaultValue={String((artifact as any).title ?? "")}
                className="border rounded-xl px-3 py-2"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Content</span>
              <textarea
                name="content"
                rows={14}
                defaultValue={String((artifact as any).content ?? "")}
                className="border rounded-xl px-3 py-2 font-mono text-sm"
              />
            </label>

            <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">
              Save changes
            </button>
          </form>
        ) : (
          <div className="grid gap-2">
            {String((artifact as any).content ?? "").trim().length === 0 ? (
              <div className="text-sm text-gray-600">No content yet.</div>
            ) : null}

            <textarea
              rows={14}
              readOnly
              value={String((artifact as any).content ?? "")}
              className="border rounded-xl px-3 py-2 font-mono text-sm bg-gray-50 whitespace-pre-wrap"
            />
          </div>
        )}
      </section>

      {/* Comments */}
      <section className="border rounded-2xl bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">Comments</div>
          <div className="text-xs text-gray-500">{isApprover ? `Approvers can comment.` : "Read-only."}</div>
        </div>

        {isApprover ? (
          <form action={addArtifactComment} className="grid gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="artifact_id" value={artifactId} />
            <input type="hidden" name="action" value="comment" />
            <textarea
              name="body"
              rows={3}
              className="border rounded-xl px-3 py-2 text-sm"
              placeholder="Write a comment…"
              required
            />
            <button className="w-fit px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm" type="submit">
              Add comment
            </button>
          </form>
        ) : null}

        {(comments ?? []).length === 0 ? (
          <div className="text-sm text-gray-600">No comments yet.</div>
        ) : (
          <div className="divide-y border rounded-2xl overflow-hidden">
            {(comments ?? []).map((c: any) => {
              const who = displayUser(String(c.actor_user_id ?? ""));
              return (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-gray-100 border flex items-center justify-center text-xs font-medium text-gray-700">
                        {who.initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{who.title}</div>
                        <div className="text-xs text-gray-500">
                          {String(c.action ?? "comment")} • {fmtWhen(String(c.created_at ?? null))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{String(c.body ?? "")}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
