// src/lib/exports/stakeholder-register/types.ts
import "server-only";

export type StakeholderRegisterRow = {
  stakeholder: string;
  contact: string;       // email/phone/free text
  role: string;
  impact: string;        // High | Medium | Low | —
  influence: string;     // High | Medium | Low | —
  mapping: string;       // Keep Satisfied / Monitor / Keep Informed / —
  milestone: string;     // —
  impact_notes: string;  // long text
  channels: string;      // "Teams, Email"
  group?: string;        // optional (used for sorting only)
};

export type StakeholderRegisterMeta = {
  projectId: string;
  artifactId: string;

  projectName: string;           // display name
  projectCode: string;           // "P-100011" etc
  organisationName: string;      // "My Organisation"
  clientName: string;            // "Aliena"

  generated: string;             // "05/02/2026 17:01"
  generatedDate: string;         // "05/02/2026"
  generatedDateTime: string;     // "05/02/2026 17:01"
};
