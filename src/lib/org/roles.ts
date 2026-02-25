export type OrgRole = "owner" | "admin" | "member";

export function normalizeOrgRole(x: unknown): OrgRole {
  const r = String(x || "").toLowerCase();
  return r === "owner" || r === "admin" || r === "member" ? r : "member";
}

export function canManageOrg(role: OrgRole) {
  return role === "owner" || role === "admin";
}
