// src/app/security/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security | Aliena AI",
  description: "Aliena AI security practices, responsible disclosure policy, and compliance roadmap.",
};

export default function SecurityPage() {
  const C = {
    cyan:    "#00B8DB",
    cyanLt:  "#4DE3FF",
    green:   "#22C55E",
    amber:   "#EAB308",
    blue:    "#0891b2",
    text:    "#F2F5FA",
    muted:   "#99A6B7",
    muted2:  "#5A6475",
    line:    "rgba(255,255,255,0.07)",
    glass:   "rgba(8,12,20,0.72)",
  };

  const dp = "'Space Grotesk', sans-serif";
  const mn = "'IBM Plex Mono', monospace";
  const bd = "'Inter', system-ui, sans-serif";

  const card = {
    padding: "20px 22px",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 16,
    background: "rgba(255,255,255,0.03)",
    backdropFilter: "blur(12px)",
  } as React.CSSProperties;

  const dataProtection = [
    { title: "Encryption at rest",    body: "All data stored in Supabase (PostgreSQL) is encrypted at rest using AES-256. Backups are encrypted with the same standard." },
    { title: "Encryption in transit", body: "All connections use TLS 1.2 or higher. We enforce HTTPS across all endpoints with HSTS headers." },
    { title: "Row-Level Security",    body: "Every database table uses Supabase Row-Level Security (RLS) policies. Users can only access data belonging to their organisation -- enforced at the database level, not just the application layer." },
    { title: "Data isolation",        body: "Each organisation's data is logically isolated by organisation_id on every table. Cross-organisation data access is structurally impossible through normal query paths." },
  ];

  const infrastructure = [
    { title: "Hosting",          body: "Aliena AI runs on Vercel (edge network, 99.99% SLA) with database hosted on Supabase (built on AWS). Both are SOC 2 Type II certified." },
    { title: "Secret management", body: "API keys and secrets are stored as encrypted environment variables in Vercel. Service role keys are never exposed client-side. Secrets are rotated quarterly." },
    { title: "Authentication",   body: "Authentication is handled by Supabase Auth (built on GoTrue). We support email/password with secure password hashing (bcrypt). Session tokens are short-lived JWTs verified server-side on every request." },
    { title: "Audit logging",    body: "All approval decisions, document changes, and resource allocation changes are logged to immutable audit tables with actor, timestamp, and before/after values." },
  ];

  const accessControls = [
    { title: "Principle of least privilege", body: "Every API route authenticates the requesting user and verifies organisation membership before returning data. Admin operations require elevated role checks." },
    { title: "No shared credentials",        body: "Each user has their own account. There are no shared login credentials. Team members are invited via email and must verify their identity." },
    { title: "MFA for admin access",         body: "All Aliena AI team members with production database access are required to use multi-factor authentication." },
    { title: "Approval workflows",           body: "Sensitive operations (document approval, budget sign-off) require multi-step approval chains with full audit trails." },
  ];

  const compliance = [
    { label: "ISO 27001",    status: "In progress", statusColor: "#EAB308", borderColor: "rgba(234,179,8,0.2)",    bgColor: "rgba(234,179,8,0.06)",    body: "We are working towards ISO 27001 certification. Our ISMS documentation and risk register are in development." },
    { label: "SOC 2 Type II",status: "Planned",     statusColor: "#00B8DB", borderColor: "rgba(0,184,219,0.2)",    bgColor: "rgba(0,184,219,0.06)",    body: "SOC 2 Type II audit is planned for 2026. We are implementing the required controls across security, availability, and confidentiality trust service criteria." },
    { label: "UK GDPR",      status: "Compliant",   statusColor: "#22C55E", borderColor: "rgba(34,197,94,0.2)",    bgColor: "rgba(34,197,94,0.06)",    body: "Aliena AI is operated from the UK and complies with UK GDPR. We act as a data processor for your organisation's project data. See our Privacy Policy for full details." },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #05070A; color: #F2F5FA; font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        a { color: inherit; text-decoration: none; }
        .sec-card { transition: border-color 0.2s, transform 0.2s; }
        .sec-card:hover { border-color: rgba(0,184,219,0.2) !important; transform: translateY(-2px); }
      `}</style>

      <main style={{ minHeight: "100vh", background: "linear-gradient(180deg, #03050A 0%, #060C14 50%, #04080F 100%)", position: "relative", overflow: "hidden" }}>

        {/* Background glow */}
        <div aria-hidden style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: 900, height: 500, background: "radial-gradient(ellipse, rgba(0,184,219,0.05) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

        <div style={{ maxWidth: 900, margin: "0 auto", padding: "80px 28px 80px", position: "relative", zIndex: 1 }}>

          {/* Back link */}
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.muted, fontFamily: bd, marginBottom: 40, transition: "color 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.color = C.text)}
            onMouseLeave={e => (e.currentTarget.style.color = C.muted)}>
            <span style={{ fontSize: 16 }}>&larr;</span> Back to Aliena AI
          </a>

          {/* Header */}
          <div style={{ marginBottom: 64 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 999, fontSize: 12, fontWeight: 600, color: C.green, fontFamily: mn, letterSpacing: "0.06em", marginBottom: 20 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, display: "inline-block", boxShadow: "0 0 8px #22C55E" }} />
              ALL SYSTEMS OPERATIONAL
            </div>
            <h1 style={{ fontFamily: dp, fontSize: "clamp(36px, 5vw, 58px)", fontWeight: 700, lineHeight: 1.0, letterSpacing: "-0.04em", marginBottom: 18 }}>
              Security at{" "}
              <span style={{ background: "linear-gradient(135deg, #00B8DB 0%, #4DE3FF 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                Aliena AI
              </span>
            </h1>
            <p style={{ fontSize: 18, color: C.muted, lineHeight: 1.75, maxWidth: 640 }}>
              We build Aliena AI with security as a first principle. Your project data, financial plans, and team information are protected at every layer of our stack.
            </p>
          </div>

          {/* Quick stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 64 }}>
            {[
              { val: "AES-256",    label: "Encryption standard" },
              { val: "TLS 1.2+",  label: "In-transit security" },
              { val: "Row-Level", label: "Database security" },
            ].map(s => (
              <div key={s.val} style={{ ...card, textAlign: "center", padding: "22px 16px" }}>
                <div style={{ fontFamily: dp, fontSize: 22, fontWeight: 700, color: C.cyanLt, marginBottom: 6 }}>{s.val}</div>
                <div style={{ fontSize: 12, color: C.muted, fontFamily: mn, letterSpacing: "0.04em" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Section: Data Protection */}
          <section style={{ marginBottom: 56 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontFamily: mn, fontSize: 10, color: C.cyanLt, letterSpacing: "0.14em", textTransform: "uppercase" }}>01</span>
              <h2 style={{ fontFamily: dp, fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em" }}>Data Protection</h2>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {dataProtection.map(item => (
                <div key={item.title} className="sec-card" style={{ ...card }}>
                  <div style={{ fontFamily: dp, fontWeight: 600, fontSize: 15, marginBottom: 7, color: C.text }}>{item.title}</div>
                  <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7 }}>{item.body}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Infrastructure */}
          <section style={{ marginBottom: 56 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontFamily: mn, fontSize: 10, color: C.cyanLt, letterSpacing: "0.14em", textTransform: "uppercase" }}>02</span>
              <h2 style={{ fontFamily: dp, fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em" }}>Infrastructure</h2>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {infrastructure.map(item => (
                <div key={item.title} className="sec-card" style={{ ...card }}>
                  <div style={{ fontFamily: dp, fontWeight: 600, fontSize: 15, marginBottom: 7, color: C.text }}>{item.title}</div>
                  <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7 }}>{item.body}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Compliance */}
          <section style={{ marginBottom: 56 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontFamily: mn, fontSize: 10, color: C.cyanLt, letterSpacing: "0.14em", textTransform: "uppercase" }}>03</span>
              <h2 style={{ fontFamily: dp, fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em" }}>Compliance Roadmap</h2>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {compliance.map(item => (
                <div key={item.label} className="sec-card" style={{ ...card, background: item.bgColor, border: `1px solid ${item.borderColor}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                    <span style={{ fontFamily: dp, fontWeight: 700, fontSize: 15 }}>{item.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: item.bgColor, color: item.statusColor, border: `1px solid ${item.borderColor}`, fontFamily: mn, letterSpacing: "0.06em", textTransform: "uppercase" }}>{item.status}</span>
                  </div>
                  <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7 }}>{item.body}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Responsible Disclosure */}
          <section id="responsible-disclosure" style={{ marginBottom: 56 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontFamily: mn, fontSize: 10, color: C.cyanLt, letterSpacing: "0.14em", textTransform: "uppercase" }}>04</span>
              <h2 style={{ fontFamily: dp, fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em" }}>Responsible Disclosure</h2>
            </div>
            <div style={{ padding: "28px 28px", background: "rgba(0,184,219,0.06)", border: "1px solid rgba(0,184,219,0.18)", borderRadius: 20, backdropFilter: "blur(12px)" }}>
              <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.75, marginBottom: 22 }}>
                If you discover a security vulnerability in Aliena AI, we ask that you report it to us responsibly.
                Please do not exploit vulnerabilities or access data that does not belong to you.
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                {[
                  { label: "Report to",        val: <a href="mailto:security@aliena.co.uk" style={{ color: C.cyanLt, textDecoration: "underline", textDecorationColor: "rgba(0,184,219,0.3)" }}>security@aliena.co.uk</a> },
                  { label: "Response time",    val: "We aim to acknowledge all reports within 48 hours." },
                  { label: "What to include",  val: "Description of the issue, steps to reproduce, and potential impact." },
                  { label: "Our commitment",   val: "Investigating all reports promptly, keeping you informed, and not taking legal action against good-faith researchers." },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", gap: 14, fontSize: 14, lineHeight: 1.6 }}>
                    <span style={{ color: C.text, fontWeight: 600, fontFamily: dp, minWidth: 130, flexShrink: 0 }}>{row.label}</span>
                    <span style={{ color: C.muted }}>{row.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Section: Access Controls */}
          <section style={{ marginBottom: 56 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontFamily: mn, fontSize: 10, color: C.cyanLt, letterSpacing: "0.14em", textTransform: "uppercase" }}>05</span>
              <h2 style={{ fontFamily: dp, fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em" }}>Access Controls</h2>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {accessControls.map(item => (
                <div key={item.title} className="sec-card" style={{ ...card }}>
                  <div style={{ fontFamily: dp, fontWeight: 600, fontSize: 15, marginBottom: 7, color: C.text }}>{item.title}</div>
                  <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7 }}>{item.body}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Footer */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 28, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
            <span style={{ fontSize: 13, color: C.muted2, fontFamily: mn }}>Last updated: March 2026</span>
            <div style={{ display: "flex", gap: 20 }}>
              <a href="/privacy" style={{ fontSize: 13, color: C.muted, transition: "color 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.color = C.text)}
                onMouseLeave={e => (e.currentTarget.style.color = C.muted)}>Privacy Policy</a>
              <a href="mailto:security@aliena.co.uk" style={{ fontSize: 13, color: C.cyanLt }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>Contact Security Team</a>
            </div>
          </div>

        </div>
      </main>
    </>
  );
}