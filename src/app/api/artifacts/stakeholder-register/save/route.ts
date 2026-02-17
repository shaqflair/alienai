import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* ---------------- utilities ---------------- */

function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}
function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

/* ---------------- schemas ---------------- */

const RowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  point_of_contact: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  internal_external: z.string().optional().nullable(),
  title_role: z.string().optional().nullable(),
  impact_level: z.string().optional().nullable(),
  influence_level: z.string().optional().nullable(),
  stakeholder_mapping: z.string().optional().nullable(),
  involvement_milestone: z.string().optional().nullable(),
  stakeholder_impact: z.string().optional().nullable(),
  channels: z.array(z.string()).optional().default([]),
  group: z.string().optional().nullable(),
});

const GroupSchema = z.object({
  name: z.string().min(1),
  rows: z.array(RowSchema).default([]),
});

const DocSchema = z.object({
  type: z.literal("stakeholder_register"),
  version: z.literal(1),
  groups: z.array(GroupSchema).default([]),
});

const PayloadSchema = z.object({
  artifactId: z.string().min(1),
  projectId: z.string().optional().nullable(),
  doc: z.any(),
});

/* ---------------- processing helpers ---------------- */

function normalizeDoc(input: any) {
  // Gracefully handle older flat arrays or current grouped objects
  const obj = input && typeof input === "object" ? input : {};
  const type = "stakeholder_register";
  const version = 1;

  // Case A: Already structured as groups
  if (Array.isArray(obj.groups)) {
    return { type, version, groups: obj.groups };
  }

  // Case B: Legacy flat rows - convert to grouped
  if (Array.isArray(obj.rows)) {
    const byGroup = new Map<string, any[]>();
    for (const r of obj.rows) {
      const g = safeStr(r?.group) || "Project";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(r);
    }
    const groups = Array.from(byGroup.entries()).map(([name, rows]) => ({ name, rows }));
    return { type, version, groups };
  }

  // Fallback
  return { type, version, groups: [] };
}

async function requireAuthenticated(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

/* ---------------- api route ---------------- */

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    await requireAuthenticated(supabase);

    const body = await req.json();
    const parsed = PayloadSchema.safeParse(body);
    
    if (!parsed.success) {
      return jsonErr("Invalid payload", 400, parsed.error.flatten());
    }

    const artifactId = safeStr(parsed.data.artifactId);
    const projectIdParam = safeStr(parsed.data.projectId);

    if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400);
    if (projectIdParam && !isUuid(projectIdParam)) return jsonErr("Invalid projectId", 400);

    // 1. Verification and Access Check
    const { data: art, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, is_locked")
      .eq("id", artifactId)
      .maybeSingle();

    if (artErr) return jsonErr(artErr.message, 500);
    if (!art) return jsonErr("Artifact not found", 404);
    if (art.is_locked) return jsonErr("Artifact is locked and cannot be edited", 423);

    const projectId = projectIdParam || safeStr(art.project_id);
    if (!projectId || !isUuid(projectId)) return jsonErr("Unable to resolve projectId", 400);

    // 2. Data Sanitization
    const normalized = normalizeDoc(parsed.data.doc);
    const doc = DocSchema.parse(normalized);

    // 3. Persist to Database
    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabase
      .from("artifacts")
      .update({
        content_json: doc,
        last_saved_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", artifactId);

    if (upErr) return jsonErr(upErr.message, 500);

    return jsonOk({ 
      artifactId, 
      projectId, 
      savedAt: nowIso, 
      rowCount: doc.groups.reduce((n, g) => n + g.rows.length, 0) 
    });
    
  } catch (e: any) {
    return jsonErr("Save failed", 500, { message: String(e?.message ?? e) });
  }
}

