import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function acceptOrgInvite(token: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/organisation-invites/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });

  // If NEXT_PUBLIC_SITE_URL isn't set, fall back to relative fetch (works on server in Next)
  if (res.status === 404 || res.status === 405) {
    const res2 = await fetch(`/api/organisation-invites/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    return res2.json();
  }

  return res.json();
}

export default async function OrgInviteTokenPage({
  params,
}: {
  params: { token?: string } | Promise<{ token?: string }>;
}) {
  const p = await Promise.resolve(params as any);
  const token = safeParam(p?.token).trim();

  if (!token) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-semibold">Invite link is invalid</h1>
        <p className="mt-2 text-sm text-gray-600">Missing invite token.</p>
        <div className="mt-4">
          <Link className="underline" href="/organisations">
            Go to organisations
          </Link>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth?.user) {
    redirect(`/login?next=${encodeURIComponent(`/organisations/invite/${encodeURIComponent(token)}`)}`);
  }

  try {
    // Call your existing API accept route
    const j = await acceptOrgInvite(token);

    if (!j?.ok) {
      const msg = String(j?.error || "Unable to accept invite.");
      return (
        <main className="mx-auto max-w-lg p-6">
          <h1 className="text-xl font-semibold">Couldn’t accept invite</h1>
          <p className="mt-2 text-sm text-gray-600">{msg}</p>

          <div className="mt-4 flex gap-3">
            <Link className="underline" href="/organisations">
              Go to organisations
            </Link>
            <Link className="underline" href="/login">
              Login
            </Link>
          </div>

          <div className="mt-6 rounded-lg border p-3 text-xs text-gray-600">
            If this keeps happening, the invite may be expired, revoked, already accepted, or intended for a different email.
          </div>
        </main>
      );
    }

    const orgId = String(j?.organisation_id || "").trim();
    if (orgId) {
      redirect(`/organisations/${encodeURIComponent(orgId)}/members?joined=1`);
    }

    // Edge case: accepted but no org id returned
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-semibold">Invite accepted</h1>
        <p className="mt-2 text-sm text-gray-600">
          You’ve been added to the organisation, but we couldn’t determine which one to open.
        </p>
        <div className="mt-4">
          <Link className="underline" href="/organisations">
            Go to organisations
          </Link>
        </div>
      </main>
    );
  } catch (e: any) {
    const msg = String(e?.message ?? "Unable to accept invite.");

    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-semibold">Couldn’t accept invite</h1>
        <p className="mt-2 text-sm text-gray-600">{msg}</p>

        <div className="mt-4 flex gap-3">
          <Link className="underline" href="/organisations">
            Go to organisations
          </Link>
          <Link className="underline" href="/login">
            Login
          </Link>
        </div>
      </main>
    );
  }
}
