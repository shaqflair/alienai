// src/app/(app)/change/ChangeClientPage.tsx
"use client";

import React, { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Legacy Change page wrapper (client)
 * - Accepts projectId via querystring (projectId=...) for old links
 * - Redirects to canonical project route: /projects/[id]/change
 *
 * We do NOT pass props to ChangeManagementBoard.
 */
export default function ChangeClientPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const projectId = useMemo(() => {
    const v =
      sp?.get("projectId") ||
      sp?.get("project_id") ||
      sp?.get("pid") ||
      sp?.get("id") ||
      "";
    return String(v).trim();
  }, [sp]);

  useEffect(() => {
    if (!projectId) return;
    router.replace(`/projects/${encodeURIComponent(projectId)}/change`);
  }, [projectId, router]);

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="text-sm font-semibold text-slate-900">
          Change Control
        </div>
        <div className="mt-1 text-sm text-slate-600">
          Missing <span className="font-mono">projectId</span>. Open Change
          Control from inside a project.
        </div>
      </div>
    );
  }

  return <div className="p-6 text-sm text-slate-600">Opening Change Control…</div>;
}
