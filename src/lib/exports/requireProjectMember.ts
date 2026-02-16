import "server-only";
import { createClient } from "@/utils/supabase/server";

function cleanUuid(x: unknown): string {
  // Handles: '"uuid"', ' "uuid" ', etc.
  // (We only strip wrapping quotes; we don’t try to “fix” arbitrary strings.)
  if (x == null) return "";
  let s = String(x).trim();

  // strip wrapping single/double quotes repeatedly (in case of "\"uuid\"")
  // e.g. "\"abc\"" -> "\"abc\"" (string) -> remove outer quotes -> \"abc\"
  // then again -> abc
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(/^["']+/, "").replace(/["']+$/, "").trim();
    if (s === before) break;
  }

  return s;
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (s || "").trim()
  );
}

export async function requireProjectMember(projectId: string) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) {
    const e: any = new Error("Unauthorized");
    e.status = 401;
    throw e;
  }

  const pid = cleanUuid(projectId);
  if (!pid || !looksLikeUuid(pid)) {
    const e: any = new Error("Invalid projectId");
    e.status = 400;
    e.details = { projectId };
    throw e;
  }

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", pid)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) {
    const e: any = new Error("Forbidden");
    e.status = 403;
    throw e;
  }

  return { supabase, user: auth.user, role: mem.role as string };
}
