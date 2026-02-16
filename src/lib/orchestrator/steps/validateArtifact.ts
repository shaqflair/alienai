import type { OrchestratorStep } from "../types";

export const validateArtifact: OrchestratorStep = {
  key: "validate",
  async run(ctx) {
    const sections = ctx.artifactJson?.sections ?? [];

    const emptySections = sections.filter(
      (s: any) =>
        !s.bullets &&
        (!s.table || s.table.rows?.length === 0)
    );

    return {
      ok: true,
      messages: [
        emptySections.length
          ? `${emptySections.length} weak/empty sections detected`
          : "All sections populated",
      ],
      data: {
        emptySectionKeys: emptySections.map((s: any) => s.key),
      },
    };
  },
};
