// FILE: src/app/api/assistant/route.ts
//
// Streaming chat API using OpenAI.
// Requires: OPENAI_API_KEY env var + `pnpm add openai`
// Model: gpt-4o

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { buildAssistantContext, formatSystemPrompt } from "@/app/assistant/_lib/build-context";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

type Message = { role: "user" | "assistant"; content: string };

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return bad("OPENAI_API_KEY not configured — add it to your environment variables", 500);

  // Auth
  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return bad("Not authenticated", 401);

  // Active org
  let orgId: string | null = null;
  try { orgId = String(await getActiveOrgId()); } catch {}
  if (!orgId) return bad("No active organisation", 400);

  // Parse body
  let body: any = {};
  try { body = await req.json(); } catch {}
  const messages: Message[] = Array.isArray(body?.messages) ? body.messages : [];
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage?.content?.trim()) return bad("Empty message", 400);

  // Build context
  let systemPrompt = "";
  try {
    const context = await buildAssistantContext(orgId);
    systemPrompt = formatSystemPrompt(context);
  } catch (e: any) {
    return bad(`Failed to load org data: ${e?.message}`, 500);
  }

  // Dynamically import openai so a missing package gives a clear error
  let OpenAI: any;
  try {
    const mod = await import("openai");
    OpenAI = mod.default;
  } catch {
    return bad(
      "The 'openai' package is not installed. Run: pnpm add openai",
      500
    );
  }

  const openai = new OpenAI({ apiKey });

  const openaiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.slice(-20).map((m: Message) => ({
      role:    m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  try {
    const stream = await openai.chat.completions.create({
      model:       "gpt-4o",
      messages:    openaiMessages,
      max_tokens:  1500,
      temperature: 0.3,
      stream:      true,
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
        "Content-Type":         "text/plain; charset=utf-8",
        "Transfer-Encoding":    "chunked",
        "Cache-Control":        "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e: any) {
    const msg = safeStr(e?.message);
    if (msg.includes("API key") || msg.includes("auth"))
      return bad("Invalid OpenAI API key — check OPENAI_API_KEY in your env vars", 500);
    if (msg.includes("quota") || msg.includes("429"))
      return bad("OpenAI quota exceeded", 429);
    if (msg.includes("model"))
      return bad("Model not available — check your OpenAI plan supports gpt-4o", 500);
    return bad(`OpenAI error: ${msg}`, 500);
  }
}