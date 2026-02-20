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

function contactInfoToString(ci: any) {
  if (!ci) return "";
  if (typeof ci === "string") return norm(ci);
  if (typeof ci !== "object") return norm(ci);

  const email = norm(ci?.email);
  const phone = norm(ci?.phone);
  const org = norm(ci?.organisation || ci?.organization);
  const handle = norm(ci?.handle || ci?.teams || ci?.slack);
  const notes = norm(ci?.notes);

  const parts = [email, phone, org, handle, notes].filter(Boolean);
  if (parts.length) return parts.join(" | ");

  try {
    const s = JSON.stringify(ci);
    return s.length > 240 ? s.slice(0, 240) + "…" : s;
  } catch {
    return "";
  }
}

/**
 * Loads Stakeholder Register export data.
 *
 * ✅ Prefers DB table: public.stakeholders (NEW source of truth)
 * ✅ Falls back to artifacts.content_json for legacy documents
 * ✅ NEVER returns meta as undefined
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
        "id, project_id, artifact_id, name, role, influence_level, expectations, communication_strategy, contact_info, created_at, updated_at"
      )
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId);

    if (!error && Array.isArray(dbRows) && dbRows.length) {
      const rows: StakeholderRegisterRow[] = dbRows.map((r: any) => {
        const name = norm(r?.name);
        const role = norm(r?.role);
        const influence_level = norm(r?.influence_level) || "medium";
        const expectations = norm(r?.expectations);
        const communication_strategy = norm(r?.communication_strategy);

        const contact_info = r?.contact_info && typeof r.contact_info === "object" ? r.contact_info : safeJson(r?.contact_info) ?? {};

        // Return in a shape that BOTH new + legacy renderers can survive.
        // New canonical fields:
        //   name, role, influence_level, expectations, communication_strategy, contact_info
        // Legacy aliases (used by older HTML/DOCX/XLSX renderers):
        //   stakeholder, contact, influence, impact_notes, channels, group, etc.
        const contactStr = contactInfoToString(contact_info);

        return {
          // ✅ new canonical
          name,
          role,
          influence_level,
          expectations,
          communication_strategy,
          contact_info,

          // ✅ legacy aliases (harmless if unused)
          stakeholder: name,
          contact: contactStr || "—",
          influence: influence_level,
          impact: "—",
          mapping: "—",
          milestone: "—",
          impact_notes: expectations || "—",
          channels: joinChannels((contact_info as any)?.channels) || "—",
          group: "Project",
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

    // Legacy fields
    const stakeholder = norm(r?.stakeholder ?? r?.name ?? ci?.name);
    const contact = norm(
      r?.contact ??
        r?.contact_details ??
        r?.point_of_contact ??
        ci?.email ??
        r?.email ??
        ""
    );
    const role = norm(r?.role ?? r?.title_role ?? r?.title ?? ci?.role ?? "");

    const influence = norm(r?.influence ?? r?.influence_level ?? ci?.influence_level) || "medium";
    const expectations = norm(r?.expectations ?? r?.impact_notes ?? r?.stakeholder_impact ?? r?.notes ?? ci?.notes);
    const communication_strategy = norm(r?.communication_strategy ?? r?.channels ?? ci?.channels);

    const contact_info = ci ?? (contact ? { email: contact } : {});

    return {
      // ✅ new canonical (best-effort)
      name: stakeholder,
      role,
      influence_level: influence,
      expectations,
      communication_strategy,
      contact_info,

      // ✅ legacy aliases
      stakeholder,
      contact: contact || "—",
      influence,
      impact: "—",
      mapping: "—",
      milestone: "—",
      impact_notes: expectations || "—",
      channels: joinChannels(r?.channels ?? ci?.channels) || "—",
      group: norm(r?.group ?? "Project") || "Project",
    } as any;
  });

  return { meta, rows };
}

export default loadStakeholderExportData;