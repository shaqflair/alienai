export type ExtractedSponsor = {
  name: string;
  role: string; // e.g. "Project Sponsor"
  source: "meta" | "approval_committee" | "stakeholders_section";
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : String(x ?? "");
}
function lower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function isRowObj(x: any): x is { type?: string; cells?: any[] } {
  return !!x && typeof x === "object" && Array.isArray((x as any).cells);
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function pickSponsorFromMeta(charter: any): ExtractedSponsor[] {
  const name = normalizeName(safeStr(charter?.meta?.project_sponsor ?? charter?.meta?.sponsor ?? ""));
  if (!name) return [];
  return [{ name, role: "Project Sponsor", source: "meta" }];
}

function pickSponsorsFromApprovalCommittee(charter: any): ExtractedSponsor[] {
  const sec = Array.isArray(charter?.sections)
    ? charter.sections.find((s: any) => lower(s?.key) === "approval_committee" || lower(s?.title).includes("approval"))
    : null;

  const rows = Array.isArray(sec?.table?.rows) ? sec.table.rows : [];
  const out: ExtractedSponsor[] = [];

  for (const r of rows) {
    if (!isRowObj(r)) continue;
    if (lower(r.type) === "header") continue;

    const role = normalizeName(safeStr(r.cells?.[0] ?? ""));
    const name = normalizeName(safeStr(r.cells?.[1] ?? ""));

    if (!role || !name) continue;

    // sponsor only (per your requirement)
    if (lower(role).includes("sponsor")) {
      out.push({ name, role: "Project Sponsor", source: "approval_committee" });
    }
  }

  return out;
}

function pickSponsorsFromStakeholdersSection(charter: any): ExtractedSponsor[] {
  const sec = Array.isArray(charter?.sections)
    ? charter.sections.find((s: any) => lower(s?.key) === "stakeholders" || lower(s?.title).includes("stakeholder"))
    : null;

  const rows = Array.isArray(sec?.table?.rows) ? sec.table.rows : [];
  const out: ExtractedSponsor[] = [];

  for (const r of rows) {
    if (!isRowObj(r)) continue;
    if (lower(r.type) === "header") continue;

    const stakeholderName = normalizeName(safeStr(r.cells?.[0] ?? ""));
    const roleInterest = normalizeName(safeStr(r.cells?.[1] ?? ""));

    if (!stakeholderName || !roleInterest) continue;

    // sponsor only (per your requirement)
    if (lower(roleInterest).includes("sponsor")) {
      out.push({ name: stakeholderName, role: "Project Sponsor", source: "stakeholders_section" });
    }
  }

  return out;
}

/**
 * Extract sponsor(s) from a Charter JSON (v2).
 * Priority:
 *  1) approval_committee rows containing "Sponsor"
 *  2) stakeholders section rows containing "Sponsor"
 *  3) meta.project_sponsor
 */
export function extractSponsorsFromCharter(charterJson: any): ExtractedSponsor[] {
  const charter = charterJson ?? {};

  const fromApproval = pickSponsorsFromApprovalCommittee(charter);
  if (fromApproval.length) return dedupeSponsors(fromApproval);

  const fromStakeholders = pickSponsorsFromStakeholdersSection(charter);
  if (fromStakeholders.length) return dedupeSponsors(fromStakeholders);

  const fromMeta = pickSponsorFromMeta(charter);
  return dedupeSponsors(fromMeta);
}

function dedupeSponsors(items: ExtractedSponsor[]) {
  const seen = new Set<string>();
  const out: ExtractedSponsor[] = [];
  for (const it of items) {
    const key = `${lower(it.name)}||${lower(it.role)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
