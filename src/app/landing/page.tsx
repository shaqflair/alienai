import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AlienAI -- AI-Powered Project Management for Modern PMOs",
  description: "Resource planning, financial oversight, approval workflows and AI intelligence -- built for NHS, corporate PMOs and enterprise delivery teams.",
};

export default function LandingPage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --black:   #08090A;
          --white:   #F7F6F2;
          --teal:    #00B8DB;
          --teal-dk: #0089A8;
          --amber:   #F59E0B;
          --green:   #10B981;
          --slate:   #94A3B8;
          --border:  rgba(255,255,255,0.08);
          --card-bg: rgba(255,255,255,0.03);
          --font-display: 'Syne', sans-serif;
          --font-body:    'DM Sans', sans-serif;
          --font-mono:    'DM Mono', monospace;
        }

        html { scroll-behavior: smooth; }

        body {
          background: var(--black);
          color: var(--white);
          font-family: var(--font-body);
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
        }

        /* NAV */
        .nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 48px;
          background: rgba(8,9,10,0.85);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border);
        }
        .nav-logo {
          font-family: var(--font-display);
          font-size: 20px; font-weight: 800;
          color: var(--white); text-decoration: none;
          display: flex; align-items: center; gap: 10px;
        }
        .nav-logo-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--teal);
          box-shadow: 0 0 12px var(--teal);
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(0.85); }
        }
        .nav-links { display: flex; align-items: center; gap: 32px; }
        .nav-link {
          font-size: 13px; font-weight: 500; color: var(--slate);
          text-decoration: none; transition: color 0.2s;
        }
        .nav-link:hover { color: var(--white); }
        .nav-cta {
          padding: 9px 22px; border-radius: 8px;
          background: var(--teal); color: var(--black);
          font-size: 13px; font-weight: 700;
          text-decoration: none; transition: all 0.2s;
          font-family: var(--font-display);
        }
        .nav-cta:hover { background: #00d4fa; transform: translateY(-1px); }

        /* HERO */
        .hero {
          min-height: 100vh;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 120px 24px 80px;
          position: relative; overflow: hidden;
          text-align: center;
        }
        .hero-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(0,184,219,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,184,219,0.04) 1px, transparent 1px);
          background-size: 64px 64px;
          mask-image: radial-gradient(ellipse 80% 60% at 50% 50%, black, transparent);
        }
        .hero-glow {
          position: absolute; top: 20%; left: 50%; transform: translateX(-50%);
          width: 600px; height: 400px;
          background: radial-gradient(ellipse, rgba(0,184,219,0.12) 0%, transparent 70%);
          pointer-events: none;
        }
        .hero-badge {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 6px 14px; border-radius: 20px;
          border: 1px solid rgba(0,184,219,0.3);
          background: rgba(0,184,219,0.08);
          font-size: 12px; font-weight: 600; color: var(--teal);
          font-family: var(--font-mono); letter-spacing: 0.04em;
          margin-bottom: 28px;
          animation: fadeUp 0.6s ease both;
        }
        .hero-title {
          font-family: var(--font-display);
          font-size: clamp(42px, 7vw, 80px);
          font-weight: 800; line-height: 1.05;
          letter-spacing: -0.03em;
          max-width: 900px;
          animation: fadeUp 0.6s ease 0.1s both;
        }
        .hero-title-accent { color: var(--teal); }
        .hero-sub {
          margin-top: 24px;
          font-size: clamp(16px, 2.5vw, 20px);
          color: var(--slate); line-height: 1.6;
          max-width: 580px; font-weight: 400;
          animation: fadeUp 0.6s ease 0.2s both;
        }
        .hero-actions {
          margin-top: 40px;
          display: flex; gap: 14px; justify-content: center; flex-wrap: wrap;
          animation: fadeUp 0.6s ease 0.3s both;
        }
        .btn-primary {
          padding: 14px 32px; border-radius: 10px;
          background: var(--teal); color: var(--black);
          font-size: 15px; font-weight: 700;
          text-decoration: none; transition: all 0.2s;
          font-family: var(--font-display);
          box-shadow: 0 0 30px rgba(0,184,219,0.25);
        }
        .btn-primary:hover { background: #00d4fa; transform: translateY(-2px); box-shadow: 0 0 40px rgba(0,184,219,0.4); }
        .btn-ghost {
          padding: 14px 32px; border-radius: 10px;
          border: 1px solid var(--border);
          background: transparent; color: var(--white);
          font-size: 15px; font-weight: 500;
          text-decoration: none; transition: all 0.2s;
        }
        .btn-ghost:hover { border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.04); }
        .hero-social-proof {
          margin-top: 56px;
          display: flex; align-items: center; gap: 20px;
          justify-content: center; flex-wrap: wrap;
          animation: fadeUp 0.6s ease 0.4s both;
        }
        .social-proof-text { font-size: 12px; color: var(--slate); }
        .social-proof-badges { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
        .sp-badge {
          padding: 4px 10px; border-radius: 6px;
          border: 1px solid var(--border);
          font-size: 11px; font-weight: 600; color: var(--slate);
          font-family: var(--font-mono);
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* PROBLEM STRIP */
        .problem-strip {
          padding: 32px 48px;
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          background: rgba(255,255,255,0.02);
          display: flex; align-items: center; justify-content: center;
          gap: 48px; flex-wrap: wrap;
        }
        .problem-item {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; color: var(--slate); font-weight: 500;
        }
        .problem-x { color: #EF4444; font-weight: 700; font-size: 16px; }

        /* SECTION */
        .section { padding: 100px 24px; max-width: 1200px; margin: 0 auto; }
        .section-label {
          font-family: var(--font-mono);
          font-size: 11px; font-weight: 600; color: var(--teal);
          letter-spacing: 0.12em; text-transform: uppercase;
          margin-bottom: 14px;
        }
        .section-title {
          font-family: var(--font-display);
          font-size: clamp(28px, 4vw, 44px);
          font-weight: 800; line-height: 1.1;
          letter-spacing: -0.02em;
          margin-bottom: 16px;
        }
        .section-sub {
          font-size: 16px; color: var(--slate); line-height: 1.7;
          max-width: 520px;
        }

        /* FEATURES GRID */
        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 2px;
          margin-top: 64px;
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
        }
        .feature-card {
          padding: 36px 32px;
          background: var(--card-bg);
          border: 1px solid var(--border);
          transition: background 0.2s;
          position: relative; overflow: hidden;
        }
        .feature-card::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, var(--teal), transparent);
          opacity: 0; transition: opacity 0.3s;
        }
        .feature-card:hover { background: rgba(0,184,219,0.04); }
        .feature-card:hover::before { opacity: 1; }
        .feature-icon {
          width: 44px; height: 44px; border-radius: 10px;
          background: rgba(0,184,219,0.1);
          border: 1px solid rgba(0,184,219,0.2);
          display: flex; align-items: center; justify-content: center;
          font-size: 20px; margin-bottom: 18px;
        }
        .feature-title {
          font-family: var(--font-display);
          font-size: 17px; font-weight: 700;
          margin-bottom: 10px; line-height: 1.3;
        }
        .feature-desc {
          font-size: 13px; color: var(--slate);
          line-height: 1.7;
        }
        .feature-tag {
          display: inline-block; margin-top: 14px;
          padding: 3px 8px; border-radius: 5px;
          background: rgba(0,184,219,0.1);
          font-size: 10px; font-weight: 700; color: var(--teal);
          font-family: var(--font-mono); letter-spacing: 0.06em;
        }

        /* WHO SECTION */
        .who-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 20px; margin-top: 56px;
        }
        .who-card {
          padding: 32px 28px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--card-bg);
          position: relative; overflow: hidden;
          transition: border-color 0.2s, transform 0.2s;
        }
        .who-card:hover { border-color: rgba(0,184,219,0.3); transform: translateY(-3px); }
        .who-card-accent {
          position: absolute; top: 0; left: 0; right: 0; height: 2px;
        }
        .who-org { font-size: 24px; margin-bottom: 12px; }
        .who-title {
          font-family: var(--font-display);
          font-size: 18px; font-weight: 700; margin-bottom: 10px;
        }
        .who-desc { font-size: 13px; color: var(--slate); line-height: 1.7; }
        .who-benefits { margin-top: 16px; display: flex; flex-direction: column; gap: 6px; }
        .who-benefit {
          display: flex; align-items: flex-start; gap: 8px;
          font-size: 12px; color: var(--slate);
        }
        .who-benefit-check { color: var(--green); font-weight: 700; flex-shrink: 0; margin-top: 1px; }

        /* PRICING */
        .pricing-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px; margin-top: 56px;
          align-items: start;
        }
        .pricing-card {
          padding: 36px 32px;
          border: 1px solid var(--border);
          border-radius: 16px;
          background: var(--card-bg);
          position: relative;
        }
        .pricing-card.featured {
          border-color: rgba(0,184,219,0.4);
          background: rgba(0,184,219,0.04);
        }
        .pricing-featured-badge {
          position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
          padding: 4px 14px; border-radius: 20px;
          background: var(--teal); color: var(--black);
          font-size: 11px; font-weight: 800;
          font-family: var(--font-mono); white-space: nowrap;
        }
        .pricing-tier {
          font-family: var(--font-mono);
          font-size: 11px; font-weight: 700; color: var(--slate);
          letter-spacing: 0.1em; text-transform: uppercase;
          margin-bottom: 8px;
        }
        .pricing-price {
          font-family: var(--font-display);
          font-size: 40px; font-weight: 800;
          line-height: 1; margin-bottom: 4px;
        }
        .pricing-price span { font-size: 16px; font-weight: 500; color: var(--slate); }
        .pricing-min {
          font-size: 12px; color: var(--slate); margin-bottom: 24px;
        }
        .pricing-divider {
          border: none; border-top: 1px solid var(--border);
          margin: 24px 0;
        }
        .pricing-features { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
        .pricing-feature {
          display: flex; align-items: flex-start; gap: 10px;
          font-size: 13px; color: var(--slate); line-height: 1.4;
        }
        .pf-check { color: var(--green); font-weight: 700; flex-shrink: 0; }
        .pricing-cta {
          display: block; width: 100%; padding: 12px;
          border-radius: 9px; text-align: center;
          font-size: 14px; font-weight: 700;
          text-decoration: none; transition: all 0.2s;
          font-family: var(--font-display);
        }
        .pricing-cta.primary {
          background: var(--teal); color: var(--black);
        }
        .pricing-cta.primary:hover { background: #00d4fa; }
        .pricing-cta.ghost {
          border: 1px solid var(--border); color: var(--white);
        }
        .pricing-cta.ghost:hover { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.04); }

        /* STATS */
        .stats-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1px; margin: 80px 0;
          border: 1px solid var(--border); border-radius: 16px; overflow: hidden;
        }
        .stat-item {
          padding: 40px 32px; text-align: center;
          background: var(--card-bg);
        }
        .stat-number {
          font-family: var(--font-display);
          font-size: 44px; font-weight: 800;
          color: var(--teal); line-height: 1;
          margin-bottom: 8px;
        }
        .stat-label { font-size: 13px; color: var(--slate); }

        /* CTA SECTION */
        .cta-section {
          padding: 100px 24px;
          text-align: center; position: relative; overflow: hidden;
        }
        .cta-glow {
          position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
          width: 800px; height: 400px;
          background: radial-gradient(ellipse, rgba(0,184,219,0.08) 0%, transparent 70%);
          pointer-events: none;
        }
        .cta-inner { max-width: 600px; margin: 0 auto; position: relative; }
        .cta-title {
          font-family: var(--font-display);
          font-size: clamp(32px, 5vw, 52px);
          font-weight: 800; line-height: 1.1;
          letter-spacing: -0.02em; margin-bottom: 20px;
        }
        .cta-sub { font-size: 16px; color: var(--slate); margin-bottom: 40px; line-height: 1.6; }
        .cta-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }

        /* FOOTER */
        .footer {
          padding: 48px;
          border-top: 1px solid var(--border);
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 20px;
        }
        .footer-logo {
          font-family: var(--font-display);
          font-size: 16px; font-weight: 800; color: var(--white);
          text-decoration: none;
        }
        .footer-links { display: flex; gap: 24px; flex-wrap: wrap; }
        .footer-link {
          font-size: 12px; color: var(--slate); text-decoration: none;
          transition: color 0.2s;
        }
        .footer-link:hover { color: var(--white); }
        .footer-copy { font-size: 12px; color: var(--slate); }

        /* RESPONSIVE */
        @media (max-width: 768px) {
          .nav { padding: 16px 20px; }
          .nav-links { display: none; }
          .problem-strip { gap: 20px; padding: 24px 20px; }
          .section { padding: 64px 20px; }
          .footer { padding: 32px 20px; flex-direction: column; gap: 16px; }
        }
      `}</style>

      {/* NAV */}
      <nav className="nav">
        <a href="/" className="nav-logo">
          <div className="nav-logo-dot" />
          AlienAI
        </a>
        <div className="nav-links">
          <a href="#features" className="nav-link">Features</a>
          <a href="#who" className="nav-link">Who it's for</a>
          <a href="#pricing" className="nav-link">Pricing</a>
          <a href="/login" className="nav-link">Sign in</a>
          <a href="/login" className="nav-cta">Request demo</a>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-grid" />
        <div className="hero-glow" />
        <div className="hero-badge">
          <span>AI-POWERED</span>
          <span style={{color: "rgba(255,255,255,0.3)"}}>|</span>
          <span>Built for Programme Managers</span>
        </div>
        <h1 className="hero-title">
          Project management<br />
          with an <span className="hero-title-accent">AI brain</span><br />
          built in
        </h1>
        <p className="hero-sub">
          Resource planning, financial oversight, RAID management and multi-step
          approval workflows -- with AI intelligence that flags risks before they become problems.
        </p>
        <div className="hero-actions">
          <a href="/login" className="btn-primary">Start free 90-day pilot</a>
          <a href="mailto:hello@aliena.co.uk" className="btn-ghost">Book a demo</a>
        </div>
        <div className="hero-social-proof">
          <span className="social-proof-text">Trusted infrastructure</span>
          <div className="social-proof-badges">
            <span className="sp-badge">SOC 2 infra</span>
            <span className="sp-badge">UK GDPR</span>
            <span className="sp-badge">ISO 27001 roadmap</span>
            <span className="sp-badge">RLS enforced</span>
          </div>
        </div>
      </section>

      {/* PROBLEM STRIP */}
      <div className="problem-strip">
        {[
          "Spreadsheet hell for resource planning",
          "Approvals lost in email chains",
          "No real-time budget visibility",
          "RAID logs nobody reads",
          "No audit trail for decisions",
        ].map(p => (
          <div key={p} className="problem-item">
            <span className="problem-x">x</span>
            <span>{p}</span>
          </div>
        ))}
      </div>

      {/* FEATURES */}
      <div id="features">
        <div className="section">
          <div className="section-label">Platform features</div>
          <h2 className="section-title">Everything a PMO needs.<br />Nothing it doesn't.</h2>
          <p className="section-sub">
            Built by programme managers, for programme managers.
            Every feature solves a real pain point.
          </p>
          <div className="features-grid">
            {[
              { icon: "R", title: "Resource Heatmap", desc: "Real-time capacity planning across your entire team. See who's available, who's over-allocated, and plan ahead with pipeline gap analysis.", tag: "Live capacity data" },
              { icon: "F", title: "Financial Planning", desc: "Monthly budget vs forecast vs actual. Automatic variance detection, quarter summaries, and AI-powered financial intelligence that flags overruns early.", tag: "AI-powered" },
              { icon: "A", title: "Approval Workflows", desc: "Multi-step approval chains for charters, financial plans, change requests. Full audit trail of who approved what and when -- critical for governance.", tag: "Full audit trail" },
              { icon: "R", title: "RAID Management", desc: "Risks, assumptions, issues and dependencies in one place. AI scoring, weekly snapshots, and executive digest reports that actually get read.", tag: "AI-scored" },
              { icon: "S", title: "Schedule & Milestones", desc: "Visual project timeline with milestone tracking. Overdue alerts, health scores, and portfolio-level milestone view across all your projects.", tag: "Portfolio view" },
              { icon: "AI", title: "AI Intelligence Layer", desc: "Built-in AI advisor across every module. Ask questions about your team's capacity, get risk signals before they escalate, and generate reports in seconds.", tag: "GPT-4o powered" },
            ].map(f => (
              <div key={f.title} className="feature-card">
                <div className="feature-icon">{f.icon}</div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
                <span className="feature-tag">{f.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* STATS */}
      <div style={{maxWidth: 1200, margin: "0 auto", padding: "0 24px"}}>
        <div className="stats-row">
          {[
            { n: "100+", l: "DB tables with RLS enforced" },
            { n: "6",    l: "Core PM modules" },
            { n: "48h",  l: "Security disclosure response" },
            { n: "99.9%", l: "Uptime SLA (Vercel + Supabase)" },
          ].map(s => (
            <div key={s.l} className="stat-item">
              <div className="stat-number">{s.n}</div>
              <div className="stat-label">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* WHO */}
      <div id="who">
        <div className="section">
          <div className="section-label">Who it's for</div>
          <h2 className="section-title">Built for serious<br />delivery organisations.</h2>
          <p className="section-sub">
            Whether you're running NHS programmes, corporate transformation,
            or agency delivery -- AlienAI scales with your complexity.
          </p>
          <div className="who-grid">
            {[
              {
                emoji: "NHS",
                title: "NHS & Public Sector",
                desc: "Governance-ready from day one. Approval workflows, full audit trails, and financial oversight built for public accountability requirements.",
                accent: "linear-gradient(90deg, #00B8DB, #0891B2)",
                benefits: ["Approval chains with audit trail", "Budget vs forecast tracking", "Resource capacity planning", "UK GDPR compliant"],
              },
              {
                emoji: "PMO",
                title: "Corporate PMOs",
                desc: "Portfolio-level visibility across all projects. Executive dashboards, resource heatmaps, and AI risk signals that keep leadership informed.",
                accent: "linear-gradient(90deg, #8B5CF6, #6D28D9)",
                benefits: ["Executive portfolio view", "Cross-project resource planning", "Financial intelligence AI", "Change request management"],
              },
              {
                emoji: "DEL",
                title: "Delivery Teams",
                desc: "From project kick-off to closure. Project charters, RAID logs, weekly reports, lessons learned -- every artefact in one place.",
                accent: "linear-gradient(90deg, #10B981, #059669)",
                benefits: ["Full artefact library", "RAID management with AI scoring", "Weekly report generation", "Lessons learned capture"],
              },
            ].map(w => (
              <div key={w.title} className="who-card">
                <div className="who-card-accent" style={{background: w.accent}} />
                <div className="who-org">{w.emoji}</div>
                <div className="who-title">{w.title}</div>
                <div className="who-desc">{w.desc}</div>
                <div className="who-benefits">
                  {w.benefits.map(b => (
                    <div key={b} className="who-benefit">
                      <span className="who-benefit-check">ok</span>
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div id="pricing">
        <div className="section">
          <div className="section-label">Simple pricing</div>
          <h2 className="section-title">Transparent pricing.<br />No surprises.</h2>
          <p className="section-sub">
            All plans include a 90-day free pilot for new organisations.
            Cancel anytime.
          </p>
          <div className="pricing-grid">
            {[
              {
                tier: "Starter",
                price: "29",
                min: "Minimum 5 users -- from GBP145/month",
                features: [
                  "Projects, artefacts & RAID",
                  "Schedule & milestone tracking",
                  "Resource heatmap (basic)",
                  "Approval workflows",
                  "Audit trail",
                  "Email notifications",
                ],
                cta: "Start free pilot",
                ctaStyle: "ghost",
                featured: false,
              },
              {
                tier: "Professional",
                price: "49",
                min: "Minimum 5 users -- from GBP245/month",
                features: [
                  "Everything in Starter",
                  "AI intelligence layer (GPT-4o)",
                  "Financial planning & forecasting",
                  "Executive portfolio dashboard",
                  "RAID AI scoring & digest",
                  "Change request management",
                  "Rate cards & timesheets",
                ],
                cta: "Start free pilot",
                ctaStyle: "primary",
                featured: true,
                badge: "Most popular",
              },
              {
                tier: "Enterprise",
                price: "79",
                min: "Minimum 10 users -- from GBP790/month",
                features: [
                  "Everything in Professional",
                  "SSO / SAML (coming soon)",
                  "Dedicated onboarding support",
                  "SLA guarantee",
                  "Custom approval workflows",
                  "ISO 27001 compliance docs",
                  "Priority support",
                ],
                cta: "Contact us",
                ctaStyle: "ghost",
                featured: false,
              },
            ].map(p => (
              <div key={p.tier} className={`pricing-card${p.featured ? " featured" : ""}`}>
                {p.badge && <div className="pricing-featured-badge">{p.badge}</div>}
                <div className="pricing-tier">{p.tier}</div>
                <div className="pricing-price">
                  PS{p.price}<span>/user/mo</span>
                </div>
                <div className="pricing-min">{p.min}</div>
                <hr className="pricing-divider" />
                <div className="pricing-features">
                  {p.features.map(f => (
                    <div key={f} className="pricing-feature">
                      <span className="pf-check">ok</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <a
                  href={p.ctaStyle === "primary" ? "/login" : "mailto:hello@aliena.co.uk"}
                  className={`pricing-cta ${p.ctaStyle}`}
                >
                  {p.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <section className="cta-section">
        <div className="cta-glow" />
        <div className="cta-inner">
          <div className="section-label" style={{textAlign:"center"}}>Get started</div>
          <h2 className="cta-title">
            Ready to modernise<br />your PMO?
          </h2>
          <p className="cta-sub">
            Start your free 90-day pilot today. No credit card required.
            Full access to all Professional features.
          </p>
          <div className="cta-actions">
            <a href="/login" className="btn-primary">Start free pilot</a>
            <a href="mailto:hello@aliena.co.uk" className="btn-ghost">Talk to us first</a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <a href="/" className="footer-logo">AlienAI</a>
        <div className="footer-links">
          <a href="/security" className="footer-link">Security</a>
          <a href="/privacy" className="footer-link">Privacy</a>
          <a href="/.well-known/security.txt" className="footer-link">security.txt</a>
          <a href="mailto:hello@aliena.co.uk" className="footer-link">Contact</a>
        </div>
        <div className="footer-copy">
          {"©"} 2026 AlienAI. Built in the UK.
        </div>
      </footer>
    </>
  );
}
