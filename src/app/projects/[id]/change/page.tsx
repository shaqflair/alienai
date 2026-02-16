// src/app/projects/[id]/change/page.tsx
import "server-only";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";

/* -------------------------------------------
   small helper
------------------------------------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

/* -------------------------------------------
   page
------------------------------------------- */

export default async function ChangeLogPage({
  params,
}: {
  // ✅ Next.js can pass params as a Promise in some setups — handle both safely
  params: { id?: string } | Promise<{ id?: string }>;
}) {
  const p =
    typeof (params as any)?.then === "function"
      ? await (params as any)
      : (params as any);

  const projectId = safeStr(p?.id).trim();

  /* -------------------------------------------
     project "human id" (for UI chip only)
  ------------------------------------------- */

  let projectCode: string | null = null;

  try {
    const supabase = await createClient();

    const { data: proj, error } = await supabase
      .from("projects")
      .select("id, code, public_id, external_id, project_code, project_number, project_no")
      .eq("id", projectId)
      .maybeSingle();

    if (!error && proj) {
      const toText = (v: any) => {
        if (v == null) return "";
        if (typeof v === "string") return v;
        if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
        if (typeof v === "bigint") return String(v);
        try {
          return String(v);
        } catch {
          return "";
        }
      };

      const candidates = [
        toText((proj as any).project_number),
        toText((proj as any).project_no),
        toText((proj as any).external_id),
        toText((proj as any).public_id),
        toText((proj as any).code),
        toText((proj as any).project_code),
      ]
        .map((s) => s.trim())
        .filter(Boolean);

      projectCode = candidates.length ? candidates[0] : null;
    }
  } catch {
    // ignore – UI chip just won’t show
  }

  /* -------------------------------------------
     locate Change Requests artifact for compare
  ------------------------------------------- */

  let compareHref: string | null = null;

  try {
    const supabase = await createClient();

    const { data: crArtifact, error } = await supabase
      .from("artifacts")
      .select("id, type, updated_at")
      .eq("project_id", projectId)
      .in("type", [
        "change_requests",
        "change requests",
        "change_request",
        "change request",
        "change_log",
        "change log",
        "kanban",
      ])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && crArtifact?.id) {
      compareHref = `/projects/${projectId}/artifacts/${crArtifact.id}/compare`;
    }
  } catch {
    // optional feature – safe to ignore
  }

  /* -------------------------------------------
     render
  ------------------------------------------- */

  return (
    <main className="crPage">
      <ChangeHeader
        title="Change Control"
        subtitle="Fast scanning for busy PMs"
        rightSlot={
          <div
            style={{
              display: "inline-flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {projectCode && (
              <span
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm"
                title="Project ID"
                style={{ fontWeight: 800 }}
              >
                {`PRJ-${projectCode}`}
              </span>
            )}

            {compareHref && (
              <Link
                href={compareHref}
                className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
                title="Compare versions of the Change Requests artifact"
              >
                Compare versions
              </Link>
            )}
          </div>
        }
      />

      {/* ✅ REAL FIX — route param passed directly */}
      <ChangeManagementBoard projectId={projectId} />
    </main>
  );
}
