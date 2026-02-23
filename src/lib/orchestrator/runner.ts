import type {
  OrchestratorContext,
  OrchestratorResult,
} from "./types";
import { ORCHESTRATOR_STEPS } from "./registry";

export async function runOrchestrator(
  ctx: OrchestratorContext
): Promise<OrchestratorResult> {
  const messages: string[] = [];
  const data: Record<string, any> = {};

  for (const step of ORCHESTRATOR_STEPS) {
    try {
      const res = await step.run(ctx);
      messages.push(`[${step.key}] ${(res.messages ?? []).join("; ")}`);
      if (res.data) data[step.key] = res.data;
    } catch (err: any) {
      return {
        ok: false,
        messages: [`[${step.key}] failed: ${err?.message ?? err}`],
      };
    }
  }

  return {
    ok: true,
    messages,
    data,
  };
}
