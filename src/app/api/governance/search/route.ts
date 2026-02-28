// src/app/api/governance/search/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.headers.set("Pragma", "no-cache");
  return res;
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const qRaw = clamp(safeStr(url.searchParams.get("q")).trim(), 200);
    const q = qRaw;

    const cat = safeLower(url.searchParams.get("cat"));

    const supabase = await createClient();

    // Resolve category slug → id (optional)
    let categoryId: string | null = null;
    if (cat) {
      const { data: c, error: ce } = await supabase
        .from("governance_categories")
        .select("id")
        .eq("slug", cat)
        .eq("is_active", true)
        .maybeSingle();

      if (ce) return noStoreJson({ ok: false, error: safeStr(ce.message) }, 400);
      categoryId = c?.id ?? null;
    }

    // Join categories so UI can show category_name in dropdown
    // Note: governance_categories!left(...) works when FK exists on category_id
    let qb = supabase
      .from("governance_articles")
      .select(
        `
        id,
        slug,
        title,
        summary,
        updated_at,
        category_id,
        governance_categories!left (
          slug,
          name
        )
      `
      )
      .eq("is_published", true);

    if (categoryId) qb = qb.eq("category_id", categoryId);

    if (q) {
      const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
      qb = qb.or(`title.ilike.${like},summary.ilike.${like},content.ilike.${like}`);
    }

    const { data, error } = await qb.order("title", { ascending: true }).limit(50);

    if (error) return noStoreJson({ ok: false, error: safeStr(error.message) }, 400);

    // Normalize to the exact shape the client expects:
    // { ok:true, items:[{slug,title,summary,updated_at,category_name,category}] }
    const items = (Array.isArray(data) ? data : [])
      .map((row: any) => {
        const catName = safeStr(row?.governance_categories?.name).trim();
        const catSlug = safeStr(row?.governance_categories?.slug).trim();

        return {
          id: safeStr(row?.id),
          slug: safeStr(row?.slug),
          title: safeStr(row?.title),
          summary: row?.summary ?? null,
          updated_at: row?.updated_at ?? null,
          category: catSlug || null,
          category_name: catName || null,
        };
      })
      .filter((x: any) => safeStr(x.slug).trim());

    return noStoreJson(
      { ok: true, q, cat: cat || null, items },
      200
    );
  } catch (e: any) {
    return noStoreJson({ ok: false, error: safeStr(e?.message) || "Unknown error" }, 500);
  }
}