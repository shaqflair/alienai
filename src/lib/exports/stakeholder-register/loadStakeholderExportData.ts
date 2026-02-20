// src/lib/exports/stakeholder-register/loadStakeholderExportData.ts
import "server-only";

import { createClient } from "@/utils/supabase/server";
import type { StakeholderRegisterMeta, StakeholderRegisterRow } from "./types";
import { safeJson, safeStr, formatUkDate, formatUkDateTime } from "./stakeholderShared";

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function norm(x: any) {
  return safeStr(x).trim();
}

function joinChannels(x: any) {
  if (Array.isArray(x)) return x.map((v) => norm(v)).filter(Boolean).join(", ");
  return norm(x);
}

/**
 * Canonical stakeholder contact details you’re using in DB:
 * contact_info.point_of_contact (email/phone/whatever the user types)
 * contact_info.channels (array)
 * plus several other fields the exports need.
 */
function contactInfoToString(ci: any) {
  if (!ci) return "";
  if (typeof ci === "string") return norm(ci);
  if (typeof ci !== "object") return norm(ci);

  // ✅ Prefer your canonical field first
  const point = norm(ci?.point_of_contact);

  // Legacy-ish / alternate fields (just in case)
  const email = norm(ci?.email);
  const phone = norm(ci?.phone);
  const org = norm(ci?.organisation || ci?.organization);
  const handle = norm(ci?.handle || ci?.teams || ci?.slack);
  const notes = norm(ci?.notes);

  const parts = [point, email, phone, org, handle, notes].filter(Boolean);
  if (parts.length) return parts.join(" | ");

  try {
    const s = JSON.stringify(ci);
    return s.length > 240 ? s.slice(0, 240) + "…" : s;
  } catch {
    return "";
  }
}

function lower(x: any) {
  return norm(x).toLowerCase();
}

/**
 * Normalises values like "MEDIUM"/"Medium"/"high" -> "medium"/"high"
 * while allowing "low" too. Falls back to provided default.
 */
function normLevel(x: any, dflt: "low" | "medium" | "high" = "medium") {
  const v = lower(x);
  if (v === "low" || v === "medium" || v === "high") return v;
  return dflt;
}

function firstNonEmpty(...vals: any[]) {
  for (const v of vals) {
    const s = norm(v);
    if (s) return s;
  }
  return "";
}

/**
 * Loads Stakeholder Register export data.
 *
 * ✅ Prefers DB table: public.stakeholders (NEW source of truth)
 * ✅ Falls back to artifacts.content_json for legacy documents
 * ✅ NEVER returns meta as undefined
 *
 * IMPORTANT:
 * - DB rows contain key export fields inside contact_info jsonb:
 *   group, channels, title_role, impact_level, point_of_contact,
 *   internal_external, stakeholder_mapping, involvement_milestone, stakeholder_impact
 */
export async function loadStakeholderExportData(args: {
  projectId: string;
  artifactId: string;
  supabase?: any;
}): Promise<{ meta: StakeholderRegisterMeta; rows: StakeholderRegisterRow[] }> {
  const projectId = norm(args?.projectId);
  const artifactId = norm(args?.artifactId);

  if (!isUuid(projectId)) throw new Error("Invalid projectId");
  if (!isUuid(artifactId)) throw new Error("Invalid artifactId");

  const supabase = args?.supabase ?? (await createClient());
  const now = new Date();

  // ✅ Safe meta defaults
  const meta: StakeholderRegisterMeta = {
    projectId,
    artifactId,
    projectName: "Project",
    projectCode: "",
    organisationName: "",
    clientName: "",
    generated: formatUkDateTime(now),
    generatedDate: formatUkDate(now),
    generatedDateTime: formatUkDateTime(now),
  };

  // -------------------------------------------------------------
  // Project + organisation (best effort)
  // -------------------------------------------------------------
  try {
    const { data: proj } = await supabase
      .from("projects")
      .select("id, project_code, title, client_name, organisation_id")
      .eq("id", projectId)
      .maybeSingle();

    if (proj) {
      meta.projectName = norm((proj as any).title) || meta.projectName;
      meta.projectCode = norm((proj as any).project_code) || meta.projectCode;
      meta.clientName = norm((proj as any).client_name) || meta.clientName;

      const orgId = (proj as any).organisation_id;
      if (orgId) {
        const { data: org } = await supabase.from("organisations").select("name").eq("id", orgId).maybeSingle();
        meta.organisationName = norm((org as any)?.name) || meta.organisationName;
      }
    }
  } catch {
    // swallow
  }

  // -------------------------------------------------------------
  // ✅ NEW: DB source of truth (public.stakeholders)
  // -------------------------------------------------------------
  try {
    const { data: dbRows, error } = await supabase
      .from("stakeholders")
      .select(
        "id, project_id, artifact_id, name, role, influence_level, expectations, communication_strategy, contact_info, created_at, updated_at, name_key"
      )
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId)
      .order("name_key", { ascending: true });

    if (!error && Array.isArray(dbRows) && dbRows.length) {
      const rows: StakeholderRegisterRow[] = dbRows.map((r: any) => {
        const name = firstNonEmpty(r?.name, "—");
        const role = firstNonEmpty(r?.role, "—");

        // Influence is top-level
        const influence_level = normLevel(r?.influence_level, "medium");

        const expectations = norm(r?.expectations);
        const communication_strategy = norm(r?.communication_strategy);

        // contact_info is jsonb; Supabase usually returns object already, but we guard anyway.
        const contact_info =
          r?.contact_info && typeof r.contact_info === "object"
            ? r.contact_info
            : safeJson(r?.contact_info) ?? {};

        // Pull the “register columns” from contact_info (source of truth)
        const group = firstNonEmpty((contact_info as any)?.group, "Project");
        const channels = joinChannels((contact_info as any)?.channels);
        const title_role = norm((contact_info as any)?.title_role);
        const impact_level = norm((contact_info as any)?.impact_level);
        const point_of_contact = norm((contact_info as any)?.point_of_contact);
        const internal_external = norm((contact_info as any)?.internal_external);
        const stakeholder_mapping = norm((contact_info as any)?.stakeholder_mapping);
        const involvement_milestone = norm((contact_info as any)?.involvement_milestone);

        // “Impact notes” may be in stakeholder_impact; fall back to expectations if blank.
        const stakeholder_impact = norm((contact_info as any)?.stakeholder_impact);

        const contactStr = contactInfoToString(contact_info);

        /**
         * Return in a shape that BOTH new + legacy renderers can survive.
         *
         * New canonical fields:
         *   name, role, influence_level, expectations, communication_strategy, contact_info
         *
         * Legacy aliases (used by older HTML/DOCX/XLSX renderers):
         *   stakeholder, contact, influence, impact, mapping, milestone, impact_notes, channels, group, etc.
         *
         * ✅ We now populate the legacy aliases from the real DB values,
         *    instead of hard-coded "—" placeholders.
         */
        return {
          // ✅ canonical
          name: norm(name),
          role: norm(role),
          influence_level,
          expectations,
          communication_strategy,
          contact_info,

          // ✅ legacy aliases (populate properly)
          stakeholder: norm(name),
          contact: point_of_contact || contactStr || "—",
          influence: influence_level,

          // These were previously "—" — now map them from contact_info
          impact: impact_level || "—",
          mapping: stakeholder_mapping || "—",
          milestone: involvement_milestone || "—",
          impact_notes: (stakeholder_impact || expectations || "—") as any,
          channels: channels || "—",
          group: group || "Project",

          // Common legacy fields some renderers use:
          type: internal_external || "—",
          title_role: title_role || "—",
        } as any;
      });

      return { meta, rows };
    }
  } catch {
    // swallow — fallback to legacy below
  }

  // -------------------------------------------------------------
  // Legacy fallback: artifact content_json/content shapes
  // -------------------------------------------------------------
  let doc: any = {};
  try {
    const { data: art } = await supabase
      .from("artifacts")
      .select("id, title, content_json, content, project_id")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (art) {
      doc = safeJson((art as any).content_json) ?? safeJson((art as any).content) ?? {};
      if (!meta.projectName || meta.projectName === "Project") {
        meta.projectName = norm((art as any).title) || meta.projectName;
      }
    }
  } catch {
    // swallow
  }

  // Accept multiple shapes:
  let rowsRaw: any[] = [];
  if (Array.isArray(doc?.rows)) rowsRaw = doc.rows;
  else if (Array.isArray(doc?.items)) rowsRaw = doc.items;
  else if (Array.isArray(doc?.stakeholders)) rowsRaw = doc.stakeholders;
  else if (Array.isArray(doc?.groups)) {
    rowsRaw = doc.groups.flatMap((g: any) => {
      const gname = norm(g?.name || g?.group || "");
      const inner = Array.isArray(g?.rows) ? g.rows : Array.isArray(g?.items) ? g.items : [];
      return inner.map((r: any) => ({ ...r, group: r?.group ?? gname }));
    });
  }

  const rows: StakeholderRegisterRow[] = (rowsRaw || []).map((r) => {
    const ci = r?.contact_info && typeof r.contact_info === "object" ? r.contact_info : null;

    // legacy-ish fields (best effort)
    const stakeholder = norm(r?.stakeholder ?? r?.name ?? ci?.name) || "—";

    const point = norm(r?.point_of_contact ?? r?.contact_details ?? r?.contact ?? ci?.point_of_contact ?? "");
    const contact = point || norm(ci?.email ?? r?.email ?? "") || "";

    const role = norm(r?.role ?? r?.title_role ?? r?.title ?? ci?.role ?? "") || "—";

    const influence = normLevel(r?.influence ?? r?.influence_level ?? ci?.influence_level, "medium");

    const expectations = norm(r?.expectations ?? r?.impact_notes ?? r?.stakeholder_impact ?? r?.notes ?? ci?.notes);
    const communication_strategy = norm(r?.communication_strategy ?? r?.channels ?? ci?.channels);

    const contact_info =
      ci ??
      (contact
        ? {
            point_of_contact: contact,
          }
        : {});

    // Attempt to map register columns
    const impact = norm(r?.impact ?? r?.impact_level ?? ci?.impact_level);
    const mapping = norm(r?.mapping ?? r?.stakeholder_mapping ?? ci?.stakeholder_mapping);
    const milestone = norm(r?.milestone ?? r?.involvement_milestone ?? ci?.involvement_milestone);
    const type = norm(r?.type ?? r?.internal_external ?? ci?.internal_external);
    const title_role = norm(r?.title_role ?? ci?.title_role);

    return {
      // ✅ canonical (best-effort)
      name: stakeholder,
      role,
      influence_level: influence,
      expectations,
      communication_strategy,
      contact_info,

      // ✅ legacy aliases (best-effort)
      stakeholder,
      contact: contact || "—",
      influence,
      impact: impact || "—",
      mapping: mapping || "—",
      milestone: milestone || "—",
      impact_notes: (norm(ci?.stakeholder_impact) || expectations || "—") as any,
      channels: joinChannels(r?.channels ?? ci?.channels) || "—",
      group: norm(r?.group ?? ci?.group ?? "Project") || "Project",
      type: type || "—",
      title_role: title_role || "—",
    } as any;
  });

  return { meta, rows };
}

export default loadStakeholderExportData;