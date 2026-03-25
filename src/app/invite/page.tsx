"use client";

import { useEffect } from "react";

/**
 * InviteLandingPage
 * Handles Supabase invite hash tokens (e.g., /invite#access_token=...)
 * and redirects to the /auth/reset handler.
 */
export default function InviteLandingPage() {
  useEffect(() => {
    // Supabase sends tokens in the hash: /invite#access_token=...&type=invite
    // The server cannot see the hash, so we capture it here and forward to /auth/reset
    const hash = window.location.hash;
    
    if (hash && hash.includes("access_token")) {
      // Forward hash to reset handler which processes the session
      window.location.replace("/auth/reset" + hash);
    } else {
      // If no token is present, the link is likely expired or invalid
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
