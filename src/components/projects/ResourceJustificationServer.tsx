import "server-only";
import React from "react";
import { loadResourceJustificationData } from "@/app/projects/[id]/resource-justification-actions";
import ResourceJustificationPanel from "@/components/projects/ResourceJustificationPanel";

export default async function ResourceJustificationServer({
  projectId,
  projectTitle,
  canEdit,
}: {
  projectId: string;
  projectTitle: string;
  canEdit: boolean;
}) {
  let data;
  try {
    data = await loadResourceJustificationData(projectId);
  } catch {
    return null;
  }

  if (!data) return null;

  return (
    <ResourceJustificationPanel
      projectId={projectId}
      projectTitle={projectTitle}
      initialJustification={data.justification}
      budgetSummary={data.budgetSummary}
      openCRs={data.openCRs}
      roleRequirements={data.roleRequirements}
      allocatedDays={0}
      budgetDays={0}
      weeklyBurnRate={0}
      canEdit={canEdit}
    />
  );
}
