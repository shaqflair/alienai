// src/app/projects/[id]/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
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

function bestProjectRole(rows: Array<{ role?: string | null }> | null | undefined) {
  const roles = (rows ?? [])
    .map((r) => String(r?.role ?? "").toLowerCase())
    .filter(Boolean);

  if (!roles.length) return "";
  if (roles.includes("owner")) return "owner";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return roles[0] || "";
}

const PROJECT_SELECT = "id,title,project_code";

async function resolveProject(sb: any, rawParam: string) {
  const raw = safeStr(rawParam).trim();
  if (!raw) return { project: null as any, error: new Error("Missing project id") };

  if (looksLikeUuid(raw)) {
    const { data, error } = await sb.from("projects").select(PROJECT_SELECT).eq("id", raw).maybeSingle();
    if (error) return { project: null as any, error };
    if (data) return { project: data, error: null };
    return { project: null as any, error: new Error("Project not found") };
  }

  const variants = projectCodeVariants(raw);
  for (const v of variants) {
    const { data, error } = await sb.from("projects").select(PROJECT_SELECT).eq("project_code", v).maybeSingle();
    if (error) return { project: null as any, error };
    if (data) return { project: data, error: null };
  }

  return { project: null as any, error: new Error("Project not found") };
}

export default async function ProjectPage({
  params,
}: {
  // ✅ Next.js 16: params can be a Promise in some routes
  params: Promise<{ id?: string }> | { id?: string };
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const p = await Promise.resolve(params as any);
  const projectParam = safeStr(p?.id).trim();
  if (!projectParam) notFound();

  // ✅ Resolve UUID OR code
  const resolved = await resolveProject(supabase, projectParam);
  const project = resolved.project;
  if (resolved.error || !project?.id || !looksLikeUuid(project.id)) notFound();

  const projectUuid = String(project.id);

  // ✅ Duplicate-safe gating: fetch rows (no maybeSingle)
  const { data: memRows, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id);

  if (memErr) throw memErr;

  const myRole = bestProjectRole(memRows as any);
  if (!myRole) notFound(); // not a member

  // ✅ Links should always use UUID
  const hrefProject = `/projects/${projectUuid}`;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href="/projects">
          ← Back to Projects
        </Link>
        <div>
          Role: <span className="font-mono">{myRole}</span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{project?.title ?? "Project"}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <Link className="underline font-medium" href={hrefProject}>
            Overview
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`${hrefProject}/artifacts`}>
            Artifacts
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`${hrefProject}/approvals`}>
            Approvals
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`${hrefProject}/members`}>
            Members
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`${hrefProject}/change`}>
            Change Control
          </Link>
        </div>
        <p className="text-sm text-gray-600">
          Project home is back. Next we’ll wire up artifacts navigation end-to-end.
        </p>
      </header>

      <section className="border rounded-2xl bg-white p-5 space-y-2">
        <div className="font-medium">Quick links</div>
        <div className="text-sm text-gray-600">
          Go to{" "}
          <Link className="underline" href={`${hrefProject}/artifacts`}>
            Artifacts
          </Link>{" "}
          to create and manage documentation.
        </div>
      </section>
    </main>
  );
}