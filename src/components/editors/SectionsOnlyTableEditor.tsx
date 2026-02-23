"use client";

import React from "react";
import ProjectCharterSectionEditor, {
  type CharterMeta,
  type CharterSection,
  type ImproveSectionPayload,
  type ApplySectionPatch,
} from "@/components/editors/ProjectCharterSectionEditor";

export default function SectionsOnlyTableEditor(props: {
  sections: CharterSection[];
  onChange: (sections: CharterSection[]) => void;
  readOnly: boolean;

  completenessByKey?: Record<string, { complete: boolean; label: string }>;

  onRegenerateSection?: (key: string) => void | Promise<void>;
  onImproveSection?: (payload: ImproveSectionPayload) => void | Promise<void>;
  onApplySectionPatch?: (patch: ApplySectionPatch) => void;

  aiDisabled?: boolean;
  aiLoadingKey?: string | null;

  includeContextForAI?: boolean;
}) {
  const meta: CharterMeta = {};

  return (
    <ProjectCharterSectionEditor
      meta={meta}
      onMetaChange={() => {
        /* no-op: meta hidden */
      }}
      sections={props.sections as any}
      onChange={props.onChange as any}
      readOnly={props.readOnly}
      completenessByKey={props.completenessByKey as any}
      onRegenerateSection={props.onRegenerateSection}
      onImproveSection={props.onImproveSection}

      aiDisabled={props.aiDisabled}
      aiLoadingKey={props.aiLoadingKey}
    />
  );
}
