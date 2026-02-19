"use client";

import React from "react";
import ProjectCharterEditorFormLazy from "@/components/editors/ProjectCharterEditorFormLazy";

export default function ProjectCharterEditorForm(props: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly?: boolean;
  lockLayout?: boolean;
  artifactVersion?: number;

  // seed charter meta defaults
  projectTitle?: string;
  projectManagerName?: string;

  // approval props
  approvalEnabled?: boolean;
  canSubmitOrResubmit?: boolean;
  approvalStatus?: string | null;
  submitForApprovalAction?: ((formData: FormData) => Promise<void>) | (() => Promise<void>) | null;

  // legacy exports links (optional)
  legacyExports?: { pdf?: string; docx?: string; xlsx?: string };
}) {
  return (
    <div className="space-y-4">
      <ProjectCharterEditorFormLazy {...props} />
    </div>
  );
}
