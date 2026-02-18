"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_BASE_URL || window.location.origin;

      const redirectTo = `${baseUrl}/auth/reset`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Reset your password</h1>

      <p className="text-sm opacity-70">
        Enter your email and we’ll send you a password reset link.
      </p>

      {sent ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          ? If an account exists for <b>{email}</b>, a reset link has been sent.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="grid gap-2">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              required
              className="rounded-md border px-3 py-2 text-sm"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <div className="text-sm">
        <Link href="/login" className="underline hover:opacity-80">
          Back to login
        </Link>
      </div>
    </main>
  );
}
