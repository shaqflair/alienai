"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      // Session is automatically established when user lands here from email link
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setSuccess(true);
      router.replace("/projects");
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to reset password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Set a new password</h1>

      {success ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          ? Password updated. Redirecting…
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="grid gap-2">
            <span className="text-sm font-medium">New password</span>
            <input
              type="password"
              required
              className="rounded-md border px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Confirm password</span>
            <input
              type="password"
              required
              className="rounded-md border px-3 py-2 text-sm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
          >
            {loading ? "Saving…" : "Update password"}
          </button>
        </form>
      )}
    </main>
  );
}
