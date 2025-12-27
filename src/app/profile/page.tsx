import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { updateDisplayName, uploadAvatar } from "@/app/actions/profile";

function initialsFrom(s: string) {
  const parts = (s || "").trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase()).join("");
  return letters || "U";
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fullName = (user.user_metadata?.full_name as string | undefined) ?? "";
  const avatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? "";
  const email = user.email ?? "";
  const initials = initialsFrom(fullName || email);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Profile</h1>

      <div className="rounded-lg border bg-white p-5 space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt="Avatar"
              className="h-14 w-14 rounded-full border object-cover"
            />
          ) : (
            <div className="h-14 w-14 rounded-full border flex items-center justify-center font-semibold">
              {initials}
            </div>
          )}

          <form action={uploadAvatar} className="space-y-2">
            <div className="text-sm font-medium">Upload avatar</div>
            <input
              name="avatar"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="text-sm"
              required
            />
            <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50" type="submit">
              Upload
            </button>
            <div className="text-xs opacity-60">PNG/JPG/WEBP, max 2MB.</div>
          </form>
        </div>

        <div className="h-px bg-gray-200" />

        {/* Display name */}
        <form action={updateDisplayName} className="space-y-2">
          <div className="text-sm font-medium">Display name</div>
          <input
            name="full_name"
            defaultValue={fullName}
            placeholder="e.g. Alex Adu-Poku"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50" type="submit">
            Save name
          </button>
        </form>

        <div className="h-px bg-gray-200" />

        {/* Read-only */}
        <div className="text-sm">
          <div className="font-medium">Email</div>
          <div className="text-gray-700">{email}</div>
        </div>
      </div>
    </main>
  );
}
