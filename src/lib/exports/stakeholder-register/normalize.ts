// src/lib/exports/stakeholder-register/normalize.ts
import "server-only";

import type { StakeholderRegisterRow } from "./types";
import { safeStr } from "./stakeholderShared";

function norm(x: any) {
  return safeStr(x).trim();
}

function level(x: any): string {
  const s = norm(x).toLowerCase();
  if (!s) return "—";
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  if (s === "—") return "—";
  return norm(x) || "—";
}

/**
 * Normalise export rows into a consistent shape.
 *
 * ✅ Keeps `group` (needed for XLSX + sorting + some templates)
 * ✅ Provides "alias" keys so older renderers don't go blank:
 *    - name / point_of_contact / stakeholder_impact / impact_level / influence_level / stakeholder_mapping / involvement_milestone
 */
export function normalizeStakeholderRows(rows: StakeholderRegisterRow[]): any[] {
  const input = Array.isArray(rows) ? rows : [];

  const out = input
    .map((r: any) => {
      const stakeholder = norm(r?.stakeholder || r?.name);
      const contact = norm(r?.contact || r?.point_of_contact || r?.contact_details) || "—";
      const role = norm(r?.role || r?.title_role || r?.title) || "—";

      const impact = level(r?.impact || r?.impact_level);
      const influence = level(r?.influence || r?.influence_level);

      const mapping = norm(r?.mapping || r?.stakeholder_mapping || r?.category) || "—";
      const milestone = norm(r?.milestone || r?.involvement_milestone || r?.frequency) || "—";

      const impact_notes = norm(r?.impact_notes || r?.stakeholder_impact || r?.notes) || "—";
      const channels = norm(r?.channels || r?.preferred_channel) || "—";

      const group = norm(r?.group) || "";

      // Canonical export shape (used by your PDF HTML and DOCX table)
      const canonical = {
        stakeholder,
        contact,
        role,
        impact,
        influence,
        mapping,
        milestone,
        impact_notes,
        channels,
        group,
      };

      // Alias shape (so “older style” renderers that expect UI keys still work)
      const aliases = {
        name: stakeholder,
        point_of_contact: contact,
        stakeholder_impact: impact_notes,
        impact_level: impact,
        influence_level: influence,
        stakeholder_mapping: mapping,
        involvement_milestone: milestone,
      };

      return { ...canonical, ...aliases };
    })
    // ✅ only drop truly empty stakeholders
    .filter((r: any) => !!r.stakeholder);

  // Sort like UI: group then stakeholder
  out.sort((a: any, b: any) => {
    const ak = `${a.group || ""}||${a.stakeholder || ""}`;
    const bk = `${b.group || ""}||${b.stakeholder || ""}`;
    return ak.localeCompare(bk);
  });

  return out;
}
