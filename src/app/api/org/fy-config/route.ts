import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

const VALID = [1, 4, 7, 10] as const;
type FyStart = typeof VALID[number];

function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return err("Unauthorized", 401);

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return err("No active organisation", 404);

    const { data, error } = await supabase
      .from("organisations")
      .select("fy_start_month")
      .eq("id", orgId)
      .maybeSingle();

    if (error) return err(error.message, 500);

    const fyStartMonth: FyStart = VALID.includes(data?.fy_start_month) ? data.fy_start_month : 4;

    return NextResponse.json({
      ok: true,
      fyStartMonth,
      fyOptions: [
        { value: 1,  label: "Jan – Dec (Calendar year)" },
        { value: 4,  label: "Apr – Mar (UK standard)" },
        { value: 7,  label: "Jul – Jun" },
        { value: 10, label: "Oct – Sep" },
      ],
    });
  } catch (e: any) {
    return err(String(e?.message ?? "Unknown error"), 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return err("Unauthorized", 401);

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return err("No active organisation", 404);

    // Check admin permission
    const { data: mem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", orgId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    const role = String(mem?.role ?? "").toLowerCase();
    if (role !== "owner" && role !== "admin") return err("Admin permission required", 403);

    const body = await req.json().catch(() => ({}));
    const fyStartMonth = Number(body?.fyStartMonth);
    if (!VALID.includes(fyStartMonth as FyStart)) {
      return err(`fyStartMonth must be one of: ${VALID.join(", ")}`, 400);
    }

    const { error } = await supabase
      .from("organisations")
      .update({ fy_start_month: fyStartMonth })
      .eq("id", orgId);

    if (error) return err(error.message, 500);

    return NextResponse.json({ ok: true, fyStartMonth });
  } catch (e: any) {
    return err(String(e?.message ?? "Unknown error"), 500);
  }
}
