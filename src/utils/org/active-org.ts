import { cookies } from "next/headers";

const COOKIE_NAME = "active_org_id";

export async function getActiveOrgId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}
