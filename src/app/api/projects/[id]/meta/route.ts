import "server-only";

        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();

    const id = safeStr(params?.id);

    const { data, error } = await supabase
      .from("projects")
      .select("id, title, client_name, project_code")
      .eq("id", id)
      .single();

    if (error) throw error;

    const human_id =
      data?.project_code != null && String(data.project_code).trim() !== ""
        ? String(data.project_code)
        : String(data?.id || "").slice(0, 6);

    return NextResponse.json({
      ok: true,
      project: {
        ...data,
        human_id,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

