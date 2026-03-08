"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { RaiseItemModal, type RaiseItemProjectOption } from "@/app/insights/InsightsClient";

export default function ProjectRaidRaiseButton({
  projectId,
  projectTitle,
  projectCode,
}: {
  projectId: string;
  projectTitle: string;
  projectCode: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const projects = React.useMemo<RaiseItemProjectOption[]>(
    () => [
      {
        id: projectId,
        title: projectTitle,
        code: projectCode,
      },
    ],
    [projectId, projectTitle, projectCode]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="action-btn"
      >
        + Raise RAID item
      </button>

      {open && (
        <RaiseItemModal
          projects={projects}
          lockedProjectId={projectId}
          lockedProjectTitle={projectTitle}
          lockedProjectCode={projectCode}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
