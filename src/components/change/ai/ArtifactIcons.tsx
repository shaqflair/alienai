"use client";
import React from "react";

type LinkFlags = {
  wbs?: number; // count
  schedule?: number;
  risks?: number;
};

function Chip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span className="aiIconChip" title={title} aria-label={title}>
      {children}
    </span>
  );
}

export default function ArtifactIcons({ links }: { links?: LinkFlags }) {
  const w = links?.wbs ?? 0;
  const s = links?.schedule ?? 0;
  const r = links?.risks ?? 0;

  const any = w + s + r > 0;
  if (!any) return null;

  return (
    <div className="aiArtifacts" aria-label="Linked artifacts">
      {w > 0 && <Chip title={`${w} WBS tasks affected`}>⛓</Chip>}
      {s > 0 && <Chip title={`${s} Schedule items affected`}>🗓</Chip>}
      {r > 0 && <Chip title={`${r} Risks linked`}>⚠</Chip>}
    </div>
  );
}
