// src/app/change/page.tsx
import "server-only";

import dynamic from "next/dynamic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Use the legacy wrapper that forces ChangeManagementBoard (old template)
const ChangeClientPage = dynamic(() => import("../(app)/change/ChangeClientPage"), {
  ssr: false,
});

export default function ChangePage() {
  return <ChangeClientPage />;
}
