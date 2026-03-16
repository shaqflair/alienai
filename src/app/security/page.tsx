// src/app/security/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security | AlienAI",
  description: "AlienAI security practices, responsible disclosure policy, and compliance roadmap.",
};

export default function SecurityPage() {
  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "48px 24px", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#0f172a" }}>

      <div style={{ marginBottom: 48 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#059669", marginBottom: 16 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#059669", display: "inline-block" }} />
          All systems operational
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, margin: "0 0 12px" }}>Security at AlienAI</h1>
        <p style={{ fontSize: 16, color: "#475569", lineHeight: 1.7, margin: 0 }}>
          We build AlienAI with security as a first principle. Your project data, financial plans, and team information
          are protected at every layer of our stack.
        </p>
      </div>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Data Protection</h2>
        <div style={{ display: "grid", gap: 16 }}>
          {[
            { title: "Encryption at rest", body: "All data stored in Supabase (PostgreSQL) is encrypted at rest using AES-256. Backups are encrypted with the same standard." },
            { title: "Encryption in transit", body: "All connections use TLS 1.2 or higher. We enforce HTTPS across all endpoints with HSTS headers." },
            { title: "Row-Level Security", body: "Every database table uses Supabase Row-Level Security (RLS) policies. Users can only access data belonging to their organisation -- enforced at the database level, not just the application layer." },
            { title: "Data isolation", body: "Each organisation's data is logically isolated by organisation_id on every table. Cross-organisation data access is structurally impossible through normal query paths." },
          ].map(item => (
            <div key={item.title} style={{ padding: "16px 20px", border: "1px solid #e2e8f0", borderRadius: 10, background: "#f8fafc" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{item.title}</div>
              <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>{item.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Infrastructure</h2>
        <div style={{ display: "grid", gap: 16 }}>
          {[
            { title: "Hosting", body: "AlienAI runs on Vercel (edge network, 99.99% SLA) with database hosted on Supabase (built on AWS). Both are SOC 2 Type II certified." },
            { title: "Secret management", body: "API keys and secrets are stored as encrypted environment variables in Vercel. Service role keys are never exposed client-side. Secrets are rotated quarterly." },
            { title: "Authentication", body: "Authentication is handled by Supabase Auth (built on GoTrue). We support email/password with secure password hashing (bcrypt). Session tokens are short-lived JWTs verified server-side on every request." },
            { title: "Audit logging", body: "All approval decisions, document changes, and resource allocation changes are logged to immutable audit tables with actor, timestamp, and before/after values." },
          ].map(item => (
            <div key={item.title} style={{ padding: "16px 20px", border: "1px solid #e2e8f0", borderRadius: 10, background: "#f8fafc" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{item.title}</div>
              <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>{item.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Compliance Roadmap</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {[
            { label: "ISO 27001", status: "In progress", color: "#d97706", bg: "#fffbeb", border: "#fde68a", body: "We are working towards ISO 27001 certification. Our ISMS documentation and risk register are in development." },
            { label: "SOC 2 Type II", status: "Planned", color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc", body: "SOC 2 Type II audit is planned for 2026. We are implementing the required controls across security, availability, and confidentiality trust service criteria." },
            { label: "UK GDPR", status: "Compliant", color: "#059669", bg: "#f0fdf4", border: "#bbf7d0", body: "AlienAI is operated from the UK and complies with UK GDPR. We act as a data processor for your organisation's project data. See our Privacy Policy for full details." },
          ].map(item => (
            <div key={item.label} style={{ padding: "16px 20px", border: `1px solid ${item.border}`, borderRadius: 10, background: item.bg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{item.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: item.bg, color: item.color, border: `1px solid ${item.border}` }}>{item.status}</span>
              </div>
              <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>{item.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="responsible-disclosure" style={{ marginBottom: 40, padding: "24px", background: "#1e293b", borderRadius: 12, color: "white" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12, color: "white" }}>Responsible Disclosure</h2>
        <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7, marginBottom: 16 }}>
          If you discover a security vulnerability in AlienAI, we ask that you report it to us responsibly.
          Please do not exploit vulnerabilities or access data that does not belong to you.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 14, color: "#e2e8f0" }}>
            <strong style={{ color: "white" }}>Report to:</strong>{" "}
            <a href="mailto:security@aliena.co.uk" style={{ color: "#38bdf8" }}>security@aliena.co.uk</a>
          </div>
          <div style={{ fontSize: 14, color: "#e2e8f0" }}>
            <strong style={{ color: "white" }}>Response time:</strong> We aim to acknowledge all reports within 48 hours.
          </div>
          <div style={{ fontSize: 14, color: "#e2e8f0" }}>
            <strong style={{ color: "white" }}>What to include:</strong> Description of the issue, steps to reproduce, and potential impact.
          </div>
          <div style={{ fontSize: 14, color: "#e2e8f0" }}>
            <strong style={{ color: "white" }}>We commit to:</strong> Investigating all reports promptly, keeping you informed, and not taking legal action against good-faith researchers.
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Access Controls</h2>
        <div style={{ display: "grid", gap: 16 }}>
          {[
            { title: "Principle of least privilege", body: "Every API route authenticates the requesting user and verifies organisation membership before returning data. Admin operations require elevated role checks." },
            { title: "No shared credentials", body: "Each user has their own account. There are no shared login credentials. Team members are invited via email and must verify their identity." },
            { title: "MFA for admin access", body: "All AlienAI team members with production database access are required to use multi-factor authentication." },
            { title: "Approval workflows", body: "Sensitive operations (document approval, budget sign-off) require multi-step approval chains with full audit trails." },
          ].map(item => (
            <div key={item.title} style={{ padding: "16px 20px", border: "1px solid #e2e8f0", borderRadius: 10, background: "#f8fafc" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{item.title}</div>
              <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>{item.body}</div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>Last updated: March 2026</span>
        <div style={{ display: "flex", gap: 16 }}>
          <a href="/privacy" style={{ fontSize: 13, color: "#0891b2", textDecoration: "none" }}>Privacy Policy</a>
          <a href="mailto:security@aliena.co.uk" style={{ fontSize: 13, color: "#0891b2", textDecoration: "none" }}>Contact Security Team</a>
        </div>
      </div>
    </main>
  );
}