// src/app/(app)/change/ChangeClientPage.tsx
"use client";

import React, { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

const ChangeManagementBoard = dynamic(
  () => import("@/components/change/ChangeManagementBoard"),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-sm text-slate-600">Loading Change Control…</div>
    ),
  }
);

/**
 * Legacy Change page wrapper (client)
 * - Forces the OLD template (ChangeManagementBoard)
 * - Supports projectId passed via querystring (projectId=...) for any old links
 */
export default function ChangeClientPage() {
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

  // If no projectId is available, the old board cannot load safely.
  // We keep this minimal to avoid rendering the wrong/new template.
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

  return <ChangeManagementBoard projectId={projectId} />;
}
