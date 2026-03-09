// src/lib/ai/raid-classify.ts
import "server-only";

type RaidAiClassification = {
  type?: "Risk" | "Issue" | "Assumption" | "Dependency";
  priority?: "Low" | "Medium" | "High" | "Critical";
  impact?: "low" | "medium" | "high" | "critical";
  probability?: number | null;
  severity?: number | null;
  ai_rollup?: string | null;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampInt0to100(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeType(v: any): RaidAiClassification["type"] | undefined {
  const s = safeStr(v).trim().toLowerCase();
  if (s === "risk") return "Risk";
  if (s === "issue") return "Issue";
  if (s === "assumption") return "Assumption";
  if (s === "dependency" || s === "dep") return "Dependency";
  return undefined;
}

function normalizePriority(v: any): RaidAiClassification["priority"] | undefined {
  const s = safeStr(v).trim().toLowerCase();
  if (s === "low") return "Low";
  if (s === "medium" || s === "med") return "Medium";
  if (s === "high") return "High";
  if (s === "critical" || s === "crit") return "Critical";
  return undefined;
}

function normalizeImpact(v: any): RaidAiClassification["impact"] | undefined {
  const s = safeStr(v).trim().toLowerCase();
  if (s === "low") return "low";
  if (s === "medium" || s === "med") return "medium";
  if (s === "high") return "high";
  if (s === "critical" || s === "crit") return "critical";
  return undefined;
}

export async function classifyRaidItem(input: {
  projectId?: string | null;
  title?: string | null;
  description?: string | null;
  response_plan?: string | null;
  next_steps?: string | null;
  notes?: string | null;
}): Promise<RaidAiClassification | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model =
    process.env.OPENAI_MODEL ||
    process.env.OPENAI_CHAT_MODEL ||
    process.env.OPENAI_RAID_MODEL ||
    "gpt-4o-mini";

  const prompt = `
You are classifying a RAID item for an enterprise PMO governance platform.

Return STRICT JSON only with this exact shape:
{
  "type": "Risk|Issue|Assumption|Dependency",
  "priority": "Low|Medium|High|Critical",
  "impact": "low|medium|high|critical",
  "probability": 0,
  "severity": 0,
  "ai_rollup": "short executive summary"
}

Classification rules:
- Risk = uncertain future event that may affect delivery
- Issue = current problem already happening now
- Assumption = believed condition that may need validation
- Dependency = reliance on external team, supplier, deliverable, approval, or event

Scoring rules:
- probability and severity must be integers between 0 and 100
- ai_rollup should be max 30 words, concise, executive tone

Context:
Project ID: ${safeStr(input.projectId)}
Title: ${safeStr(input.title)}
Description: ${safeStr(input.description)}
Response plan: ${safeStr(input.response_plan)}
Next steps: ${safeStr(input.next_steps)}
Notes: ${safeStr(input.notes)}
`.trim();

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      return null;
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return null;

    const parsed = JSON.parse(content);

    return {
      type: normalizeType(parsed?.type),
      priority: normalizePriority(parsed?.priority),
      impact: normalizeImpact(parsed?.impact),
      probability: clampInt0to100(parsed?.probability),
      severity: clampInt0to100(parsed?.severity),
      ai_rollup: safeStr(parsed?.ai_rollup).trim() || null,
    };
  } catch {
    return null;
  }
}

export default classifyRaidItem;