import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return jsonErr(authErr.message, 401);
  if (!auth?.user) return jsonErr("Unauthorized", 401);

  const body = await req.json().catch(() => null);
  const itemName = safeStr(body?.itemName).trim();

  if (!itemName) return jsonErr("Missing itemName", 400);

  // ✅ simple heuristic placeholder:
  // You can replace this with: fetch to your AI orchestrator + project context + historical averages.
  // For now we give a reasonable guess.
  const lower = itemName.toLowerCase();
  let hours = 8;

  if (lower.includes("workshop") || lower.includes("meeting")) hours = 4;
  if (lower.includes("design")) hours = 16;
  if (lower.includes("build") || lower.includes("implement")) hours = 24;
  if (lower.includes("test") || lower.includes("qa")) hours = 12;
  if (lower.includes("deploy") || lower.includes("release")) hours = 6;

  return jsonOk({ hours });
}

