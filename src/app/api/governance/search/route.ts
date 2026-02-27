import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const qRaw = safeStr(url.searchParams.get("q")).trim();
    const q = qRaw.length > 200 ? qRaw.slice(0, 200) : qRaw;

    const cat = safeStr(url.searchParams.get("cat")).trim().toLowerCase();

    const supabase = await createClient();

    // Resolve category slug → id (optional)
    let categoryId: string | null = null;
    if (cat) {
      const { data: c } = await supabase
        .from("governance_categories")
        .select("id")
        .eq("slug", cat)
        .eq("is_active", true)
        .maybeSingle();
      categoryId = c?.id ?? null;
    }

    let qb = supabase
      .from("governance_articles")
      .select("id,slug,title,summary,updated_at,category_id")
      .eq("is_published", true);

    if (categoryId) qb = qb.eq("category_id", categoryId);

    if (q) {
      const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
      qb = qb.or(`title.ilike.${like},summary.ilike.${like},content.ilike.${like}`);
    }

    const { data, error } = await qb.order("title", { ascending: true }).limit(50);

    if (error) return noStoreJson({ ok: false, error: safeStr(error.message) }, 400);

    return noStoreJson({ ok: true, q, cat: cat || null, results: data ?? [] }, 200);
  } catch (e: any) {
    return noStoreJson({ ok: false, error: safeStr(e?.message) || "Unknown error" }, 500);
  }
}