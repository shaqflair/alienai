// src/app/projects/[id]/change/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (s) out.add(s);
  const up = s.toUpperCase();
  if (up) out.add(up);

  const digits = extractDigits(s);
  if (digits) {
    out.add(digits);
    out.add(`P-${digits}`);
    out.add(`P-${digits.padStart(5, "0")}`);
  }

  const m = up.match(/^P-(\d{1,10})$/);
  if (m?.[1]) {
    out.add(m[1]);
    out.add(String(Number(m[1])));
  }

  return Array.from(out).filter(Boolean);
}

/* -------------------------------------------
   project resolve (UUID or code)
------------------------------------------- */

const PROJECT_SELECT =
  "id, code, public_id, external_id, project_code, project_number, project_no";

async function resolveProject(sb: any, rawParam: string) {
  const raw = safeStr(rawParam).trim();
  if (!raw) return { project: null as any, error: new Error("Missing project id") };

  // 1) UUID path
  if (looksLikeUuid(raw)) {
    const { data, error } = await sb
      .from("projects")
      .select(PROJECT_SELECT)
      .eq("id", raw)
      .maybeSingle();

    if (error) return { project: null as any, error };
    if (data) return { project: data, error: null };

    // If UUID but not found, treat as not found
    return { project: null as any, error: new Error("Project not found") };
  }

  // 2) Human code variants path
  const variants = projectCodeVariants(raw);
  for (const v of variants) {
    const { data, error } = await sb
      .from("projects")
      .select(PROJECT_SELECT)
      .eq("project_code", v)
      .maybeSingle();
    if (error) return { project: null as any, error };
    if (data) return { project: data, error: null };
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
  // Next.js can pass params as a Promise in some setups — handle both safely
  params: { id?: string } | Promise<{ id?: string }>;
  searchParams?: { [k: string]: string | string[] | undefined } | Promise<{ [k: string]: any }>;
}) {
  const p = typeof (params as any)?.then === "function" ? await (params as any) : (params as any);
  const sp =
    typeof (searchParams as any)?.then === "function" ? await (searchParams as any) : (searchParams as any);

  const paramId = safeStr(p?.id).trim();
  if (!paramId) notFound();

  // If some old UI is still linking to /change?view=changes, normalise it
  const view = safeStr(sp?.view);
  if (view && view.toLowerCase() === "changes") {
    redirect(`/projects/${paramId}/change`);
  }

  const supabase = await createClient();

  // ✅ auth guard (keeps behaviour consistent with your other server pages)
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) redirect("/login");

  // ✅ Resolve project UUID even if the route param is a code
  const resolved = await resolveProject(supabase, paramId);
  if (resolved.error || !resolved.project?.id) {
    notFound();
  }

  const projectUuid = safeStr(resolved.project.id);
  if (!looksLikeUuid(projectUuid)) notFound();

  /* -------------------------------------------
     project "human id" (for UI chip only)
  ------------------------------------------- */

  let projectCode: string | null = null;

  {
    const proj = resolved.project;
    const candidates = [
      toText((proj as any).project_number),
      toText((proj as any).project_no),
      toText((proj as any).external_id),
      toText((proj as any).public_id),
      toText((proj as any).code),
      toText((proj as any).project_code),
    ]
      .map((s) => s.trim())
      .filter(Boolean);

    projectCode = candidates.length ? candidates[0] : null;
  }

  /* -------------------------------------------
     locate Change Requests artifact for compare
  ------------------------------------------- */

  let compareHref: string | null = null;

  try {
    const { data: crArtifact, error } = await supabase
      .from("artifacts")
      .select("id, type, updated_at")
      .eq("project_id", projectUuid)
      .in("type", [
        "change_requests",
        "change requests",
        "change_request",
        "change request",
        "change_log",
        "change log",
        "kanban",
        "change",
      ])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && crArtifact?.id) {
      compareHref = `/projects/${projectUuid}/artifacts/${crArtifact.id}/compare`;
    }
  } catch {
    // optional feature – safe to ignore
  }

  /* -------------------------------------------
     render
  ------------------------------------------- */

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
            {projectCode ? (
              <span
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm"
                title="Project ID"
                style={{ fontWeight: 800 }}
              >
                {`PRJ-${projectCode}`}
              </span>
            ) : null}

            {compareHref ? (
              <Link
                href={compareHref}
                className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
                title="Compare versions of the Change Requests artifact"
              >
                Compare versions
              </Link>
            ) : null}
          </div>
        }
      />

      {/* ✅ ALWAYS Kanban. ✅ No props passed (board reads params internally). */}
      <ChangeManagementBoard />
    </main>
  );
}