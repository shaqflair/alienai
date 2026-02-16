import "server-only";

export type WireAIOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type WireAIResult = {
  text: string;
  raw?: any;
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normalizeBaseUrl(raw: string): string {
  const s = String(raw ?? "").trim().replace(/\/+$/, "");
  // Throws if invalid URL
  new URL(s);
  return s;
}

function describeFetchError(e: any): string {
  const msg = e?.message ? String(e.message) : "fetch failed";
  const cause = e?.cause;
  if (!cause) return msg;

  const causeMsg =
    cause?.message ? String(cause.message) :
    typeof cause === "string" ? cause :
    JSON.stringify(cause);

  return `${msg} (cause: ${causeMsg})`;
}

export async function wireAIGenerate(prompt: string, opts: WireAIOptions = {}): Promise<WireAIResult> {
  const apiKey = mustEnv("WIRE_AI_API_KEY");
  const baseUrl = normalizeBaseUrl(mustEnv("WIRE_AI_BASE_URL"));
  const defaultModel = process.env.WIRE_AI_MODEL || "wire-default";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);

  try {
    // NOTE: Replace endpoint/body with Wire AI’s real spec if different.
    const res = await fetch(`${baseUrl}/v1/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        model: opts.model ?? defaultModel,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 900,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`WireAI HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const data = await res.json();
    const text =
      data?.text ??
      data?.output?.text ??
      data?.choices?.[0]?.text ??
      "";

    return { text, raw: data };
  } catch (e: any) {
    throw new Error(`WireAI request failed: ${describeFetchError(e)}`);
  } finally {
    clearTimeout(t);
  }
}
