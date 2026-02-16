import "server-only";
import OpenAI from "openai";

export function getOpenAIClient() {
  const key = process.env.WIRE_AI_API_KEY; // <-- your variable
  if (!key) throw new Error("Missing WIRE_AI_API_KEY");
  return new OpenAI({ apiKey: key });
}

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

export function getOpenAITemperature() {
  const t = Number(process.env.OPENAI_TEMPERATURE);
  return Number.isFinite(t) ? t : 0.2;
}
