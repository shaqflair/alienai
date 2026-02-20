// src/app/change/page.tsx
"use client";

import React from "react";
import dynamic from "next/dynamic";

// Directly load the real board component from components/
// (no route-group relative imports)
const ChangeManagementBoard = dynamic(
  () => import("@/components/change/ChangeManagementBoard"),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-sm text-gray-500">
        Loading change workspace…
      </div>
    ),
  }
);

export default function ChangePage() {
  return <ChangeManagementBoard />;
}