// src/app/privacy/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | AlienAI",
  description: "AlienAI privacy policy -- how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "48px 24px", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#0f172a" }}>
      <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 40 }}>Last updated: March 2026 | Effective: March 2026</p>

      {[
        {
          title: "1. Who we are",
          body: `AlienAI is a project management and resource planning platform operated from the United Kingdom.
For the purposes of UK GDPR, AlienAI acts as a data processor for your organisation's project data,
and as a data controller for account and usage data.
Contact: privacy@aliena.co.uk`,
        },
        {
          title: "2. What data we collect",
          body: `We collect:
- Account information: name, email address, job title, organisation
- Project data: project details, documents, financial plans, schedules, RAID logs you create in the platform
- Usage data: feature usage, page views, session duration (anonymised)
- Communication data: emails we send you (approval notifications, invites)

We do not collect payment card data directly -- payments are handled by Stripe (PCI DSS compliant).`,
        },
        {
          title: "3. How we use your data",
          body: `We use your data to:
- Provide and operate the AlienAI platform
- Send approval notifications and system alerts
- Improve the product through anonymised usage analytics
- Comply with legal obligations

We do not sell your data to third parties. We do not use your project data to train AI models without explicit consent.`,
        },
        {
          title: "4. Data sharing",
          body: `We share data with the following sub-processors:
- Supabase (database hosting) -- EU/US, SOC 2 Type II certified
- Vercel (application hosting) -- US, SOC 2 Type II certified
- OpenAI (AI features) -- US, your data is not used to train models under our enterprise agreement
- Resend (email delivery) -- US
- Stripe (payments) -- US, PCI DSS compliant

All sub-processors are subject to data processing agreements.`,
        },
        {
          title: "5. Data retention",
          body: `We retain your data for as long as your account is active. On account deletion:
- Project data is deleted within 30 days
- Audit logs are retained for 12 months for compliance purposes
- Backup data is purged within 90 days

You can request immediate deletion by contacting privacy@aliena.co.uk.`,
        },
        {
          title: "6. Your rights (UK GDPR)",
          body: `You have the right to:
- Access: request a copy of your personal data
- Rectification: correct inaccurate data
- Erasure: request deletion of your data ("right to be forgotten")
- Portability: receive your data in a machine-readable format
- Restriction: limit how we process your data
- Objection: object to processing based on legitimate interests

To exercise any of these rights, contact privacy@aliena.co.uk. We will respond within 30 days.`,
        },
        {
          title: "7. Cookies",
          body: `We use only essential cookies required for authentication and session management.
We do not use advertising cookies or tracking pixels.
Session cookies expire when you close your browser. Authentication tokens expire after 7 days of inactivity.`,
        },
        {
          title: "8. Security",
          body: `We implement appropriate technical and organisational measures to protect your data,
including encryption at rest (AES-256), encryption in transit (TLS 1.2+), and database-level
Row-Level Security policies. See our Security page for full details.`,
        },
        {
          title: "9. International transfers",
          body: `Some of our sub-processors (Vercel, OpenAI, Resend, Stripe) are based in the United States.
Transfers are made under appropriate safeguards including Standard Contractual Clauses (SCCs)
as approved by the UK ICO.`,
        },
        {
          title: "10. Changes to this policy",
          body: `We will notify you by email and in-app notification if we make material changes to this policy.
Continued use of AlienAI after notification constitutes acceptance of the updated policy.`,
        },
        {
          title: "11. Contact",
          body: `Data Controller: AlienAI
Email: privacy@aliena.co.uk
Security issues: security@aliena.co.uk

If you are not satisfied with our response, you have the right to lodge a complaint with the
UK Information Commissioner's Office (ICO) at ico.org.uk.`,
        },
      ].map(section => (
        <section key={section.title} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "#1e293b" }}>{section.title}</h2>
          <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.8, whiteSpace: "pre-line" }}>{section.body}</div>
        </section>
      ))}

      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>AlienAI -- privacy@aliena.co.uk</span>
        <a href="/security" style={{ fontSize: 13, color: "#0891b2", textDecoration: "none" }}>Security Policy</a>
      </div>
    </main>
  );
}