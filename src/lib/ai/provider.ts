import "server-only";

export type AIRequest = {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type AIResponse = {
  text: string;
};

/**
 * Provider router.
 * Set AI_PROVIDER=mock | wireai (later: openai, anthropic, etc.)
 */
export async function generateText(req: AIRequest): Promise<AIResponse> {
  const provider = String(process.env.AI_PROVIDER || "mock").toLowerCase();

  if (provider === "wireai") {
    const { wireAIGenerate } = await import("@/lib/wireai/client");
    const out = await wireAIGenerate(req.prompt, {
      model: req.model,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
    });
    return { text: out.text };
  }

  // Default: mock (offline)
  const { mockGenerate } = await import("@/lib/ai/mock");
  return { text: mockGenerate(req.prompt) };
}
