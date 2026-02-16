import "server-only";

export type DbStakeholder = {
  id: string;
  name: string | null;
  role: string | null;
  influence_level: string | null;
  contact_info: any | null;
  created_at?: string | null;
};

export type StakeholderExportRow = {
  id: string;
  name: string;
  point_of_contact: string;
  role: string;
  internal_external: string;
  title_role: string;
  impact_level: string;
  influence_level: "High" | "Medium" | "Low" | string;
  stakeholder_mapping: string;
  involvement_milestone: string;
  stakeholder_impact: string;
  channels: string; // comma-separated
  group: string;
};

export type StakeholderExportMeta = {
  projectId: string;
  projectTitle: string;
  projectCode?: string | null;
  projectHumanId?: string | null;
  organisationName?: string | null;
  clientName?: string | null;
  clientLogoUrl?: string | null;
  artifactTitle?: string | null;
};
