// src/lib/pdf/charter.ts
export type ProjectCharter = {
  header: {
    projectTitle: string;
    projectManager: string;
    projectSponsor: string;
    startDate?: string;
    endDate?: string;
  };
  businessNeed: string;
  scope: { scope: string; deliverables: string };
  milestones: { milestone: string; targetDate: string; actualDate?: string; notes?: string }[];
  financials: { budgetSummary: string };
  topRisksAndIssues: string[];
  dependencies: string[];
  decisionOrAsk: string;
  approvals: { role: string; name: string }[];
};

function s(x: any, fallback = ""): string {
  const v = typeof x === "string" ? x : x == null ? "" : String(x);
  return v.trim() || fallback;
}

function arrStrings(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => s(v)).filter(Boolean);
}

export function parseProjectCharter(content: string | null | undefined): ProjectCharter {
  // fallback matches your screenshot
  const fallback: ProjectCharter = {
    header: {
      projectTitle: "Project Charter",
      projectManager: "",
      projectSponsor: "",
      startDate: "",
      endDate: "",
    },
    businessNeed: "",
    scope: { scope: "", deliverables: "" },
    milestones: [],
    financials: { budgetSummary: "" },
    topRisksAndIssues: [],
    dependencies: [],
    decisionOrAsk: "",
    approvals: [
      { role: "Project Manager", name: "" },
      { role: "Sponsor", name: "" },
    ],
  };

  const raw = s(content);
  if (!raw) return fallback;

  let obj: any = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    // if content is plain text, treat as business need
    return { ...fallback, businessNeed: raw };
  }

  return {
    header: {
      projectTitle: s(obj?.header?.projectTitle, fallback.header.projectTitle),
      projectManager: s(obj?.header?.projectManager),
      projectSponsor: s(obj?.header?.projectSponsor),
      startDate: s(obj?.header?.startDate),
      endDate: s(obj?.header?.endDate),
    },
    businessNeed: s(obj?.businessNeed),
    scope: {
      scope: s(obj?.scope?.scope),
      deliverables: s(obj?.scope?.deliverables),
    },
    milestones: Array.isArray(obj?.milestones)
      ? obj.milestones.map((m: any) => ({
          milestone: s(m?.milestone),
          targetDate: s(m?.targetDate),
          actualDate: s(m?.actualDate),
          notes: s(m?.notes),
        }))
      : [],
    financials: { budgetSummary: s(obj?.financials?.budgetSummary) },
    topRisksAndIssues: arrStrings(obj?.topRisksAndIssues),
    dependencies: arrStrings(obj?.dependencies),
    decisionOrAsk: s(obj?.decisionOrAsk),
    approvals: Array.isArray(obj?.approvals)
      ? obj.approvals.map((a: any) => ({ role: s(a?.role), name: s(a?.name) }))
      : fallback.approvals,
  };
}
