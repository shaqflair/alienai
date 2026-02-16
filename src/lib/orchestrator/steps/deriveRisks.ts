import type { OrchestratorStep } from "../types";

export const deriveRisks: OrchestratorStep = {
  key: "derive_risks",
  async run(ctx) {
    if (ctx.artifactType !== "stakeholder_register") {
      return { ok: true, messages: ["Skipped (not stakeholder)"] };
    }

    const rows = ctx.artifactJson?.sections?.[0]?.table?.rows ?? [];

    const highRisk = rows.filter(
      (r: any) =>
        r.type === "data" &&
        String(r.cells?.[3]).toLowerCase().includes("high")
    );

    return {
      ok: true,
      messages: [`${highRisk.length} high-risk stakeholders detected`],
      data: {
        suggestedRaidEntries: highRisk.map((r: any) => ({
          risk: `Stakeholder resistance: ${r.cells[0]}`,
          impact: "Delivery delay",
          probability: "High",
        })),
      },
    };
  },
};
