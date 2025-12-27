import { Resend } from "resend";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getResendClient() {
  const apiKey = requireEnv("RESEND_API_KEY");
  return new Resend(apiKey);
}

export function getFromAddress() {
  // Safer to avoid quotes in .env for this
  return requireEnv("RESEND_FROM");
}
