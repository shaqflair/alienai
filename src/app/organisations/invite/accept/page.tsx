"use client";

import { useEffect } from "react";

/**
 * OrgInviteAcceptPage
 * Handles Supabase auth invite landing page - whitelisted under organisations/invite/*
 * Forwards the hash token to /auth/reset without any server redirect.
 */
export default function OrgInviteAcceptPage() {
  useEffect(() => {
    // Supabase sends token in the URL fragment (hash) which the server cannot read.
    const hash = window.location.hash;
    
    if (hash && hash.includes("access_token")) {
      // Forward the full hash to the reset handler to establish the session.
      window.location.replace("/auth/reset" + hash);
    } else {
      // No token found - likely an expired link or manual navigation.
      window.location.replace("/forgot-password");
    }
  }, []);

  return (
    <div style={{
      minHeight: "100vh", 
      display: "flex", 
      alignItems: "center",
      justifyContent: "center", 
      background: "#000810",
      fontFamily: "'Share Tech Mono', monospace",
      color: "rgba(135,230,255,0.8)", 
      fontSize: 13, 
      letterSpacing: "0.1em",
      textTransform: "uppercase"
    }}>
      Authenticating Invite Token...
    </div>
  );
}
