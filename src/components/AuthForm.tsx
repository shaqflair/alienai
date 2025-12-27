"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

type Mode = "signin" | "signup" | "magic";

function getOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export default function AuthForm({ next }: { next?: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  const nextUrl = next ?? sp.get("next") ?? "/projects";
  const resetDone = sp.get("reset") === "done";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [info, setInfo] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const showPassword = mode !== "magic";

  const showResend = useMemo(() => {
    const e = (err ?? "").toLowerCase();
    return (
      mode === "signin" &&
      !!pendingEmail &&
      (e.includes("confirm") ||
        e.includes("verified") ||
        e.includes("verification") ||
        e.includes("not confirmed"))
    );
  }, [err, mode, pendingEmail]);

  async function resendVerification() {
    const target = pendingEmail ?? email;
    if (!target) return;

    setErr(null);
    setInfo(null);
    setLoading(true);

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.resend({
        type: "signup",
        email: target,
        options: {
          emailRedirectTo: `${getOrigin()}/auth/callback`,
        },
      });

      if (error) throw error;

      setInfo("Verification email resent. Check your inbox (and spam).");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to resend verification email");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setLoading(true);

    try {
      const supabase = createClient();

      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${getOrigin()}/auth/callback?next=${encodeURIComponent(
              nextUrl
            )}`,
          },
        });

        if (error) throw error;

        setPendingEmail(email);
        setInfo("Magic link sent. Check your email to continue.");
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${getOrigin()}/auth/callback`,
          },
        });

        if (error) throw error;

        if (!data.session) {
          setPendingEmail(email);
          setInfo("Check your email to verify your account, then sign in.");
          return;
        }

        router.replace(nextUrl);
        router.refresh();
        return;
      }

      const res = await supabase.auth.signInWithPassword({ email, password });

      if (res.error) {
        const msg = String(res.error.message ?? "").toLowerCase();
        if (msg.includes("confirm") || msg.includes("verified") || msg.includes("not confirmed")) {
          setPendingEmail(email);
          setInfo("Your email is not verified yet. Check your inbox or resend verification.");
        }
        throw res.error;
      }

      router.replace(nextUrl);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to authenticate");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-xl border p-6 shadow-sm space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          {mode === "signin"
            ? "Sign in"
            : mode === "signup"
            ? "Create account"
            : "Magic link login"}
        </h1>
        <p className="text-sm text-gray-600">Continue to AlienAI</p>
      </div>

      {resetDone ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm">
          Password reset complete. Please sign in.
        </div>
      ) : null}

      {info ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          {info}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="text-sm">Email</label>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
          />
        </div>

        {showPassword ? (
          <div className="space-y-1">
            <label className="text-sm">Password</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
            />
          </div>
        ) : null}

        {err ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm">
            {err}
          </div>
        ) : null}

        <button
          disabled={loading}
          className="w-full rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
          type="submit"
        >
          {loading
            ? "Please wait..."
            : mode === "signin"
            ? "Sign in"
            : mode === "signup"
            ? "Create account"
            : "Send magic link"}
        </button>

        {showResend ? (
          <button
            type="button"
            disabled={loading}
            onClick={resendVerification}
            className="w-full rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
          >
            Resend verification email
          </button>
        ) : null}

        {mode === "signin" ? (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <Link href="/forgot-password" className="underline hover:opacity-80">
                Forgot password?
              </Link>

              <button
                type="button"
                className="underline hover:opacity-80"
                onClick={() => {
                  setMode("magic");
                  setErr(null);
                  setInfo(null);
                }}
              >
                Use magic link
              </button>
            </div>

            <button
              type="button"
              className="w-full rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setMode("signup");
                setErr(null);
                setInfo(null);
              }}
            >
              New here? Create an account
            </button>
          </div>
        ) : mode === "signup" ? (
          <div className="flex flex-col gap-2 text-sm">
            <button
              type="button"
              className="w-full rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setMode("signin");
                setErr(null);
                setInfo(null);
              }}
            >
              Already have an account? Sign in
            </button>

            <button
              type="button"
              className="w-full rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setMode("magic");
                setErr(null);
                setInfo(null);
              }}
            >
              Use magic link instead
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <button
              type="button"
              className="w-full rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setMode("signin");
                setErr(null);
                setInfo(null);
              }}
            >
              Back to password sign in
            </button>

            <button
              type="button"
              className="w-full rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setMode("signup");
                setErr(null);
                setInfo(null);
              }}
            >
              Create an account
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
