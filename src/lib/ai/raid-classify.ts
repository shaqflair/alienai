import "server-only";

import { getOpenAIClient, getOpenAIModel } from "@/lib/server/openai";

export async function classifyRaidItem(input: {
  title?: string | null;
  description?: string | null;
  response_plan?: string | null;
  next_steps?: string | null;
}) {
  const client = getOpenAIClient();
  const model = getOpenAIModel();

  const prompt = `
Classify this RAID item for a PMO governance platform.

Return strict JSON only:
{
  "type": "Risk|Issue|Assumption|Dependency",
  "priority": "Low|Medium|High|Critical",
  "impact": "low|medium|high|critical",
  "probability": 0-100,
  "severity": 0-100,
  "ai_rollup": "short executive summary"
}

Rules:
- Risk = uncertain future event
- Issue = current problem happening now
- Assumption = believed condition that may need validation
- Dependency = reliance on external team/item/event
- probability and severity must be integers 0-100
- ai_rollup max 35 words

Item:
Title: ${input.title ?? ""}
Description: ${input.description ?? ""}
Response plan: ${input.response_plan ?? ""}
Next steps: ${input.next_steps ?? ""}
`;

  const res = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text);

  return {
    type: parsed.type,
    priority: parsed.priority,
    impact: parsed.impact,
    probability:
      Number.isFinite(Number(parsed.probability)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.probability)))) : null,
    severity:
      Number.isFinite(Number(parsed.severity)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.severity)))) : null,
    ai_rollup: typeof parsed.ai_rollup === "string" ? parsed.ai_rollup.trim() : null,
  };
}
