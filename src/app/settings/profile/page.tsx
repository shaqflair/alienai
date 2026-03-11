import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const dynamic = "force-dynamic";

const TIMEZONES = [
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam",
  "Europe/Madrid", "Europe/Rome", "Europe/Stockholm", "Europe/Warsaw",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Toronto", "America/Vancouver", "America/Sao_Paulo",
  "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Asia/Shanghai",
  "Asia/Kolkata", "Asia/Hong_Kong",
  "Australia/Sydney", "Australia/Melbourne",
  "Pacific/Auckland", "UTC",
];

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export default async function SettingsProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings/profile");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/settings?err=no_org");
  const organisationId = String(orgId);

  // Admin check
  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const myRole  = safeStr(mem?.role).toLowerCase();
  const isAdmin = myRole === "admin" || myRole === "owner";
  if (!isAdmin) redirect("/settings?err=not_admin");

  const { data: org } = await supabase
    .from("organisations")
    .select("id, name, logo_url, timezone, website, industry")
    .eq("id", organisationId)
    .maybeSingle();

  async function saveProfileAction(formData: FormData) {
    "use server";
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) redirect("/login");

    const updates: Record<string, string | null> = {
      name:     safeStr(formData.get("name")).trim()     || null,
      logo_url: safeStr(formData.get("logo_url")).trim() || null,
      timezone: safeStr(formData.get("timezone")).trim() || null,
      website:  safeStr(formData.get("website")).trim()  || null,
      industry: safeStr(formData.get("industry")).trim() || null,
    };
    if (!updates.name) throw new Error("Organisation name is required");

    const { error } = await sb.from("organisations").update(updates).eq("id", organisationId);
    if (error) throw new Error(error.message);
    
    revalidatePath("/settings/profile");
    revalidatePath("/settings");
  }

  const field = (label: string, name: string, defaultVal: string, opts?: {
    placeholder?: string; type?: string; hint?: string;
  }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      <label style={{ fontSize: "11px", fontWeight: 800, color: "#94a3b8",
                      textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
      <input
        name={name}
        type={opts?.type ?? "text"}
        defaultValue={defaultVal}
        placeholder={opts?.placeholder ?? ""}
        style={{
          padding: "9px 12px", borderRadius: "8px",
          border: "1.5px solid #e2e8f0", fontSize: "13px",
          fontFamily: "inherit", outline: "none", color: "#0f172a",
          background: "white",
        }}
      />
      {opts?.hint && (
        <span style={{ fontSize: "11px", color: "#94a3b8" }}>{opts.hint}</span>
      )}
    </div>
  );

  return (
    <div style={{ padding: "32px 40px", maxWidth: "640px", fontFamily: "'DM Sans', sans-serif" }}>
      <h1 style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a",
                   margin: "0 0 4px", letterSpacing: "-0.2px" }}>
        Organisation profile
      </h1>
      <p style={{ fontSize: "13px", color: "#94a3b8", margin: "0 0 28px" }}>
        Basic info shown across Aliena and in exported documents.
      </p>

      <form action={saveProfileAction}>
        <div style={{
          background: "white", borderRadius: "14px",
          border: "1.5px solid #e2e8f0", padding: "24px",
          display: "flex", flexDirection: "column", gap: "18px",
        }}>
          {org?.logo_url && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <img
                src={org.logo_url}
                alt="Logo"
                style={{ height: 48, width: "auto", borderRadius: 8,
                         border: "1.5px solid #e2e8f0", objectFit: "contain",
                         background: "white", padding: 4 }}
              />
              <span style={{ fontSize: "11px", color: "#94a3b8" }}>Current logo</span>
            </div>
          )}

          {field("Organisation name", "name", safeStr(org?.name), { placeholder: "e.g. Acme Corp" })}
          {field("Logo URL", "logo_url", safeStr(org?.logo_url), {
            placeholder: "https://... (Supabase Storage public URL)",
            hint: "Used in email headers and exported documents. Paste a public image URL.",
          })}
          {field("Website", "website", safeStr((org as any)?.website), { placeholder: "https://company.com" })}
          {field("Industry", "industry", safeStr((org as any)?.industry), { placeholder: "e.g. Professional Services" })}

          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label style={{ fontSize: "11px", fontWeight: 800, color: "#94a3b8",
                            textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Timezone
            </label>
            <select
              name="timezone"
              defaultValue={safeStr((org as any)?.timezone) || "Europe/London"}
              style={{
                padding: "9px 12px", borderRadius: "8px",
                border: "1.5px solid #e2e8f0", fontSize: "13px",
                fontFamily: "inherit", outline: "none", color: "#0f172a",
                background: "white", cursor: "pointer",
              }}
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          <button type="submit" style={{
            padding: "10px 20px", borderRadius: "9px", border: "none",
            background: "#0e7490", color: "white",
            fontSize: "13px", fontWeight: 800, cursor: "pointer",
            alignSelf: "flex-start", marginTop: "10px",
            boxShadow: "0 2px 12px rgba(14,116,144,0.25)",
          }}>
            Save changes
          </button>
        </div>
      </form>

      <div style={{
        marginTop: "24px", padding: "16px 20px",
        background: "white", borderRadius: "12px",
        border: "1.5px solid #fecaca",
      }}>
        <div style={{ fontSize: "12px", fontWeight: 800, color: "#dc2626", marginBottom: "6px" }}>
          Danger zone
        </div>
        <p style={{ fontSize: "12px", color: "#475569", margin: "0 0 10px" }}>
          Transfer ownership, leave, or delete this organisation.
        </p>
        <a
          href={`/organisations/${organisationId}/settings?tab=settings`}
          style={{
            fontSize: "12px", fontWeight: 700, color: "#dc2626",
            textDecoration: "none", padding: "6px 12px",
            border: "1.5px solid #fecaca", borderRadius: "7px",
            background: "rgba(239,68,68,0.05)", display: "inline-block",
          }}
        >
          Open danger zone
        </a>
      </div>
    </div>
  );
}
