// src/app/projects/[id]/change/layout.tsx
import "server-only";

import React from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ChangeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
