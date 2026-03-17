
// src/app/security/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security | Aliena AI",
  description: "Aliena AI security practices, responsible disclosure policy, and compliance roadmap.",
};

export default function SecurityPage() {
  const C = {
    cyan:    "#00C2E8",
    cyanLt:  "#57E7FF",
    green:   "#22C55E",
    amber:   "#EAB308",
    text:    "#F5F8FC",
    muted:   "#A0ACBC",
    muted2:  "#667184",
    line:    "rgba(255,255,255,0.07)",
  };
  const dp = "'Plus Jakarta Sans', sans-serif";
  const mn = "'Fira Code', monospace";

  const card = {
    padding: "20px 22px",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 16,
    background: "rgba(255,255,255,0.03)",
  } as React.CSSProperties;

  const dataProtection = [
    { title: "Encryption at rest",    body: "All data stored in Supabase (PostgreSQL) is encrypted at rest using AES-256. Backups are encrypted with the same standard." },
    { title: "Encryption in transit", body: "All connections use TLS 1.2 or higher. We enforce HTTPS across all endpoints with HSTS headers." },
    { title: "Row-Level Security",    body: "Every database table uses Supabase Row-Level Security (RLS) policies. Users can only access data belonging to their organisation -- enforced at the database level, not just the application layer." },
    { title: "Data isolation",        body: "Each organisation's data is logically isolated by organisation_id on every table. Cross-organisation data access is structurally impossible through normal query paths." },
  ];
  const infrastructure = [
    { title: "Hosting",           body: "Aliena AI runs on Vercel (edge network, 99.99% SLA) with database hosted on Supabase (built on AWS). Both are SOC 2 Type II certified." },
    { title: "Secret management", body: "API keys and secrets are stored as encrypted environment variables in Vercel. Service role keys are never exposed client-side. Secrets are rotated quarterly." },
    { title: "Authentication",    body: "Authentication is handled by Supabase Auth (built on GoTrue). We support email/password with secure password hashing (bcrypt). Session tokens are short-lived JWTs verified server-side on every request." },
    { title: "Audit logging",     body: "All approval decisions, document changes, and resource allocation changes are logged to immutable audit tables with actor, timestamp, and before/after values." },
  ];
  const accessControls = [
    { title: "Principle of least privilege", body: "Every API route authenticates the requesting user and verifies organisation membership before returning data. Admin operations require elevated role checks." },
    { title: "No shared credentials",        body: "Each user has their own account. There are no shared login credentials. Team members are invited via email and must verify their identity." },
    { title: "MFA for admin access",         body: "All Aliena AI team members with production database access are required to use multi-factor authentication." },
    { title: "Approval workflows",           body: "Sensitive operations (document approval, budget sign-off) require multi-step approval chains with full audit trails." },
  ];
  const compliance = [
    { label: "ISO 27001",    status: "In progress", sc: C.amber,  bc: "rgba(234,179,8,0.2)",  bg: "rgba(234,179,8,0.06)",  body: "We are working towards ISO 27001 certification. Our ISMS documentation and risk register are in development." },
    { label: "SOC 2 Type II",status: "Planned",     sc: C.cyan,   bc: "rgba(0,194,232,0.2)",  bg: "rgba(0,194,232,0.06)",  body: "SOC 2 Type II audit is planned for 2026. We are implementing the required controls across security, availability, and confidentiality trust service criteria." },
    { label: "UK GDPR",      status: "Compliant",   sc: C.green,  bc: "rgba(34,197,94,0.2)",  bg: "rgba(34,197,94,0.06)",  body: "Aliena AI is operated from the UK and complies with UK GDPR. We act as a data processor for your organisation's project data." },
  ];

  return (
    <main style={{ minHeight:"100vh", background:"linear-gradient(180deg,#03050A 0%,#060C14 50%,#04080F 100%)", color:C.text, fontFamily:"'Inter',system-ui,sans-serif", WebkitFontSmoothing:"antialiased" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Fira+Code:wght@400;500&family=Inter:wght@400;500;600;700&display=swap'); *,*::before,*::after{box-sizing:border-box;margin:0;padding:0} a{color:inherit;text-decoration:none} .sec-card{transition:border-color .2s,transform .2s} .sec-card:hover{border-color:rgba(0,194,232,0.2)!important;transform:translateY(-2px)}`}</style>

      <div aria-hidden style={{ position:"fixed", top:0, left:"50%", transform:"translateX(-50%)", width:900, height:500, background:"radial-gradient(ellipse,rgba(0,194,232,0.05) 0%,transparent 70%)", pointerEvents:"none", zIndex:0 }} />

      <div style={{ maxWidth:900, margin:"0 auto", padding:"80px 28px 80px", position:"relative", zIndex:1 }}>

        <a href="/" style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:13, color:C.muted, marginBottom:40, transition:"color 0.2s" }}
          onMouseEnter={e=>(e.currentTarget.style.color=C.text)} onMouseLeave={e=>(e.currentTarget.style.color=C.muted)}>
          &larr; Back to Aliena AI
        </a>

        <div style={{ marginBottom:64 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"6px 14px", background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.2)", borderRadius:999, fontSize:12, fontWeight:600, color:C.green, fontFamily:mn, letterSpacing:"0.06em", marginBottom:20 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:C.green, display:"inline-block", boxShadow:"0 0 8px #22C55E" }} />
            ALL SYSTEMS OPERATIONAL
          </div>
          <h1 style={{ fontFamily:dp, fontSize:"clamp(36px,5vw,58px)", fontWeight:700, lineHeight:1.0, letterSpacing:"-0.04em", marginBottom:18 }}>
            Security at{" "}
            <span style={{ background:"linear-gradient(135deg,#00C2E8 0%,#57E7FF 100%)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>Aliena AI</span>
          </h1>
          <p style={{ fontSize:18, color:C.muted, lineHeight:1.75, maxWidth:640 }}>We build Aliena AI with security as a first principle. Your project data, financial plans, and team information are protected at every layer of our stack.</p>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:64 }}>
          {[{val:"AES-256",label:"Encryption standard"},{val:"TLS 1.2+",label:"In-transit security"},{val:"Row-Level",label:"Database security"}].map(s=>(
            <div key={s.val} style={{ ...card, textAlign:"center", padding:"22px 16px" }}>
              <div style={{ fontFamily:dp, fontSize:22, fontWeight:700, color:C.cyanLt, marginBottom:6 }}>{s.val}</div>
              <div style={{ fontSize:12, color:C.muted, fontFamily:mn, letterSpacing:"0.04em" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {[
          { num:"01", title:"Data Protection",    items:dataProtection },
          { num:"02", title:"Infrastructure",     items:infrastructure },
          { num:"04", title:"Access Controls",    items:accessControls },
        ].map(section=>(
          <section key={section.title} style={{ marginBottom:56 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
              <span style={{ fontFamily:mn, fontSize:10, color:C.cyanLt, letterSpacing:"0.14em", textTransform:"uppercase" }}>{section.num}</span>
              <h2 style={{ fontFamily:dp, fontSize:26, fontWeight:700, letterSpacing:"-0.03em" }}>{section.title}</h2>
            </div>
            <div style={{ display:"grid", gap:12 }}>
              {section.items.map(item=>(
                <div key={item.title} className="sec-card" style={{ ...card }}>
                  <div style={{ fontFamily:dp, fontWeight:600, fontSize:15, marginBottom:7, color:C.text }}>{item.title}</div>
                  <div style={{ fontSize:14, color:C.muted, lineHeight:1.7 }}>{item.body}</div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section style={{ marginBottom:56 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
            <span style={{ fontFamily:mn, fontSize:10, color:C.cyanLt, letterSpacing:"0.14em", textTransform:"uppercase" }}>03</span>
            <h2 style={{ fontFamily:dp, fontSize:26, fontWeight:700, letterSpacing:"-0.03em" }}>Compliance Roadmap</h2>
          </div>
          <div style={{ display:"grid", gap:12 }}>
            {compliance.map(item=>(
              <div key={item.label} className="sec-card" style={{ ...card, background:item.bg, border:`1px solid ${item.bc}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                  <span style={{ fontFamily:dp, fontWeight:700, fontSize:15 }}>{item.label}</span>
                  <span style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:999, background:item.bg, color:item.sc, border:`1px solid ${item.bc}`, fontFamily:mn, letterSpacing:"0.06em", textTransform:"uppercase" }}>{item.status}</span>
                </div>
                <div style={{ fontSize:14, color:C.muted, lineHeight:1.7 }}>{item.body}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="responsible-disclosure" style={{ marginBottom:56 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
            <span style={{ fontFamily:mn, fontSize:10, color:C.cyanLt, letterSpacing:"0.14em", textTransform:"uppercase" }}>05</span>
            <h2 style={{ fontFamily:dp, fontSize:26, fontWeight:700, letterSpacing:"-0.03em" }}>Responsible Disclosure</h2>
          </div>
          <div style={{ padding:"28px 28px", background:"rgba(0,194,232,0.06)", border:"1px solid rgba(0,194,232,0.18)", borderRadius:20, backdropFilter:"blur(12px)" }}>
            <p style={{ fontSize:15, color:C.muted, lineHeight:1.75, marginBottom:22 }}>If you discover a security vulnerability in Aliena AI, please report it to us responsibly. Do not exploit vulnerabilities or access data that does not belong to you.</p>
            <div style={{ display:"grid", gap:12 }}>
              {[
                { label:"Report to",       val:"security@aliena.co.uk", link:true },
                { label:"Response time",   val:"We aim to acknowledge all reports within 48 hours." },
                { label:"What to include", val:"Description of the issue, steps to reproduce, and potential impact." },
                { label:"Our commitment",  val:"Investigating all reports promptly, keeping you informed, and not taking legal action against good-faith researchers." },
              ].map(row=>(
                <div key={row.label} style={{ display:"flex", gap:14, fontSize:14, lineHeight:1.6 }}>
                  <span style={{ color:C.text, fontWeight:600, fontFamily:dp, minWidth:130, flexShrink:0 }}>{row.label}</span>
                  {row.link
                    ? <a href="mailto:security@aliena.co.uk" style={{ color:C.cyanLt, textDecoration:"underline", textDecorationColor:"rgba(0,194,232,0.3)" }}>{row.val}</a>
                    : <span style={{ color:C.muted }}>{row.val}</span>
                  }
                </div>
              ))}
            </div>
          </div>
        </section>

        <div style={{ borderTop:"1px solid rgba(255,255,255,0.07)", paddingTop:28, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:14 }}>
          <span style={{ fontSize:13, color:C.muted2, fontFamily:mn }}>Last updated: March 2026</span>
          <div style={{ display:"flex", gap:20 }}>
            <a href="/privacy" style={{ fontSize:13, color:C.muted, transition:"color 0.2s" }} onMouseEnter={e=>(e.currentTarget.style.color=C.text)} onMouseLeave={e=>(e.currentTarget.style.color=C.muted)}>Privacy Policy</a>
            <a href="mailto:security@aliena.co.uk" style={{ fontSize:13, color:C.cyanLt }}>Contact Security Team</a>
          </div>
        </div>

      </div>
    </main>
  );
}
