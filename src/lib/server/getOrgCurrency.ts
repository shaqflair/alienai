// src/lib/server/getOrgCurrency.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";

export const SUPPORTED_CURRENCIES = [
  { code: "GBP", symbol: "£", label: "British Pound (GBP)" },
  { code: "USD", symbol: "$", label: "US Dollar (USD)" },
  { code: "EUR", symbol: "€", label: "Euro (EUR)" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar (AUD)" },
  { code: "CAD", symbol: "CA$", label: "Canadian Dollar (CAD)" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar (SGD)" },
  { code: "AED", symbol: "AED", label: "UAE Dirham (AED)" },
  { code: "ZAR", symbol: "R", label: "South African Rand (ZAR)" },
  { code: "INR", symbol: "₹", label: "Indian Rupee (INR)" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen (JPY)" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

export function currencySymbol(code: string): string {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

export async function getOrgCurrency(organisationId: string): Promise<string> {
  if (!organisationId) return "GBP";
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organisations")
      .select("default_currency")
      .eq("id", organisationId)
      .maybeSingle();
    return String((data as any)?.default_currency || "GBP").trim() || "GBP";
  } catch {
    return "GBP";
  }
}
