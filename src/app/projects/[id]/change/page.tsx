// src/app/projects/[id]/change/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* -------------------------------------------
   small helpers
------------------------------------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function toText(v: any) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "bigint") return String(v);
  try {
    return String(v);
  } catch {
    return "";
  }
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function extractDigits(raw: string): string | null {
  const s = safeStr(raw).toUpperCase();
  const m = s.match(/(\d{1,10})/);
  if (!m?.[1]) return null;
  const digits = m[1];
  const norm = String(Number(digits));
  return norm && norm !== "NaN" ? norm : digits.replace(/^0+/, "") || "0";
}

function projectCodeVariants(raw: string): string[] {
  const out = new Set<string>();
  const s = safeStr(raw).trim();
  if (!s) return [];

  const up = s.toUpperCase();
  out.add(s);
  out.add(up);

  const digits = extractDigits(s);

  if (digits) {
    const padded = digits.padStart(5, "0");

    out.add(digits);

    out.add(`P-${digits}`);
    out.add(`P${digits}`);
    out.add(`P-${padded}`);
    out.add(`P${padded}`);

    out.add(`PRJ-${digits}`);
    out.add(`PRJ${digits}`);
    out.add(`PRJ-${padded}`);
    out.add(`PRJ${padded}`);

    out.add(`PROJECT-${digits}`);
    out.add(`PROJECT${digits}`);
  }

  const pDash = up.match(/^P-(\d{1,10})$/);
  if (pDash?.[1]) {
    const n = String(Number(pDash[1]));
    out.add(pDash[1]);
    out.add(n);
    out.add(`PRJ-${n}`);
    out.add(`PRJ${n}`);
  }

  const pPlain = up.match(/^P(\d{1,10})$/);
  if (pPlain?.[1]) {
    const n = String(Number(pPlain[1]));
    out.add(pPlain[1]);
    out.add(n);
    out.add(`P-${n}`);
    out.add(`PRJ-${n}`);
    out.add(`PRJ${n}`);
  }

  const prjDash = up.match(/^PRJ-(\d{1,10})$/);
  if (prjDash?.[1]) {
    const n = String(Number(prjDash[1]));
    out.add(prjDash[1]);
    out.add(n);
    out.add(`P-${n}`);
    out.add(`P${n}`);
    out.add(`PRJ${n}`);
  }

  const prjPlain = up.match(/^PRJ(\d{1,10})$/);
  if (prjPlain?.[1]) {
    const n = String(Number(prjPlain[1]));
    out.add(prjPlain[1]);
    out.add(n);
    out.add(`P-${n}`);
    out.add(`P${n}`);
    out.add(`PRJ-${n}`);
  }

  return Array.from(out).filter(Boolean);
}

function buildQueryString(sp: any) {
  const qs = new URLSearchParams();
  if (!sp) return qs.toString();

  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        const s = safeStr(item).trim();
        if (s) qs.append(k, s);
      }
    } else {
      const s = safeStr(v).trim();
      if (s) qs.set(k, s);
    }
  }
  return qs.toString();
}

/* -------------------------------------------
   project resolve (UUID or code)
------------------------------------------- */

const PROJECT_SELECT_MIN = "id, title, project_code";

const PROJECT_SELECT_MAX =
  "id, title, project_code";

async function selectProjectBy(sb: any, col: "id" | "project_code", value: string) {
  {
    const { data, error } = await sb
      .from("projects")
      .select(PROJECT_SELECT_MAX)
      .eq(col, value)
      .maybeSingle();

    if (!error) return { project: data ?? null, error: null as any };

    const msg = safeStr((error as any)?.message).toLowerCase();
    const looksLikeMissingColumn = msg.includes("column") && msg.includes("does not exist");
    if (!looksLikeMissingColumn) return { project: null as any, error };
  }

  const { data, error } = await sb
    .from("projects")
    .select(PROJECT_SELECT_MIN)
    .eq(col, value)
    .maybeSingle();

  if (error) return { project: null as any, error };
  return { project: data ?? null, error: null as any };
}

async function resolveProject(sb: any, rawParam: string) {
  const raw = safeStr(rawParam).trim();
  if (!raw) return { project: null as any, error: new Error("Missing project id") };

  if (looksLikeUuid(raw)) {
    const r = await selectProjectBy(sb, "id", raw);
    if (r.error) return { project: null as any, error: r.error };
    if (r.project) return { project: r.project, error: null as any };
    return { project: null as any, error: new Error("Project not found") };
  }

  const variants = projectCodeVariants(raw);
  for (const v of variants) {
    const r = await selectProjectBy(sb, "project_code", v);
    if (r.error) return { project: null as any, error: r.error };
    if (r.project) return { project: r.project, error: null as any };
  }

  return { project: null as any, error: new Error("Project not found") };
}

/* -------------------------------------------
   page
------------------------------------------- */

export default async function ChangeLogPage({
  params,
  searchParams,
}: {
  params: { id?: string } | Promise<{ id?: string }>;
  searchParams?: { [k: string]: string | string[] | undefined } | Promise<{ [k: string]: any }>;
}) {
  const p = typeof (params as any)?.then === "function" ? await (params as any) : (params as any);
  const sp =
    typeof (searchParams as any)?.then === "function" ? await (searchParams as any) : (searchParams as any);

  const paramId = safeStr(p?.id).trim();
  if (!paramId) notFound();

  const view = safeStr(sp?.view);
  if (view && view.toLowerCase() === "changes") {
    redirect(`/projects/${paramId}/change`);
  }

  let supabase: any;
  try {
    supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) redirect("/login");
  } catch {
    redirect("/login");
  }

  const resolved = await resolveProject(supabase, paramId);
  if (resolved.error || !resolved.project?.id) {
    notFound();
  }

  const projectUuid = safeStr(resolved.project.id).trim();
  if (!looksLikeUuid(projectUuid)) notFound();

  if (paramId !== projectUuid) {
    const q = buildQueryString(sp);
    redirect(q ? `/projects/${projectUuid}/change?${q}` : `/projects/${projectUuid}/change`);
  }

  let projectCode: string | null = null;
  {
    const proj = resolved.project;
    const candidates = [
      toText((proj as any).project_code),
      toText((proj as any).public_id),
      toText((proj as any).external_id),
      toText((proj as any).code),
      toText((proj as any).project_number),
      toText((proj as any).project_no),
    ]
      .map((s) => s.trim())
      .filter(Boolean);

    projectCode = candidates.length ? candidates[0] : null;
  }

  let compareHref: string | null = null;

  try {
    const { data: crArtifact, error } = await supabase
      .from("artifacts")
      .select("id, type, artifact_type, updated_at")
      .eq("project_id", projectUuid)
      .in("type", [
        "change_requests",
        "change requests",
        "change_request",
        "change request",
        "change_log",
        "change log",
        "kanban",
      ])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && crArtifact?.id) {
      compareHref = `/projects/${projectUuid}/artifacts/${crArtifact.id}/compare`;
    }
  } catch {
    // optional
  }

  const projectBadge = projectCode
    ? /^PRJ-/i.test(projectCode) || /^P-/i.test(projectCode)
      ? projectCode
      : `PRJ-${projectCode}`
    : null;

  return (
    <main className="crPage">
      <ChangeHeader
        title="Change Control"
        subtitle="Fast scanning for busy PMs"
        rightSlot={
          <div
            style={{
              display: "inline-flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {projectBadge ? (
              <span
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm"
                title="Project ID"
                style={{ fontWeight: 800 }}
              >
                {projectBadge}
              </span>
            ) : null}


          </div>
        }
      />

      <ChangeManagementBoard projectId={projectUuid} />
    </main>
  );
}