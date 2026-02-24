import "server-only";

import ExecutiveCockpitClient from "@/components/executive/ExecutiveCockpitClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ExecutivePage() {
  return <ExecutiveCockpitClient />;
}
