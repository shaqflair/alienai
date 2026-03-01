import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { buildAssistantContext, formatSystemPrompt } from "@/app/assistant/_lib/build-context";
import OpenAI from "openai";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

type Message = { role: "user" | "assistant"; content: string };

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return bad("OPENAI_API_KEY not configured", 500);

  // 1. Authenticate the User
  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return bad("Not authenticated", 401);

  // 2. Resolve the Active Organisation Context
  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) return bad("No active organisation context found", 400);

  // 3. Parse and Validate Request Body
  const body = await req.json().catch(() => ({}));
  const messages: Message[] = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages[messages.length - 1]?.content?.trim()) return bad("Empty message", 400);

  // 4. Inject Real-Time Resource Data into System Prompt
  let context;
  try {
    context = await buildAssistantContext(String(orgId));
  } catch (e: any) {
    return bad(`Failed to load organisation data: ${e?.message}`, 500);
  }

  const systemPrompt = formatSystemPrompt(context);

  // 5. Build OpenAI Message Payload (Limiting to last 20 turns for token efficiency)
  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.slice(-20).map((m: Message) => ({
      role:    m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const openai = new OpenAI({ apiKey });

  try {
    const stream = await openai.chat.completions.create({
      model:       "gpt-4o",
      messages:    openaiMessages,
      max_tokens:  1500,
      temperature: 0.3, 
      stream:      true,
    });

    // 6. Return a ReadableStream for word-by-word UI updates
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
    const msg = e?.message || "Internal Server Error";
    if (msg.includes("quota")) return bad("OpenAI quota exceeded", 429);
    return bad(`OpenAI service error: ${msg}`, 500);
  }
}
