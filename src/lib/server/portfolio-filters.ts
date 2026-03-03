import "server-only";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function uniq(xs: string[]) {
  return Array.from(new Set(xs.map((s) => s.trim()).filter(Boolean)));
}

export type PortfolioFilters = {
  q?: string;
  projectId?: string[];
  projectCode?: string[];
  pm?: string[];
  dept?: string[];
};

export function readPortfolioFiltersFromUrl(url: URL): PortfolioFilters {
  const q = safeStr(url.searchParams.get("q")).trim() || undefined;

  const projectId = uniq(url.searchParams.getAll("projectId").flatMap((x) => x.split(",")));
  const projectCode = uniq(url.searchParams.getAll("projectCode").flatMap((x) => x.split(",")));
  const pm = uniq(url.searchParams.getAll("pm").flatMap((x) => x.split(",")));
  const dept = uniq(url.searchParams.getAll("dept").flatMap((x) => x.split(",")));

  return {
    q,
    projectId: projectId.length ? projectId : undefined,
    projectCode: projectCode.length ? projectCode : undefined,
    pm: pm.length ? pm : undefined,
    dept: dept.length ? dept : undefined,
  };
}

export async function applyPortfolioFiltersToProjectIds(args: {
  supabase: any;
  baseProjectIds: string[];
  filters: PortfolioFilters;
}) {
  const { supabase, baseProjectIds, filters } = args;
  const ids = uniq(baseProjectIds);
  if (!ids.length) return { projectIds: [] as string[], limited: false };

  const needAny =
    !!filters.q ||
    (filters.projectId && filters.projectId.length) ||
    (filters.projectCode && filters.projectCode.length) ||
    (filters.pm && filters.pm.length) ||
    (filters.dept && filters.dept.length);

  if (!needAny) return { projectIds: ids, limited: false };

  // Pull just enough fields to filter
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, project_code, project_manager_id, department")
    .in("id", ids)
    .limit(10000);

  if (error) {
    // If RLS blocks project fields, keep base scope (better than returning empty)
    return { projectIds: ids, limited: true };
  }

  const rows = Array.isArray(data) ? data : [];
  const idSet = new Set((filters.projectId || []).map((s) => String(s).trim()).filter(Boolean));
  const codeNeedles = (filters.projectCode || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  const pmSet = new Set((filters.pm || []).map((s) => String(s).trim()).filter(Boolean));
  const deptNeedles = (filters.dept || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  const q = String(filters.q || "").toLowerCase().trim();

  const out = rows
    .filter((p: any) => {
      const pid = safeStr(p?.id).trim();
      const title = safeStr(p?.title).toLowerCase();
      const code = safeStr(p?.project_code).toLowerCase();
      const pm = safeStr(p?.project_manager_id).trim();
      const dept = safeStr(p?.department).toLowerCase().trim();

      if (idSet.size && !idSet.has(pid)) return false;
      if (codeNeedles.length && !codeNeedles.some((c) => code.includes(c))) return false;
      if (pmSet.size && (!pm || !pmSet.has(pm))) return false;
      if (deptNeedles.length && (!dept || !deptNeedles.some((d) => dept.includes(d)))) return false;

      if (q) {
        const hay = `${title} ${code} ${dept}`.trim();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .map((p: any) => safeStr(p?.id).trim())
    .filter(Boolean);

  return { projectIds: uniq(out), limited: false };
}
