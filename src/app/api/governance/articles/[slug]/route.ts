import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: { slug: string } }) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("governance_articles")
    .select("*")
    .eq("slug", ctx.params.slug)
    .single();

  if (error || !data) {
    return NextResponse.json({ ok:false, error:"Not found" }, { status:404 });
  }

  return NextResponse.json({ ok:true, article:data });
}
