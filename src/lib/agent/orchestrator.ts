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

Your communication style:
- Be direct and concise. Lead with the answer, then provide supporting detail.
- Use numbers and specifics — don't be vague ("a few projects at risk" → "3 projects are amber, 1 is red")
- When something needs action, say so clearly and tell the user what to do next
- Format responses with clear structure when listing multiple items
- Never make up data — only use what tools return

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

/**
 * runAgent
 * The core loop: calls the LLM, executes tools, feeds results back, 
 * and repeats until a final answer is generated.
 */
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

  // Clear any pending drafts from previous run to ensure idempotency
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

    // Add assistant message (potential tool calls) to history
    messages.push(msg);

    // If no tool calls — the LLM has synthesized the data into a final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return {
        answer:     msg.content ?? "I wasn't able to generate a response.",
        drafts:     [...pendingDrafts],
        tool_calls: toolCallLog,
        iterations,
      };
    }

    // Execute tool calls (handles multiple parallel calls if requested by LLM)
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

    // Feed the observations back into the message history
    messages.push(...toolResults);
  }

  return {
    answer:     "I reached my iteration limit while processing your request. Please try a more specific question.",
    drafts:     [...pendingDrafts],
    tool_calls: toolCallLog,
    iterations,
  };
}
