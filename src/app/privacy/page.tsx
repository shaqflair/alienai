// src/app/privacy/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Aliena AI",
  description: "Aliena AI privacy policy -- how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
  const C = {
    cyan:   "#00B8DB",
    cyanLt: "#4DE3FF",
    text:   "#F2F5FA",
    muted:  "#99A6B7",
    muted2: "#5A6475",
  };

  const dp = "'Space Grotesk', sans-serif";
  const mn = "'IBM Plex Mono', monospace";

  const sections = [
    { title: "1. Who we are", body: `Aliena AI is a project management and resource planning platform operated from the United Kingdom. For the purposes of UK GDPR, Aliena AI acts as a data processor for your organisation's project data, and as a data controller for account and usage data.\n\nContact: privacy@aliena.co.uk` },
    { title: "2. What data we collect", body: `We collect:\n- Account information: name, email address, job title, organisation\n- Project data: project details, documents, financial plans, schedules, RAID logs you create in the platform\n- Usage data: feature usage, page views, session duration (anonymised)\n- Communication data: emails we send you (approval notifications, invites)\n\nWe do not collect payment card data directly -- payments are handled by Stripe (PCI DSS compliant).` },
    { title: "3. How we use your data", body: `We use your data to:\n- Provide and operate the Aliena AI platform\n- Send approval notifications and system alerts\n- Improve the product through anonymised usage analytics\n- Comply with legal obligations\n\nWe do not sell your data to third parties. We do not use your project data to train AI models without explicit consent.` },
    { title: "4. Data sharing", body: `We share data with the following sub-processors:\n- Supabase (database hosting) -- EU/US, SOC 2 Type II certified\n- Vercel (application hosting) -- US, SOC 2 Type II certified\n- OpenAI (AI features) -- US, your data is not used to train models under our enterprise agreement\n- Resend (email delivery) -- US\n- Stripe (payments) -- US, PCI DSS compliant\n\nAll sub-processors are subject to data processing agreements.` },
    { title: "5. Data retention", body: `We retain your data for as long as your account is active. On account deletion:\n- Project data is deleted within 30 days\n- Audit logs are retained for 12 months for compliance purposes\n- Backup data is purged within 90 days\n\nYou can request immediate deletion by contacting privacy@aliena.co.uk.` },
    { title: "6. Your rights (UK GDPR)", body: `You have the right to:\n- Access: request a copy of your personal data\n- Rectification: correct inaccurate data\n- Erasure: request deletion of your data\n- Portability: receive your data in a machine-readable format\n- Restriction: limit how we process your data\n- Objection: object to processing based on legitimate interests\n\nTo exercise any of these rights, contact privacy@aliena.co.uk. We will respond within 30 days.` },
    { title: "7. Cookies", body: `We use only essential cookies required for authentication and session management. We do not use advertising cookies or tracking pixels.\n\nSession cookies expire when you close your browser. Authentication tokens expire after 7 days of inactivity.` },
    { title: "8. Security", body: `We implement appropriate technical and organisational measures to protect your data, including encryption at rest (AES-256), encryption in transit (TLS 1.2+), and database-level Row-Level Security policies. See our Security page for full details.` },
    { title: "9. International transfers", body: `Some of our sub-processors (Vercel, OpenAI, Resend, Stripe) are based in the United States. Transfers are made under appropriate safeguards including Standard Contractual Clauses (SCCs) as approved by the UK ICO.` },
    { title: "10. Changes to this policy", body: `We will notify you by email and in-app notification if we make material changes to this policy. Continued use of Aliena AI after notification constitutes acceptance of the updated policy.` },
    { title: "11. Contact", body: `Data Controller: Aliena AI\nEmail: privacy@aliena.co.uk\nSecurity issues: security@aliena.co.uk\n\nIf you are not satisfied with our response, you have the right to lodge a complaint with the UK Information Commissioner's Office (ICO) at ico.org.uk.` },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #05070A; color: #F2F5FA; font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        a { color: inherit; text-decoration: none; }
      `}</style>

      <main style={{ minHeight: "100vh", background: "linear-gradient(180deg, #03050A 0%, #060C14 50%, #04080F 100%)", position: "relative", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: 900, height: 500, background: "radial-gradient(ellipse, rgba(0,184,219,0.04) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

        <div style={{ maxWidth: 820, margin: "0 auto", padding: "80px 28px 80px", position: "relative", zIndex: 1 }}>

          {/* Back */}
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.muted, marginBottom: 40, transition: "color 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.color = C.text)}
            onMouseLeave={e => (e.currentTarget.style.color = C.muted)}>
            <span style={{ fontSize: 16 }}>&larr;</span> Back to Aliena AI
          </a>

          {/* Header */}
          <div style={{ marginBottom: 56 }}>
            <div style={{ fontFamily: mn, fontSize: 10, color: C.cyanLt, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14 }}>Legal</div>
            <h1 style={{ fontFamily: dp, fontSize: "clamp(36px, 5vw, 54px)", fontWeight: 700, lineHeight: 1.0, letterSpacing: "-0.04em", marginBottom: 14 }}>Privacy Policy</h1>
            <p style={{ fontSize: 13, color: C.muted2, fontFamily: mn }}>Last updated: March 2026 &nbsp;|&nbsp; Effective: March 2026</p>
          </div>

          {/* Sections */}
          <div style={{ display: "grid", gap: 0 }}>
            {sections.map((s, i) => (
              <section key={s.title} style={{ paddingBottom: 36, marginBottom: 36, borderBottom: i < sections.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                <h2 style={{ fontFamily: dp, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 12, color: C.text }}>{s.title}</h2>
                <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.85, whiteSpace: "pre-line" }}>{s.body}</div>
              </section>
            ))}
          </div>

          {/* Footer */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 28, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
            <span style={{ fontSize: 13, color: C.muted2, fontFamily: mn }}>Aliena AI -- privacy@aliena.co.uk</span>
            <a href="/security" style={{ fontSize: 13, color: C.cyanLt }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>Security Policy &rarr;</a>
          </div>

        </div>
      </main>
    </>
  );
}