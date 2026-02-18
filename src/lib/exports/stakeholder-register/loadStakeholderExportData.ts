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
 * Loads Stakeholder Register export data.
 *
 * ? NEVER returns meta as undefined (prevents "reading projectCode" crashes)
 * ? Prefers artifacts.content_json, but supports older shapes + grouped docs
 * ? Does NOT perform auth checks (routes already enforce membership)
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

  // ? Always initialise meta with safe defaults (NEVER undefined)
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
  // Project + organisation (best effort; DO NOT throw if missing)
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
    // swallow — meta stays safe
  }

  // -------------------------------------------------------------
  // Artifact content_json (preferred), fallback to content
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
      // if project title missing, at least set to artifact title
      if (!meta.projectName || meta.projectName === "Project") {
        meta.projectName = norm((art as any).title) || meta.projectName;
      }
    }
  } catch {
    // swallow — doc stays {}
  }

  // -------------------------------------------------------------
  // Accept multiple shapes:
  // 1) doc.rows / doc.items / doc.stakeholders
  // 2) doc.groups = [{ name, rows:[...] }]
  // -------------------------------------------------------------
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

    const stakeholder = norm(r?.stakeholder ?? r?.name ?? ci?.name);

    const contact = norm(
      r?.contact ??
        r?.contact_details ??
        r?.point_of_contact ??
        ci?.contact ??
        ci?.contact_details ??
        ci?.point_of_contact ??
        ci?.email ??
        r?.email ??
        ""
    );

    const role = norm(r?.role ?? r?.title_role ?? r?.title ?? ci?.role ?? ci?.title_role ?? "");

    const impact = norm(r?.impact ?? r?.impact_level ?? ci?.impact ?? ci?.impact_level);

    const influence = norm(r?.influence ?? r?.influence_level ?? ci?.influence ?? ci?.influence_level);

    const mapping = norm(r?.mapping ?? r?.stakeholder_mapping ?? ci?.stakeholder_mapping);

    const milestone = norm(r?.milestone ?? r?.involvement_milestone ?? ci?.involvement_milestone);

    const impact_notes = norm(
      r?.impact_notes ?? r?.stakeholder_impact ?? ci?.stakeholder_impact ?? r?.notes ?? ci?.notes
    );

    const channels = joinChannels(r?.channels ?? ci?.channels);

    const group = norm(r?.group ?? ci?.group);

    return {
      stakeholder,
      contact,
      role,
      impact,
      influence,
      mapping,
      milestone,
      impact_notes,
      channels,
      group: group || undefined,
    };
  });

  return { meta, rows };
}

export default loadStakeholderExportData;
