// src/app/settings/doa/page.tsx
import "server-only";

import DoaRulesClient from "@/components/doa/DoaRulesClient";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

export default async function DoaSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const sp = await searchParams;
  const projectId = safeStr(sp?.projectId).trim();

  // If you prefer projectId from route (/projects/[id]/settings/doa), tell me and I’ll swap it.
  return (
    <main style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: "rgba(255,255,255,0.92)" }}>Delegation of Authority</h1>
        <div style={{ marginTop: 6, opacity: 0.75, color: "rgba(255,255,255,0.82)" }}>
          Define who can approve changes by spend band.
        </div>
      </div>

      {!projectId ? (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(18,18,26,0.6)",
            color: "rgba(255,255,255,0.86)",
          }}
        >
          Missing <b>projectId</b>. Open this page as: <code>?projectId=&lt;uuid&gt;</code>
        </div>
      ) : (
        <DoaRulesClient projectId={projectId} />
      )}
    </main>
  );
}
