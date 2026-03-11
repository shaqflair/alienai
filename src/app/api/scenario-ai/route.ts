import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

// Build a concise text summary of the scenario for GPT
function buildScenarioPrompt(body: any): string {
  const {
    people = [], projects = [], allocations = [],
    changes = [], warnings = [], liveConflictScore = 0,
    scenarioConflictScore = 0, userMessage = "",
  } = body;

  const today = new Date().toISOString().split("T")[0];

  const peopleList = people.map((p: any) =>
    `- ${p.fullName} | ${p.jobTitle ?? "No title"} | ${p.department ?? "No dept"} | ${p.capacityDays}d/wk`
  ).join("\n");

  const projectList = projects.map((p: any) =>
    `- ${p.title}${p.projectCode ? ` [${p.projectCode}]` : ""} | ${p.status} | ${p.startDate ?? "?"} → ${p.endDate ?? "ongoing"} | win: ${p.winProb ?? "?"}%`
  ).join("\n");

  const allocMap = new Map<string, Map<string, number>>();
  for (const a of allocations) {
    if (!allocMap.has(a.personName)) allocMap.set(a.personName, new Map());
    const byProj = allocMap.get(a.personName)!;
    byProj.set(a.projectTitle, (byProj.get(a.projectTitle) ?? 0) + a.daysAllocated);
  }
  const allocSummary = Array.from(allocMap.entries()).map(([person, projs]) =>
    `  ${person}: ${Array.from(projs.entries()).map(([proj, days]) => `${proj} (${days}d)`).join(", ")}`
  ).join("\n");

  const warningList = warnings.length > 0
    ? warnings.map((w: any) => `- [${w.severity.toUpperCase()}] ${w.message}`).join("\n")
    : "None";

  const changeList = changes.length > 0
    ? changes.map((c: any, i: number) => `${i + 1}. ${JSON.stringify(c)}`).join("\n")
    : "No changes yet (baseline)";

  const scoreDelta = scenarioConflictScore - liveConflictScore;
  const scoreNote = changes.length > 0
    ? `Conflict score: ${liveConflictScore} (live) → ${scenarioConflictScore} (scenario), delta: ${scoreDelta > 0 ? "+" : ""}${scoreDelta}`
    : `Current conflict score: ${liveConflictScore}`;

  return `You are Aliena AI, an expert governance intelligence advisor embedded in the What-If Scenario Simulator.
Today is ${today}.

Your role:
1. Analyse the current scenario state
2. Identify resourcing conflicts, risks, and opportunities
3. Suggest specific, actionable changes using the exact JSON change format below
4. Be concise — bullet points preferred, no waffle

=== TEAM (${people.length} people) ===
${peopleList || "No people"}

=== PROJECTS (${projects.length}) ===
${projectList || "No projects"}

=== CURRENT ALLOCATIONS ===
${allocSummary || "No allocations in view"}

=== SCENARIO CHANGES SO FAR ===
${changeList}

=== WARNINGS ===
${warningList}

=== CONFLICT SCORE ===
${scoreNote} (lower = better, 0 = no conflicts, 100 = severe)

=== CHANGE TYPES YOU CAN SUGGEST ===
When suggesting changes, always include a "suggestedChanges" JSON block at the END of your response.
Use this exact format — the UI will parse it and let users apply changes with one click:

\`\`\`json
{
  "suggestedChanges": [
    {
      "type": "add_allocation",
      "label": "Assign Alice to Alpha project",
      "personId": "<exact personId>",
      "projectId": "<exact projectId>",
      "startDate": "2026-03-01",
      "endDate": "2026-05-31",
      "daysPerWeek": 3
    },
    {
      "type": "swap_allocation",
      "label": "Move Bob from Alpha to Beta",
      "fromPersonId": "<exact personId>",
      "toPersonId": "<exact personId>",
      "projectId": "<exact projectId>",
      "startDate": "2026-03-01",
      "endDate": "2026-05-31"
    }
  ]
}
\`\`\`

IMPORTANT: Only suggest changes using exact personIds and projectIds from the data above.
If you cannot suggest specific changes, return "suggestedChanges": [].

User's question: ${userMessage || "Analyse this scenario."}`;
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return bad("OPENAI_API_KEY not configured", 500);

  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return bad("Not authenticated", 401);

  let body: any = {};
  try { body = await req.json(); } catch {}

  const systemPrompt = buildScenarioPrompt(body);

  let OpenAI: any;
  try {
    const mod = await import("openai");
    OpenAI = mod.default;
  } catch {
    return bad("openai package not installed. Run: pnpm add openai", 500);
  }

  const openai = new OpenAI({ apiKey });

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.4,
      max_tokens: 1200,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...(body.messages ?? []).slice(-6).map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
        { role: "user", content: body.userMessage || "Analyse this scenario." },
      ],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        } catch (e) {
          controller.error(e);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return bad(`OpenAI error: ${e.message}`, 500);
  }
}
