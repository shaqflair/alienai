// src/lib/server/portfolio-filters.ts

type ActiveFilterResult = {
  activeIds: string[];
  ok: boolean;
  error: string | null;
};

export async function filterActiveProjectIds(
  supabase: any,
  projectIds: string[]
): Promise<ActiveFilterResult> {
  if (!projectIds?.length) return { activeIds: [], ok: true, error: null };

  // IMPORTANT: fail-open default
  const failOpen = (err: unknown) => ({
    activeIds: projectIds,               // 👈 keep everything if we can't prove inactive
    ok: false,
    error: err instanceof Error ? err.message : String(err ?? "active filter failed"),
  });

  try {
    // Whatever your current active detection is (status / is_active / archived etc.)
    // Example: prefer boolean flags if they exist.
    const { data, error } = await supabase
      .from("projects")
      .select("id,is_active,archived,status,state")
      .in("id", projectIds);

    if (error) return failOpen(error);
    if (!Array.isArray(data) || data.length === 0) return { activeIds: projectIds, ok: false, error: "no rows returned" };

    const active = data
      .filter((p: any) => {
        // robust: treat unknown as active
        if (typeof p?.is_active === "boolean") return p.is_active === true;
        if (typeof p?.archived === "boolean") return p.archived === false;

        const s = String(p?.status ?? p?.state ?? "").toLowerCase().trim();
        if (!s) return true; // unknown => active
        return !["closed", "cancelled", "canceled", "archived", "complete", "completed"].includes(s);
      })
      .map((p: any) => p.id)
      .filter(Boolean);

    // If our logic produced nothing but we had ids, also fail-open (avoid false zeroing)
    if (active.length === 0 && projectIds.length > 0) {
      return { activeIds: projectIds, ok: false, error: "active filter yielded 0; failing open" };
    }

    return { activeIds: active, ok: true, error: null };
  } catch (e) {
    return failOpen(e);
  }
}