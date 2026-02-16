// src/lib/artifacts/diff/types.ts
export type DiffOp = "add" | "remove" | "replace";

export type ArtifactDiffItem = {
  path: string;              // e.g. "meta.project_title" or "sections[2].bullets"
  op: DiffOp;                // add/remove/replace
  before?: unknown;          // old value (for remove/replace)
  after?: unknown;           // new value (for add/replace)
  note?: string;             // optional explanation from AI / reviewer
};

export type ArtifactDiff = {
  version: 1;
  artifact_type?: string;    // optional
  items: ArtifactDiffItem[];
};
