"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeRequest, CrStatus } from "@/lib/change/changeRequests";
import { groupByStatus } from "@/lib/change/changeRequests";

type ApiState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
};

export function useChangeRequests(projectId: string | null) {
  const [state, setState] = useState<ApiState<ChangeRequest[]>>({
    data: [],
    loading: false,
    error: null,
  });

  // --- load board
  const load = useCallback(async () => {
    if (!projectId) return;
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await fetch(`/api/change?projectId=${projectId}`);
      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load change requests");
      }

      setState({ data: json.data, loading: false, error: null });
    } catch (e: any) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e?.message || "Unexpected error",
      }));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // --- optimistic move
  const move = useCallback(
    async (id: string, status: CrStatus) => {
      if (!projectId) return;

      // optimistic update
      setState((s) => ({
        ...s,
        data: s.data.map((x) =>
          x.id === id ? { ...x, status, updated_at: new Date().toISOString() } : x
        ),
      }));

      try {
        const res = await fetch(`/api/change/${id}/move`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });

        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Move failed");
      } catch (e) {
        // rollback on error
        load();
      }
    },
    [projectId, load]
  );

  const grouped = useMemo(() => groupByStatus(state.data), [state.data]);

  return {
    items: state.data,
    grouped,
    loading: state.loading,
    error: state.error,
    reload: load,
    move,
  };
}
