import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function normSlug(x: unknown) {
  const raw = safeStr(x);
  try {
    return decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(_: Request, ctx: { params: { slug: string } }) {
  const slug = normSlug(ctx?.params?.slug);

  if (!slug) return noStoreJson({ ok: false, error: "Missing slug" }, 400);

  const supabase = await createClient();

  // Diagnose whether this request has a user session
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const hasUser = !!auth?.user;

  const { data, error } = await supabase
    .from("governance_articles")
    .select(
      "id,slug,title,summary,content,category,updated_at,is_published,created_at"
    )
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error) {
    // Don't disguise real DB problems (schema/env issues) as 404
    console.error("[api][governance][article] DB ERROR", {
      slug,
      error,
      hasUser,
      authErr: authErr?.message ?? null,
    });

    return noStoreJson(
      {
        ok: false,
        error: "DB error",
        meta: {
          slug,
          hasUser,
          authErr: authErr?.message ?? null,
          dbMessage: error.message ?? null,
          dbCode: (error as any)?.code ?? null,
        },
      },
      500
    );
  }

  if (!data) {
    // This is either truly not present, or blocked by RLS (most likely)
    console.warn("[api][governance][article] NOT FOUND", {
      slug,
      hasUser,
      authErr: authErr?.message ?? null,
    });

    return noStoreJson(
      {
        ok: false,
        error: "Not found",
        meta: {
          slug,
          hasUser,
          authErr: authErr?.message ?? null,
          hint:
            "If the row exists in SQL editor but not here, it's almost certainly RLS or missing anon/authenticated SELECT policy/grant.",
        },
      },
      404
    );
  }

  return noStoreJson({ ok: true, article: data });
}