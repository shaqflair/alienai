// src/lib/exports/stakeholder-register/normalize.ts
import "server-only";

import type { StakeholderRegisterRow } from "./types";
import { safeStr } from "./stakeholderShared";

function norm(x: any) {
  return safeStr(x).trim();
}

function lower(x: any) {
  return norm(x).toLowerCase();
}

function influenceLevel(x: any): string {
  const s = lower(x);
  if (!s) return "medium";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  if (s === "low") return "low";
  return s;
}

function firstNonEmpty(...vals: any[]) {
  for (const v of vals) {
    const s = norm(v);
    if (s) return s;
  }
  return "";
}

function joinChannels(x: any) {
  if (Array.isArray(x)) return x.map((v) => norm(v)).filter(Boolean).join(", ");
  return norm(x);
}

function contactInfoToString(ci: any) {
  if (!ci) return "—";
  if (typeof ci === "string") return norm(ci) || "—";
  if (typeof ci !== "object") return norm(ci) || "—";

  // ✅ Prefer canonical "point_of_contact" first (your DB uses this)
  const point = norm((ci as any)?.point_of_contact);

  const email = norm((ci as any)?.email);
  const phone = norm((ci as any)?.phone);
  const org = norm((ci as any)?.organisation || (ci as any)?.organization);
  const handle = norm((ci as any)?.handle || (ci as any)?.teams || (ci as any)?.slack);
  const notes = norm((ci as any)?.notes);

  const parts = [point, email, phone, org, handle, notes].filter(Boolean);
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
 *
 * ✅ Key fix vs previous version:
 * - Do NOT wipe out impact/mapping/milestone/type/title fields.
 *   Pull them from contact_info (source of truth) when present.
 * - Prefer contact_info.point_of_contact for “Contact Details”
 * - Prefer contact_info.channels array for “Channels”
 */
export function normalizeStakeholderRows(rows: StakeholderRegisterRow[]): any[] {
  const input = Array.isArray(rows) ? rows : [];

  const out = input
    .map((r: any) => {
      const rawCi =
        r?.contact_info && typeof r.contact_info === "object"
          ? r.contact_info
          : r?.contact_info && typeof r.contact_info === "string"
          ? // if it was accidentally stringified earlier, leave it alone
            r.contact_info
          : null;

      // If contact_info is a string, we can't safely pick fields. Keep {} and use string as contact.
      const ciObj = rawCi && typeof rawCi === "object" ? rawCi : ({} as any);

      // New canonical (DB)
      const name = norm(r?.name ?? r?.stakeholder);
      const role = norm(r?.role);

      // Influence is top-level in DB, but preserve legacy alias too
      const influence_level = influenceLevel(r?.influence_level ?? r?.influence) || "medium";

      // Expectations / impact notes source:
      // Prefer contact_info.stakeholder_impact then expectations then legacy notes
      const expectations = firstNonEmpty(
        (ciObj as any)?.stakeholder_impact,
        r?.expectations,
        r?.impact_notes,
        r?.stakeholder_impact,
        r?.notes
      );

      // Communication strategy / actions (keep as-is)
      const communication_strategy = firstNonEmpty(r?.communication_strategy, r?.communication);

      // Pull “register columns” from contact_info (source of truth)
      const type = firstNonEmpty((ciObj as any)?.internal_external, r?.type, r?.internal_external);
      const title_role = firstNonEmpty((ciObj as any)?.title_role, r?.title_role, r?.title);
      const impact_level = firstNonEmpty((ciObj as any)?.impact_level, r?.impact_level, r?.impact);
      const stakeholder_mapping = firstNonEmpty(
        (ciObj as any)?.stakeholder_mapping,
        r?.stakeholder_mapping,
        r?.mapping
      );
      const involvement_milestone = firstNonEmpty(
        (ciObj as any)?.involvement_milestone,
        r?.involvement_milestone,
        r?.milestone
      );
      const group = firstNonEmpty((ciObj as any)?.group, r?.group, "Project");

      const channels = firstNonEmpty(
        joinChannels((ciObj as any)?.channels),
        joinChannels(r?.channels),
        joinChannels(r?.communication_strategy), // legacy misuse
        ""
      );

      // Contact details: prefer contact_info.point_of_contact, then any explicit contact fields
      const contactStr = firstNonEmpty(
        (ciObj as any)?.point_of_contact,
        r?.contact,
        r?.point_of_contact,
        r?.contact_details,
        r?.email,
        contactInfoToString(rawCi) // handles string/object
      );

      const canonical = {
        name,
        role: role || "—",
        influence_level: influence_level || "medium",
        expectations: expectations || "—",
        communication_strategy: communication_strategy || "—",
        contact_info: ciObj ?? {},
      };

      // Legacy aliases (safe + populated)
      const aliases = {
        stakeholder: name,
        contact: contactStr || "—",
        influence: influence_level || "medium",

        // ✅ Populate from contact_info where possible
        impact: impact_level || "—",
        mapping: stakeholder_mapping || "—",
        milestone: involvement_milestone || "—",
        impact_notes: expectations || "—",
        channels: channels || "—",
        group: group || "Project",

        // Extra keys some legacy renderers might expect
        point_of_contact: contactStr || "—",
        stakeholder_impact: expectations || "—",
        impact_level: impact_level || "—",
        stakeholder_mapping: stakeholder_mapping || "—",
        involvement_milestone: involvement_milestone || "—",
        internal_external: type || "—",
        title_role: title_role || "—",
        type: type || "—",
      };

      return { ...canonical, ...aliases };
    })
    .filter((r: any) => !!r?.name);

  out.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
  return out;
}