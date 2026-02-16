// src/app/api/stakeholders/seed/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Not found");

  const role = String((mem as any).role ?? "viewer").toLowerCase();
  const canEdit = role === "owner" || role === "editor";
  return { userId: auth.user.id, role, canEdit };
}

function safeString(x: any) {
  return String(x ?? "").trim();
}

function toNameKey(name: string) {
  return String(name ?? "").trim().toLowerCase();
}

function normalizeInfluence(x: any): "high" | "medium" | "low" {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "high") return "high";
  if (s === "low") return "low";
  return "medium";
}

function isCharterType(type: any) {
  const t = String(type ?? "").toLowerCase();
  return t === "project_charter" || t === "project charter" || t === "charter" || t === "projectcharter" || t === "pid";
}

function indexOfHeader(headerCells: string[], needle: string) {
  const n = needle.trim().toLowerCase();
  return headerCells.findIndex((h) => String(h ?? "").trim().toLowerCase() === n);
}

function bestCell(cells: any[], i: number) {
  if (!Array.isArray(cells)) return "";
  if (i < 0 || i >= cells.length) return "";
  return String(cells[i] ?? "").trim();
}

/**
 * ONLY: get Charter section key="stakeholders"
 */
function getStakeholdersSectionTable(charterJson: any) {
  const sections = Array.isArray(charterJson?.sections) ? charterJson.sections : [];
  const sec = sections.find((s: any) => String(s?.key ?? "").toLowerCase() === "stakeholders");
  const tableRows = Array.isArray(sec?.table?.rows) ? sec.table.rows : [];

  const header = tableRows.find((r: any) => r?.type === "header") ?? null;
  const dataRows = tableRows.filter((r: any) => r?.type !== "header");

  const headerCells: string[] = Array.isArray(header?.cells)
    ? header.cells.map((c: any) => String(c ?? "").trim())
    : [];

  return { headerCells, dataRows };
}

/**
 * ✅ Map Charter Stakeholders table → public.stakeholders
 */
function mapStakeholdersOnly(projectId: string, charterJson: any) {
  const { headerCells, dataRows } = getStakeholdersSectionTable(charterJson);
  const nowIso = new Date().toISOString();

  // resolve columns
  const iName = indexOfHeader(headerCells, "Stakeholder") >= 0 ? indexOfHeader(headerCells, "Stakeholder") : 0;

  const iRole =
    indexOfHeader(headerCells, "Role/Interest") >= 0
      ? indexOfHeader(headerCells, "Role/Interest")
      : indexOfHeader(headerCells, "Role") >= 0
      ? indexOfHeader(headerCells, "Role")
      : 1;

  const iInfluence = indexOfHeader(headerCells, "Influence") >= 0 ? indexOfHeader(headerCells, "Influence") : 2;

  const iNotes =
    indexOfHeader(headerCells, "Engagement / Notes") >= 0
      ? indexOfHeader(headerCells, "Engagement / Notes")
      : indexOfHeader(headerCells, "Engagement") >= 0
      ? indexOfHeader(headerCells, "Engagement")
      : 3;

  const payload = dataRows
    .map((r: any) => {
      const cells = Array.isArray(r?.cells) ? r.cells : [];

      const name = bestCell(cells, iName);
      if (!name) return null;

      const name_key = toNameKey(name);
      if (!name_key) return null;

      const role = bestCell(cells, iRole) || null;
      const influence_level = normalizeInfluence(bestCell(cells, iInfluence));
      const notes = bestCell(cells, iNotes) || null;

      return {
        project_id: projectId,
        name,
        name_key,
        role,
        influence_level,
        expectations: role ? role : null,
        communication_strategy: notes,
        contact_info: { source: "charter_stakeholders" },
        updated_at: nowIso,
      };
    })
    .filter(Boolean) as any[];

  // de-dupe by name_key
  const byKey = new Map<string, any>();
  for (const it of payload) byKey.set(String(it.name_key), it);
  return Array.from(byKey.values());
}

async function getCurrentCharterArtifact(supabase: any, projectId: string) {
  const { data, error } = await supabase
    .from("artifacts")
    .select("id, type, title, content_json, created_at, is_current")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);

  const list = Array.isArray(data) ? data : [];
  const current = list.find((a: any) => !!a?.is_current && isCharterType(a?.type));
  if (current) return current;

  const anyCharter = list.find((a: any) => isCharterType(a?.type));
  return anyCharter ?? null;
}

async function markSuggestionAcceptedBestEffort(supabase: any, suggestionId: string, userId: string) {
  if (!suggestionId) return;
  const nowIso = new Date().toISOString();

  try {
    const { error } = await supabase
      .from("ai_suggestions")
      .update({ status: "accepted", decided_at: nowIso, decided_by: userId })
      .eq("id", suggestionId);
    if (!error) return;
  } catch {}

  try {
    const { error } = await supabase
      .from("suggestions")
      .update({ status: "accepted", decided_at: nowIso, decided_by: userId })
      .eq("id", suggestionId);
    if (!error) return;
  } catch {}
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json().catch(() => null);

    const projectId = safeString(body?.projectId);
    const suggestionId = safeString(body?.suggestionId);

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    }

    const { userId, canEdit } = await requireAuthAndMembership(supabase, projectId);
    if (!canEdit) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const charter = await getCurrentCharterArtifact(supabase, projectId);
    if (!charter) {
      return NextResponse.json(
        { ok: false, error: "No Project Charter found for this project (needed to seed stakeholders)." },
        { status: 404 }
      );
    }

    const charterJson = (charter as any).content_json ?? null;
    if (!charterJson || typeof charterJson !== "object") {
      return NextResponse.json({ ok: false, error: "Project Charter has no content_json to seed from." }, { status: 400 });
    }

    const payload = mapStakeholdersOnly(projectId, charterJson);

    // ✅ HARD REPLACE: remove all existing stakeholders for project
    const { error: delErr } = await supabase.from("stakeholders").delete().eq("project_id", projectId);
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });

    if (payload.length) {
      const { error: insErr } = await supabase.from("stakeholders").insert(payload);
      if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }

    if (suggestionId) await markSuggestionAcceptedBestEffort(supabase, suggestionId, userId);

    return NextResponse.json({
      ok: true,
      seeded: payload.length,
      charter_artifact_id: String((charter as any).id),
      charter_title: String((charter as any).title ?? ""),
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "Unauthorized" ? 401 : msg === "Not found" ? 404 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
