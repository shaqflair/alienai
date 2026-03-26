// src/lib/agent/orchestrator.ts
// The agent loop: plan → tool call → observe → repeat until done.
// Max 8 iterations to prevent runaway loops.
// Returns the final answer + any pending draft actions.

import "server-only";
import OpenAI from "openai";
import { AGENT_TOOLS } from "./tools";
import { executeTool, pendingDrafts, type DraftAction } from "./executor";
import type { ToolName } from "./tools";

const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are Aliena Intelligence — the AI agent embedded in the Aliena Project Intelligence Platform.

You help project managers, PMO leads, and C-suite executives make faster, better decisions about their project portfolio.

Your capabilities:
- Read live portfolio health scores, RAG status, and trend data
- Query specific project details: RAID, milestones, budget, governance
- List open risks and issues with severity and due dates
- Check gate readiness and governance compliance
- Draft new RAID items for user confirmation (never write without confirmation)
- Send notifications to the team

CURRENCY & FINANCIAL RULES — follow these precisely:
- All monetary values are in GBP (£). Always use £ not $. Never say "dollars".
- "Total budget" is the approved project budget (£102k = the full project envelope).
- "Financial exposure this quarter" is NOT the total budget — it means:
    1. What forecast has MOVED vs baseline this quarter (slippage or pull-forward)
    2. What actual spend has been recorded so far this quarter
    3. What is the forecast vs budget DELTA for the quarter's months specifically
  Answer with: quarterly budget slice, quarterly forecast, quarterly actual, and the variance (forecast - budget).
  If forecast > budget for the quarter, that is the exposure. If forecast < budget, that is headroom.
- "What has come in" = actual spend recorded (from project_spend rows or cost_lines in the financial plan).
- "What has moved since baseline" = forecast vs the original monthly budget — positive delta = overrun risk.
- Variance % = (forecast - budget) / budget × 100. Negative = under budget (good). Positive = over budget (risk).

Your communication style:
- Be direct and concise. Lead with the answer, then provide supporting detail.
- Use numbers and specifics — "£14k forecast vs £14k budget for Apr-Jun 2026"
- Always state the quarter explicitly e.g. "Q2 2026 (Apr–Jun)"
- When something needs action, say so clearly and tell the user what to do next
- Format responses with clear structure when listing multiple items
- Never make up data — only use what tools return
- Never use $ — always £

For write actions (creating RAID items, etc.):
- Always use the create_raid_draft tool first — never claim to have created something without using the tool
- Present the draft to the user and ask for confirmation before saying it will be saved
- Be clear that the action requires their approval

Current date: ${new Date().toISOString().slice(0, 10)}`;

export type AgentMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: any[];
};

export type AgentResult = {
  answer:       string;
  drafts:       DraftAction[];
  tool_calls:   string[];
  iterations:   number;
};

export async function runAgent(opts: {
  userMessage:    string;
  history?:       AgentMessage[];
  organisationId: string;
  userId:         string;
}): Promise<AgentResult> {
  const { userMessage, history = [], organisationId, userId } = opts;

  const client = new OpenAI({
    apiKey: process.env.WIRE_AI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  });

  // Clear any pending drafts from previous run
  pendingDrafts.length = 0;

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  const toolCallLog: string[] = [];
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.chat.completions.create({
      model:       "gpt-4o",
      messages,
      tools:       AGENT_TOOLS as any,
      tool_choice: "auto",
      max_tokens:  2000,
    });

    const choice = response.choices[0];
    const msg    = choice.message;

    // Add assistant message to history
    messages.push(msg);

    // If no tool calls — we have the final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return {
        answer:     msg.content ?? "I wasn't able to generate a response.",
        drafts:     [...pendingDrafts],
        tool_calls: toolCallLog,
        iterations,
      };
    }

    // Execute all tool calls in parallel
    const toolResults = await Promise.all(
      msg.tool_calls.map(async (tc: any) => {
        const name = tc.function.name as ToolName;
        let args: Record<string, any> = {};
        try { args = JSON.parse(tc.function.arguments); } catch {}

        toolCallLog.push(name);
        const result = await executeTool(name, args, organisationId, userId);

        return {
          role:         "tool" as const,
          tool_call_id: tc.id,
          content:      JSON.stringify(result),
        };
      })
    );

    // Add tool results to messages
    messages.push(...toolResults);

    // If finish reason is stop with tool calls already processed, loop again
    // The LLM will decide whether to call more tools or give the final answer
  }

  // Fallback if max iterations reached
  return {
    answer:     "I reached my iteration limit while processing your request. Please try a more specific question.",
    drafts:     [...pendingDrafts],
    tool_calls: toolCallLog,
    iterations,
  };
}