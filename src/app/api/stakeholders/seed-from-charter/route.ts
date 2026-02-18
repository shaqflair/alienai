// src/app/api/stakeholders/seed-from-charter/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function normNameKey(x: unknown) {
  return safeStr(x).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

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
  return auth.user;
}

type CharterStakeRow = {
  stakeholder?: string;
  role_interest?: string;
  influence?: string;
  engagement_notes?: string;
};

function extractCharterStakeholders(charterJson: any): CharterStakeRow[] {
  const sections = Array.isArray(charterJson?.sections) ? charterJson.sections : [];
  const s =
    sections.find((x: any) => String(x?.key ?? "").toLowerCase() === "stakeholders") ||
    sections.find((x: any) => String(x?.title ?? "").toLowerCase().includes("stakeholder"));

  if (!s) return [];

  const table = s?.table;
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const dataRows = rows.filter((r: any) => String(r?.type) === "data" && Array.isArray(r?.cells));

  return dataRows
    .map((r: any) => {
      const cells = (r.cells ?? []).map((c: any) => String(c ?? "").trim());
      return {
        stakeholder: cells[0] || "",
        role_interest: cells[1] || "",
        influence: cells[2] || "",
        engagement_notes: cells[3] || "",
      };
    })
    .filter((r: CharterStakeRow) => !!safeStr(r.stakeholder).trim());
}

function normalizeInfluenceToDb(x: unknown): "high" | "medium" | "low" | null {
  const s = safeStr(x).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("h")) return "high";
  if (s.startsWith("l")) return "low";
  return "medium";
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    const artifactId = safeStr(body?.artifactId).trim(); // ? this is the Stakeholder Register artifact id

    if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    if (!artifactId) return NextResponse.json({ ok: false, error: "Missing artifactId" }, { status: 400 });

    await requireAuthAndMembership(supabase, projectId);

    // ? 1) Find the *latest* Project Charter artifact for this project
    // We select a small set and pick the newest charter by created_at (or fallback to first match).
    const { data: arts, error: artsErr } = await supabase
      .from("artifacts")
      .select("id, project_id, created_at, content_json")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (artsErr) throw new Error(artsErr.message);

    const charter = (arts ?? []).find((a: any) => {
      const cj = a?.content_json;
      return cj && typeof cj === "object" && String(cj?.type ?? "") === "project_charter";
    });

    if (!charter) {
      return NextResponse.json(
        { ok: true, inserted: 0, reason: "No project_charter artifact found for this project" },
        { status: 200 }
      );
    }

    const charterJson = (charter as any).content_json ?? {};
    const extracted = extractCharterStakeholders(charterJson);

    if (!extracted.length) {
      return NextResponse.json({ ok: true, inserted: 0, reason: "No stakeholders found in charter section" });
    }

    // ? 2) Existing stakeholders for THIS register artifact scope
    const { data: existing, error: exErr } = await supabase
      .from("stakeholders")
      .select("name_key")
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId);

    if (exErr) throw new Error(exErr.message);

    const existingKeys = new Set((existing ?? []).map((x: any) => normNameKey(x?.name_key)));

    // ? 3) Build inserts (skip blanks + skip duplicates)
    const inserts = extracted
      .map((r) => {
        const name = safeStr(r.stakeholder).trim();
        const name_key = normNameKey(name);
        if (!name || !name_key) return null;
        if (existingKeys.has(name_key)) return null;

        return {
          project_id: projectId,
          artifact_id: artifactId, // ? register artifact scope
          name,
          name_key, // ? NOT NULL
          role: safeStr(r.role_interest).trim() || null,
          influence_level: normalizeInfluenceToDb(r.influence),
          expectations: null,
          communication_strategy: null,
          contact_info: {
            source: "charter",
            point_of_contact: "",
            internal_external: "Internal",
            title_role: "",
            stakeholder_mapping: null,
            involvement_milestone: "",
            stakeholder_impact: safeStr(r.engagement_notes).trim() || "",
            channels: ["Teams"],
            group: "Governance",
          },
        };
      })
      .filter(Boolean) as any[];

    if (!inserts.length) {
      return NextResponse.json({ ok: true, inserted: 0, reason: "No missing stakeholders to merge" });
    }

    // ? 4) Prefer upsert if you have (project_id, artifact_id, name_key) unique constraint
    const { error: upErr } = await supabase
      .from("stakeholders")
      .upsert(inserts, { onConflict: "project_id,artifact_id,name_key" });

    if (upErr) {
      // Fallback to plain insert (still safe because we filtered against existingKeys)
      const { error: insErr } = await supabase.from("stakeholders").insert(inserts);
      if (insErr) {
        return NextResponse.json(
          { ok: false, stage: "insertStakeholders", error: insErr.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      inserted: inserts.length,
      charterArtifactId: (charter as any).id,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, stage: "seed-from-charter", error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
