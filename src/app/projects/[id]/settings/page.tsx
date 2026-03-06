import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

import AuthButton from "@/components/auth/AuthButton";
import MembersSection from "@/components/projects/MembersSection";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function safeColor(x: unknown): string {
  const s = String(x ?? "").trim();
  if (!s) return "#E60000"; // default Vodafone-ish red
  // allow hex colors only (basic safety)
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s)) return s;
  return "#E60000";
}

export default async function ProjectSettingsPage({
  params,
}: {
  params: { id?: string } | Promise<{ id?: string }>;
}) {
  const supabase = await createClient();

  // Auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  // Next.js async params unwrap
  const p = await Promise.resolve(params);
  const projectId = safeParam(p.id);
  if (!projectId) notFound();

  // Member gate (also used for edit permissions)
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem) notFound();

  const myRole = String((mem as any)?.role ?? "viewer").toLowerCase();
  const canEdit = myRole === "owner" || myRole === "editor";

  // Load project (include branding fields)
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, title, client_name, client_logo_url, brand_primary_color, resource_status, win_probability")
    .eq("id", projectId)
    .single();

  if (projectErr || !project) notFound();

  // Inline Server Action: save branding
  async function saveBrandingAction(formData: FormData) {
    "use server";

    const supabase = await createClient();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect("/login");

    const pid = String(formData.get("project_id") ?? "");
    if (!pid) notFound();

    // Re-check permission server-side
    const { data: mem } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", pid)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    const role = String((mem as any)?.role ?? "viewer").toLowerCase();
    if (!(role === "owner" || role === "editor")) {
      throw new Error("You do not have permission to update branding for this project.");
    }

    const client_name = String(formData.get("client_name") ?? "").trim() || null;
    const client_logo_url = String(formData.get("client_logo_url") ?? "").trim() || null;
    const brand_primary_color = safeColor(formData.get("brand_primary_color"));

    const { error } = await supabase
      .from("projects")
      .update({
        client_name,
        client_logo_url,
        brand_primary_color,
      })
      .eq("id", pid);

    if (error) throw new Error(error.message);

    revalidatePath(`/projects/${pid}/settings`);
  }

  async function savePipelineAction(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect("/login");
    const pid = String(formData.get("project_id") ?? "");
    if (!pid) notFound();
    const { data: mem } = await supabase.from("project_members").select("role")
      .eq("project_id", pid).eq("user_id", auth.user.id).maybeSingle();
    const role = String((mem as any)?.role ?? "viewer").toLowerCase();
    if (!(role === "owner" || role === "editor")) throw new Error("Permission denied");
    const resource_status  = String(formData.get("resource_status") ?? "pipeline");
    const win_probability  = Math.min(100, Math.max(0, parseInt(String(formData.get("win_probability") ?? "50"), 10)));
    const { error } = await supabase.from("projects").update({ resource_status, win_probability }).eq("id", pid);
    if (error) throw new Error(error.message);
    revalidatePath(`/projects/${pid}/settings`);
  }

  const clientName = String((project as any).client_name ?? "").trim();
  const logoUrl = String((project as any).client_logo_url ?? "").trim();
  const brandColor = safeColor((project as any).brand_primary_color);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Project Settings</h1>
          <p className="text-sm text-gray-600">{project.title}</p>
        </div>
        <AuthButton />
      </div>

      {/* Branding */}
      <section className="border rounded-2xl bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Branding</div>
            <div className="text-xs text-gray-500">
              Used in Word / PDF / PPT exports (headers, watermark pack feel).
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Your role: <span className="font-mono">{myRole}</span>
          </div>
        </div>

        <form action={saveBrandingAction} className="grid gap-4">
          <input type="hidden" name="project_id" value={projectId} />

          <div className="grid gap-2">
            <label className="text-sm font-medium">Client name</label>
            <input
              name="client_name"
              defaultValue={clientName}
              placeholder="e.g., Vodafone UK / EDF Energy"
              className="border rounded-xl px-3 py-2"
              readOnly={!canEdit}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Client logo URL</label>
            <input
              name="client_logo_url"
              defaultValue={logoUrl}
              placeholder="Paste a public URL (Supabase Storage public link recommended)"
              className="border rounded-xl px-3 py-2"
              readOnly={!canEdit}
            />
            {logoUrl ? (
              <div className="flex items-center gap-3">
                {/* Use <img> to avoid Next/Image remote config friction */}
                <img
                  src={logoUrl}
                  alt="Client logo preview"
                  className="h-10 w-auto rounded-md border bg-white"
                />
                <span className="text-xs text-gray-500">Preview</span>
              </div>
            ) : (
              <div className="text-xs text-gray-500">No logo set yet.</div>
            )}
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Primary brand color (hex)</label>
            <div className="flex items-center gap-3">
              <input
                name="brand_primary_color"
                defaultValue={brandColor}
                placeholder="#E60000"
                className="border rounded-xl px-3 py-2 w-40 font-mono"
                readOnly={!canEdit}
              />
              <div
                className="h-8 w-8 rounded-xl border"
                style={{ backgroundColor: brandColor }}
                title={brandColor}
              />
              <div className="text-xs text-gray-500">Used for accents in exports (optional).</div>
            </div>
          </div>

          {canEdit ? (
            <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">
              Save branding
            </button>
          ) : (
            <div className="text-xs text-gray-500">
              Only owners/editors can edit branding.
            </div>
          )}
        </form>
      </section>

      {/* Members */}
      {/* Pipeline & Status */}
      <section className="border rounded-2xl bg-white p-5 space-y-4">
        <div>
          <div className="font-medium">Pipeline &amp; Status</div>
          <div className="text-xs text-gray-500">Controls heatmap demand weighting and project visibility.</div>
        </div>
        <form action={savePipelineAction} className="grid gap-4">
          <input type="hidden" name="project_id" value={projectId} />
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Resource Status</label>
              <select name="resource_status" defaultValue={String((project as any).resource_status ?? "pipeline")}
                disabled={!canEdit}
                className="border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="pipeline">Pipeline</option>
                <option value="confirmed">Confirmed</option>
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Win Probability <span className="text-gray-400 font-normal">(pipeline only)</span>
              </label>
              <div className="flex items-center gap-2">
                <input type="number" name="win_probability" min={0} max={100} step={5}
                  defaultValue={String((project as any).win_probability ?? 50)}
                  disabled={!canEdit}
                  className="border rounded-lg px-3 py-2 text-sm w-24" />
                <span className="text-sm text-gray-500">% — weights demand on heatmap</span>
              </div>
            </div>
          </div>
          {canEdit && (
            <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">
              Save status
            </button>
          )}
        </form>
      </section>

      <MembersSection projectId={projectId} myUserId={auth.user.id} />
    </div>
  );
}
