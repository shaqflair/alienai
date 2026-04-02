// src/app/projects/[id]/change/[crId]/page.tsx
import "server-only";
import { redirect, notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function looksLikePublicId(x: string) {
  const t = String(x || "").trim();
  return /^cr-\d+$/i.test(t) || /^cr\d+$/i.test(t);
}

function normalizePublicId(x: string) {
  const t = String(x || "").trim();
  const m = t.match(/cr[-_\s]*(\d+)/i);
  return m?.[1] ? `cr-${m[1]}` : t.toLowerCase();
}

function buildQueryString(sp: any) {
  const qs = new URLSearchParams();
  if (!sp) return qs;

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

  return qs;
}

async function resolveProjectUuid(param: string): Promise<string | null> {
  if (looksLikeUuid(param)) return param;

  const value = safeStr(param).trim();
  if (!value) return null;

  try {
    const supabase = createServiceClient();

    const direct = await supabase
      .from("projects")
      .select("id")
      .eq("project_code", value.toUpperCase())
      .maybeSingle();

    if (direct.data?.id) return String(direct.data.id);

    const digits = value.match(/(\d+)/)?.[1];
    if (digits) {
      const variants = [digits, `P-${digits}`, `PRJ-${digits}`];
      for (const v of variants) {
        const hit = await supabase
          .from("projects")
          .select("id")
          .eq("project_code", v)
          .maybeSingle();

        if (hit.data?.id) return String(hit.data.id);
      }
    }
  } catch {
    return null;
  }

  return null;
}

type ParamsShape = { id?: string; crId?: string };

export default async function ChangeCrIdRedirectPage({
  params,
  searchParams,
}: {
  params: ParamsShape | Promise<ParamsShape>;
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}) {
  const p =
    typeof (params as any)?.then === "function"
      ? await (params as any)
      : params;

  const sp =
    typeof (searchParams as any)?.then === "function"
      ? await (searchParams as any)
      : (searchParams ?? {});

  const projectParam = safeStr(p?.id).trim();
  const crParam = safeStr(p?.crId).trim();

  if (!projectParam) notFound();
  if (!crParam) redirect(`/projects/${projectParam}/change`);

  const projectUuid = await resolveProjectUuid(projectParam);
  const resolvedProject = projectUuid ?? projectParam;

  const qs = buildQueryString(sp);

  if (looksLikeUuid(crParam)) {
    qs.set("cr", crParam);
  } else if (looksLikePublicId(crParam)) {
    qs.set("publicId", normalizePublicId(crParam));
  } else {
    qs.set("publicId", crParam);
  }

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  redirect(`/projects/${resolvedProject}/change${suffix}`);
}