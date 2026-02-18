"use client";

import React from "react";
import ProjectCharterEditorFormLazy from "@/components/editors/ProjectCharterEditorFormLazy";

function href(u: string) {
  return u;
}

export default function ProjectCharterEditorForm(props: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly?: boolean;
  lockLayout?: boolean;
  artifactVersion?: number;
}) {
  const { artifactId } = props;

  // ? Current exporters (v2)
  const pdf = href(`/api/artifacts/charter/export/pdf?artifactId=${encodeURIComponent(artifactId)}`);
  const docx = href(`/api/artifacts/charter/export/docx?artifactId=${encodeURIComponent(artifactId)}`);
  const xlsx = href(`/api/artifacts/charter/export/xlsx?artifactId=${encodeURIComponent(artifactId)}`);

  // ? Legacy exporters (v1) — keep these visible like your UI showed
  const legacyPdf = href(`/api/artifacts/${encodeURIComponent(artifactId)}/export/pdf`);
  const legacyDocx = href(`/api/artifacts/${encodeURIComponent(artifactId)}/export/docx`);

  return (
    <div className="space-y-4">
      {/* Exports row */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="text-slate-500">Exports:</div>

        <a
          className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 hover:bg-slate-50"
          href={pdf}
        >
          PDF
        </a>
        <a
          className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 hover:bg-slate-50"
          href={docx}
        >
          DOCX
        </a>
        <a
          className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 hover:bg-slate-50"
          href={xlsx}
        >
          XLSX
        </a>

        <div className="ml-2 text-slate-400">
          Legacy:&nbsp;
          <a className="underline hover:text-slate-600" href={legacyPdf}>
            PDF
          </a>
          &nbsp;&nbsp;
          <a className="underline hover:text-slate-600" href={legacyDocx}>
            DOCX
          </a>
        </div>
      </div>

      <ProjectCharterEditorFormLazy {...props} />
    </div>
  );
}
