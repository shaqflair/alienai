"use client";

import { useEffect, useState } from "react";

export type ProjectRole = "viewer" | "editor" | "owner" | null;

export function useProjectRole(projectId: string | null, supabase: any) {
  const [role, setRole] = useState<ProjectRole>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!projectId || !supabase) return;
      setLoading(true);

      try {
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth?.user?.id;
        if (!userId) {
          if (alive) setRole(null);
          return;
        }

        const { data, error } = await supabase
          .from("project_members")
          .select("role")
          .eq("project_id", projectId)
          .eq("user_id", userId)
          .is("removed_at", null)
          .maybeSingle();

        if (error) throw error;

        const r = String((data as any)?.role ?? "").toLowerCase();
        const ok = r === "viewer" || r === "editor" || r === "owner" ? (r as any) : null;

        if (alive) setRole(ok);
      } catch {
        if (alive) setRole(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [projectId, supabase]);

  return { role, loading, isOwner: role === "owner" };
}
