// src/app/invite/[token]/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { acceptInviteByToken } from "@/app/projects/[id]/members/actions";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export default async function InviteTokenPage({
  params,
}: {
  params: { token?: string } | Promise<{ token?: string }>;
}) {
  const p = await Promise.resolve(params as any);
  const token = safeParam(p?.token);

  if (!token) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-semibold">Invite link is invalid</h1>
        <p className="mt-2 text-sm text-gray-600">Missing invite token.</p>
        <div className="mt-4">
          <Link className="underline" href="/projects">
            Go to projects
          </Link>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  // If not logged in, send them to login with next back to this invite
  if (!auth?.user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${encodeURIComponent(token)}`)}`);
  }

  try {
    const res = await acceptInviteByToken(token);
    const projectId = res?.projectId;

    // Success → go to project members page (nice confirmation UX)
    if (projectId) {
      redirect(`/projects/${projectId}/members?joined=1`);
    }

    // Edge case: accepted but project id not returned
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-semibold">Invite accepted</h1>
        <p className="mt-2 text-sm text-gray-600">
          You’ve been added to the project, but we couldn’t determine which project to open.
        </p>
        <div className="mt-4">
          <Link className="underline" href="/projects">
            Go to projects
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
          <Link className="underline" href="/projects">
            Go to projects
          </Link>
          <Link className="underline" href="/login">
            Login
          </Link>
        </div>

        <div className="mt-6 rounded-lg border p-3 text-xs text-gray-600">
          If this keeps happening, the invite may be expired, revoked, or already accepted.
        </div>
      </main>
    );
  }
}
