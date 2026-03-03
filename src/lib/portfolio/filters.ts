// src/lib/portfolio/filters.ts

export type PortfolioFilters = {
  q?: string; // free-text: name/code/PM/department
  projectIds?: string[];
  projectCodes?: string[];
  projectManagers?: string[]; // profile ids
  departments?: string[];
  range?: "7d" | "14d" | "30d" | "60d" | "custom";
};

export const DEFAULT_RANGE: PortfolioFilters["range"] = "30d";

export function filtersToSearchParams(f: PortfolioFilters) {
  const p = new URLSearchParams();

  if (f.q) p.set("q", f.q.trim());

  (f.projectIds ?? []).forEach((v) => p.append("projectId", v));
  (f.projectCodes ?? []).forEach((v) => p.append("projectCode", v));
  (f.projectManagers ?? []).forEach((v) => p.append("pm", v));
  (f.departments ?? []).forEach((v) => p.append("dept", v));

  if (f.range) p.set("range", f.range);

  return p;
}

export function searchParamsToFilters(sp: URLSearchParams): PortfolioFilters {
  const q = sp.get("q") ?? undefined;
  const range = (sp.get("range") as PortfolioFilters["range"]) ?? undefined;

  const projectIds = sp.getAll("projectId");
  const projectCodes = sp.getAll("projectCode");
  const projectManagers = sp.getAll("pm");
  const departments = sp.getAll("dept");

  return {
    q: q?.trim() || undefined,
    range: range || undefined,
    projectIds: projectIds.length ? projectIds : undefined,
    projectCodes: projectCodes.length ? projectCodes : undefined,
    projectManagers: projectManagers.length ? projectManagers : undefined,
    departments: departments.length ? departments : undefined,
  };
}

export function hasActiveFilters(f: PortfolioFilters) {
  return Boolean(
    (f.q && f.q.trim()) ||
      (f.projectIds?.length ?? 0) ||
      (f.projectCodes?.length ?? 0) ||
      (f.projectManagers?.length ?? 0) ||
      (f.departments?.length ?? 0)
  );
}
