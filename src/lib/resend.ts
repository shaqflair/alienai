import { Resend } from "resend";

/**
 * Ensure required environment variables exist.
 * Fails fast at runtime if misconfigured.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

/**
 * Returns a singleton-safe Resend client
 * Used for transactional emails (invites, alerts, etc.)
 */
export function getResendClient(): Resend {
  const apiKey = requireEnv("RESEND_API_KEY");
  return new Resend(apiKey);
}

/**
 * The verified "from" address/domain in Resend
 * Example: "AlienAI <invites@alienai.app>"
 */
export function getFromAddress(): string {
  return requireEnv("RESEND_FROM");
}

