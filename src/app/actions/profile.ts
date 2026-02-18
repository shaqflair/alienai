"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function updateDisplayName(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.user_metadata ?? {}),
      full_name: fullName,
    },
  });
}

export async function uploadAvatar(formData: FormData) {
  const file = formData.get("avatar") as File | null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!file || !file.size) return;

  // Basic validation
  const maxBytes = 2 * 1024 * 1024; // 2MB
  if (file.size > maxBytes) throw new Error("Avatar must be <= 2MB");

  const allowed = ["image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("Only PNG/JPG/WEBP allowed");

  const ext =
    file.type === "image/png" ? "png" :
    file.type === "image/webp" ? "webp" : "jpg";

  const path = `${user.id}/avatar.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, bytes, { upsert: true, contentType: file.type });

  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = pub.publicUrl;

  await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.user_metadata ?? {}),
      avatar_url: avatarUrl,
    },
  });
}
