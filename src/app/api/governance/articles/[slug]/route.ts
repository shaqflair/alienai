import "server-only";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
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

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug?: string } }
) {
  const slug = normSlug(params?.slug);

  if (!slug) {
    return noStoreJson(
      { ok: false, error: "Missing slug", meta: { paramsPresent: !!params } },
      400
    );
  }

  const supabase = await createClient();

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
    console.error("[api][governance][article] DB ERROR", {
      slug,
      hasUser,
      authErr: authErr?.message ?? null,
      error,
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
    return noStoreJson(
      {
        ok: false,
        error: "Not found",
        meta: {
          slug,
          hasUser,
          authErr: authErr?.message ?? null,
        },
      },
      404
    );
  }

  return noStoreJson({ ok: true, article: data });
}