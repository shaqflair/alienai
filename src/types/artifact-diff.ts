export type ArtifactDiffV1 = {
  schema_version: "artifact-diff@1";
  artifact_type: string;
  base_revision: number;
  head_revision: number;
  sections: SectionDiff[];
};

export type SectionDiff = {
  section_key: string;
  ops: DiffOp[];
};

export type DiffOp =
  | {
      op: "add";
      path: string;
      after: unknown;
    }
  | {
      op: "remove";
      path: string;
      before: unknown;
    }
  | {
      op: "replace";
      path: string;
      before: unknown;
      after: unknown;
    };
