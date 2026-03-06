import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { messages, context } = await req.json();
    if (!messages?.length) return NextResponse.json({ error: "No messages" }, { status: 400 });

    const client = getOpenAIClient();

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content: `You are a resource planning advisor for a capital project delivery team. You have access to live heatmap data showing team capacity, utilisation, and project allocations. Answer executive and PM questions concisely — use bullet points and specific numbers. Be direct and actionable.\n\n${context}`,
        },
        ...messages,
      ],
    });

    return NextResponse.json({ text: completion.choices[0]?.message?.content ?? "" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
