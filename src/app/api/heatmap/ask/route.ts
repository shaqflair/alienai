import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getOpenAIClient, getOpenAIModel, getOpenAITemperature } from "@/lib/ai/openai-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { messages, context } = await req.json();
    if (!messages?.length) return NextResponse.json({ error: "No messages" }, { status: 400 });

    const openai = getOpenAIClient();

    const completion = await openai.chat.completions.create({
      model: getOpenAIModel(),
      temperature: getOpenAITemperature(),
      messages: [
        {
          role: "system",
          content: `You are a resource planning advisor with access to the following heatmap data. Answer questions from executives concisely, using bullet points and numbers where possible.\n\n${context}`,
        },
        ...messages,
      ],
      max_tokens: 1000,
    });

    return NextResponse.json({ text: completion.choices[0].message.content });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
