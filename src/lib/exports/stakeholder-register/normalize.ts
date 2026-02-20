// src/lib/exports/stakeholder-register/normalize.ts
import "server-only";

import type { StakeholderRegisterRow } from "./types";
import { safeStr } from "./stakeholderShared";

function norm(x: any) {
  return safeStr(x).trim();
}

function influenceLevel(x: any): string {
  const s = norm(x).toLowerCase();
  if (!s) return "medium";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  if (s === "low") return "low";
  return s;
}

function contactInfoToString(ci: any) {
  if (!ci) return "—";
  if (typeof ci === "string") return norm(ci) || "—";
  if (typeof ci !== "object") return norm(ci) || "—";

  const email = norm(ci?.email);
  const phone = norm(ci?.phone);
  const org = norm(ci?.organisation || ci?.organization);
  const notes = norm(ci?.notes);

  const parts = [email, phone, org, notes].filter(Boolean);
  if (parts.length) return parts.join(" | ");

  try {
    const s = JSON.stringify(ci);
    return s.length > 240 ? s.slice(0, 240) + "…" : s;
  } catch {
    return "—";
  }
}

/**
 * Normalise export rows into the NEW stakeholder DB shape,
 * while preserving legacy alias keys so older renderers don't go blank.
 */
export function normalizeStakeholderRows(rows: StakeholderRegisterRow[]): any[] {
  const input = Array.isArray(rows) ? rows : [];

  const out = input
    .map((r: any) => {
      // New canonical (DB)
      const name = norm(r?.name ?? r?.stakeholder);
      const role = norm(r?.role);
      const influence_level = influenceLevel(r?.influence_level ?? r?.influence) || "medium";
      const expectations = norm(r?.expectations ?? r?.impact_notes ?? r?.stakeholder_impact ?? r?.notes);
      const communication_strategy = norm(r?.communication_strategy ?? r?.communication ?? r?.channels);

      const contact_info =
        r?.contact_info && typeof r.contact_info === "object"
          ? r.contact_info
          : (r?.contact_info ? ({} as any) : ({} as any));

      // Legacy-friendly derived string
      const contactStr =
        norm(r?.contact ?? r?.point_of_contact ?? r?.contact_details ?? r?.email) ||
        contactInfoToString(contact_info);

      const canonical = {
        name,
        role: role || "—",
        influence_level: influence_level || "medium",
        expectations: expectations || "—",
        communication_strategy: communication_strategy || "—",
        contact_info: contact_info ?? {},
      };

      // Legacy aliases (safe)
      const aliases = {
        stakeholder: name,
        contact: contactStr || "—",
        influence: influence_level || "medium",
        impact: "—",
        mapping: "—",
        milestone: "—",
        impact_notes: expectations || "—",
        channels: communication_strategy || "—",
        group: norm(r?.group) || "Project",

        // also keep old “xlsx renderer” keys if any code still expects them
        point_of_contact: contactStr || "—",
        stakeholder_impact: expectations || "—",
        impact_level: "—",
        stakeholder_mapping: "—",
        involvement_milestone: "—",
      };

      return { ...canonical, ...aliases };
    })
    .filter((r: any) => !!r?.name);

  out.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
  return out;
}