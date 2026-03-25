"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function OrgInviteAcceptPage() {
  const sp = useSearchParams();

  useEffect(() => {
    const hash = window.location.hash;
    const next = sp.get("next");
    const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

    if (hash && hash.includes("access_token")) {
      window.location.replace(`/auth/reset${nextQuery}${hash}`);
      return;
    }

    // No hash: do nothing destructive.
    // Let the user recover manually or show a nicer expired-link screen later.
  }, [sp]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000810",
        fontFamily: "'Share Tech Mono', monospace",
        color: "rgba(135,230,255,0.8)",
        fontSize: 13,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      Authenticating Invite Token...
    </div>
  );
}