// src/app/organisations/invite/[token]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, Loader2, ShieldCheck, LogIn } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

type PageState =
  | { status: "checking" }
  | { status: "needs-login" }
  | { status: "idle" }
  | { status: "accepting" }
  | { status: "success"; role: string }
  | { status: "error"; message: string };

export default function InviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const token =
    typeof params?.token === "string"
      ? params.token
      : Array.isArray(params?.token)
        ? params.token[0]
        : "";

  const [state, setState] = useState<PageState>({ status: "checking" });

  // Check auth on mount
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const sb = createClient();
        const { data } = await sb.auth.getUser();
        if (data?.user) {
          setState({ status: "idle" });
        } else {
          setState({ status: "needs-login" });
        }
      } catch {
        setState({ status: "needs-login" });
      }
    })();
  }, [token]);

  function goToLogin() {
    const returnTo = encodeURIComponent(`/organisations/invite/${token}`);
    router.push(`/login?redirectTo=${returnTo}`);
  }

  async function handleAccept() {
    if (!token) return;
    setState({ status: "accepting" });

    try {
      const res = await fetch("/api/organisation-invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({ ok: false, error: "Bad response" }));

      if (res.status === 401 || json?.error?.toLowerCase().includes("not authenticated")) {
        setState({ status: "needs-login" });
        return;
      }

      if (!json?.ok) {
        setState({ status: "error", message: json?.error || "Failed to accept invite" });
        return;
      }

      setState({ status: "success", role: json.role ?? "member" });
      setTimeout(() => router.push("/"), 2500);
    } catch (e: any) {
      setState({ status: "error", message: e?.message || "Something went wrong" });
    }
  }

  if (!token) {
    return (
      <PageShell>
        <ErrorCard message="Invalid invite link — token is missing." />
      </PageShell>
    );
  }

  return (
    <PageShell>
      {state.status === "checking" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
            <p className="text-sm text-gray-500">Checking your session…</p>
          </div>
        </div>
      )}

      {state.status === "needs-login" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50">
              <LogIn className="h-8 w-8 text-teal-600" />
            </div>
          </div>
          <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">Sign in to accept</h1>
          <p className="mb-8 text-center text-sm text-gray-500">
            You need to be signed in to accept this invite. We'll bring you straight back here after login.
          </p>
          <button
            type="button"
            onClick={goToLogin}
            className="w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
          >
            Sign in to continue
          </button>
          <p className="mt-4 text-center text-xs text-gray-400">
            Don't have an account? You can create one on the sign in page.
          </p>
        </div>
      )}

      {state.status === "idle" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50">
              <ShieldCheck className="h-8 w-8 text-teal-600" />
            </div>
          </div>
          <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">You've been invited</h1>
          <p className="mb-8 text-center text-sm text-gray-500">
            Click the button below to accept your invitation and join the organisation.
          </p>
          <button
            type="button"
            onClick={handleAccept}
            className="w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
          >
            Accept invite
          </button>
          <p className="mt-4 text-center text-xs text-gray-400">
            If you didn't expect this invite, you can safely close this page.
          </p>
        </div>
      )}

      {state.status === "accepting" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-teal-500" />
            <p className="text-sm font-medium text-gray-600">Accepting your invite…</p>
          </div>
        </div>
      )}

      {state.status === "success" && (
        <div className="rounded-2xl border border-green-100 bg-white p-8 shadow-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-50">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Invite accepted!</h2>
            <p className="text-center text-sm text-gray-500">
              You've joined as a{" "}
              <span className="font-semibold capitalize text-gray-700">{state.role}</span>.
              Taking you to your dashboard…
            </p>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Redirecting…
            </div>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <ErrorCard
          message={state.message}
          onRetry={() => setState({ status: "idle" })}
        />
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="mb-8 text-center">
        <div className="mb-2 inline-flex items-center justify-center rounded-xl bg-teal-600 px-4 py-2">
          <span className="text-base font-bold tracking-tight text-white">Aliena</span>
        </div>
        <p className="text-xs text-gray-400">Governance intelligence</p>
      </div>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 text-xs text-gray-400">
        If you didn't expect this invite, you can safely ignore this page. ·{" "}
        <a href="https://aliena.co.uk" className="hover:text-gray-600">
          aliena.co.uk
        </a>
      </p>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-100 bg-white p-8 shadow-sm">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
          <AlertTriangle className="h-8 w-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Something went wrong</h2>
        <p className="text-center text-sm text-gray-500">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-xl border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}