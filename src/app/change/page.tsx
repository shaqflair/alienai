// src/app/change/page.tsx
"use client";

import React from "react";
import dynamic from "next/dynamic";

// Use the legacy wrapper that forces ChangeManagementBoard (old template)
const ChangeClientPage = dynamic(
  () => import("../(app)/change/ChangeClientPage"),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-sm text-gray-500">Loading change workspace…</div>
    ),
  }
);

export default function ChangePage() {
  return <ChangeClientPage />;
}
