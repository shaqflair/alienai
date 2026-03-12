"use server";

import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function sbErrText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function updateProfileRow(
  supabase: any,
  userId: string,
  patch: Record<string, any>
) {
  const first = await supabase.from("profiles").update(patch).eq("user_id", userId);

  if (!first.error) return;

  const msg = sbErrText(first.error).toLowerCase();
  const looksLikeColumnMismatch =
    msg.includes("column") ||
    msg.includes("user_id") ||
    msg.includes("schema") ||
    msg.includes("does not exist");

  if (!looksLikeColumnMismatch) {
    throw new Error(sbErrText(first.error));
  }

  const second = await supabase.from("profiles").update(patch).eq("id", userId);

  if (second.error) {
    throw new Error(sbErrText(second.error));
  }
}

export async function updateDisplayName(formData: FormData) {
  const fullName = safeStr(formData.get("full_name")).trim();

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr) throw new Error(sbErrText(authErr));
  if (!user) redirect("/login");

  const { error: authUpdateErr } = await supabase.auth.updateUser({
    data: {
      ...(user.user_metadata ?? {}),
      full_name: fullName,
    },
  });

  if (authUpdateErr) {
    throw new Error(sbErrText(authUpdateErr));
  }

  try {
    await updateProfileRow(supabase, user.id, { full_name: fullName || null });
  } catch {
    // fail open: auth metadata updated successfully
  }

  revalidatePath("/settings");
  revalidatePath("/people");
}

export async function uploadAvatar(formData: FormData) {
  const file = formData.get("avatar") as File | null;

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr) throw new Error(sbErrText(authErr));
  if (!user) redirect("/login");

  if (!file || !file.size) return;

  const maxBytes = 2 * 1024 * 1024; // 2MB
  if (file.size > maxBytes) throw new Error("Avatar must be <= 2MB");

  const allowed = ["image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(file.type)) {
    throw new Error("Only PNG, JPG, and WEBP files are allowed");
  }

  const ext =
    file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
      ? "webp"
      : "jpg";

  const path = `${user.id}/avatar.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, bytes, {
      upsert: true,
      contentType: file.type,
    });

  if (upErr) throw new Error(sbErrText(upErr));

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = safeStr(pub?.publicUrl).trim();

  if (!avatarUrl) {
    throw new Error("Failed to resolve avatar URL");
  }

  const { error: authUpdateErr } = await supabase.auth.updateUser({
    data: {
      ...(user.user_metadata ?? {}),
      avatar_url: avatarUrl,
    },
  });

  if (authUpdateErr) {
    throw new Error(sbErrText(authUpdateErr));
  }

  try {
    await updateProfileRow(supabase, user.id, { avatar_url: avatarUrl });
  } catch {
    // fail open: auth metadata updated successfully
  }

  revalidatePath("/settings");
  revalidatePath("/people");
}