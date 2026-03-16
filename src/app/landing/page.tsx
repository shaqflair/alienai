// src/app/landing/page.tsx

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Aliena AI — The AI Governance Platform for Modern Programme Delivery",
  description:
    "Aliena AI unifies approvals, RAID, financial oversight, resource planning and executive reporting into one boardroom-grade AI governance platform.",
};

function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-base", md: "text-xl", lg: "text-3xl" };
  const imgSizes = { sm: 28, md: 36, lg: 52 };
  const letters = ["Λ", "L", "I", "Ξ", "N", "Λ"];

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      <img
        src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png "
        alt="Aliena AI logo"
        width={imgSizes[size]}
        height={imgSizes[size]}
        style={{
          objectFit: "contain",
          borderRadius: 8,
          boxShadow: "0 0 24px rgba(0,184,219,0.18)",
        }}
      />
      <span
        className={`font-bold ${sizes[size]}`}
        style={{
          fontFamily: "'Syne', sans-serif",
          letterSpacing: "0.18em",
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        {letters.map((l, i) => (
          <span
            key={i}
            style={{
              color: i === 0 || i === 2 || i === 5 ? "#00B8DB" : "inherit",
            }}
          >
            {l}
          </span>
        ))}
      </span>
    </span>
  );
}

// Governance Graph Component - Self-contained
function GovernanceGraph() {
  const nodes = [
    { id: 'programme', x: 50, y: 12, label: 'Programme', sublabel: 'Portfolio View', icon: '🏢', color: '#00B8DB', connections: ['pmo', 'finance', 'delivery'], health: 92 },
    { id: 'pmo', x: 20, y: 32, label: 'PMO Hub', sublabel: 'Governance', icon: '👥', color: '#4DE3FF', connections: ['approvals', 'raid'], health: 88 },
    { id: 'finance', x: 50, y: 32, label: 'Finance', sublabel: 'Budget', icon: '💰', color: '#22C55E', connections: ['variance', 'reporting'], health: 95 },
    { id: 'delivery', x: 80, y: 32, label: 'Delivery', sublabel: 'Execution', icon: '📈', color: '#EAB308', connections: ['milestones', 'resources'], health: 78 },
    { id: 'approvals', x: 10, y: 52, label: 'Approvals', sublabel: '4 Pending', icon: '✓', color: '#F97316', connections: ['ai'], health: 65 },
    { id: 'raid', x: 30, y: 52, label: 'RAID', sublabel: '12 Active', icon: '⚠', color: '#EF4444', connections: ['ai'], health: 72 },
    { id: 'variance', x: 45, y: 52, label: 'Variance', sublabel: '£1.2M', icon: '📊', color: '#F97316', connections: ['ai'], health: 58 },
    { id: 'milestones', x: 65, y: 52, label: 'Milestones', sublabel: '3 At Risk', icon: '🎯', color: '#EAB308', connections: ['ai'], health: 81 },
    { id: 'resources', x: 85, y: 52, label: 'Resources', sublabel: 'Overallocated', icon: '👤', color: '#EF4444', connections: ['ai'], health: 45 },
    { id: 'ai', x: 50, y: 72, label: 'AI Brain', sublabel: 'Intelligence', icon: '🧠', color: '#A855F7', connections: ['reporting'], health: 99 },
    { id: 'reporting', x: 50, y: 90, label: 'Executive Cockpit', sublabel: 'Unified View', icon: '📋', color: '#00B8DB', connections: [], health: 100 },
  ];

  const getHealthColor = (health: number) => {
    if (health >= 80) return '#22C55E';
    if (health >= 60) return '#EAB308';
    return '#EF4444';
  };

  return (
    <div className="governance-graph">
      {/* Grid Background */}
      <div className="graph-grid" />
      
      {/* SVG Connections */}
      <svg className="graph-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <marker id="arrow" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto">
            <polygon points="0 0, 3 1.5, 0 3" fill="#00B8DB" opacity="0.5" />
          </marker>
          <linearGradient id="connGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00B8DB" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#00B8DB" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#00B8DB" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        
        {/* Connection lines */}
        {nodes.map((node) => 
          node.connections.map((connId) => {
            const target = nodes.find(n => n.id === connId);
            if (!target) return null;
            return (
              <line
                key={`${node.id}-${connId}`}
                x1={node.x}
                y1={node.y}
                x2={target.x}
                y2={target.y}
                stroke="url(#connGradient)"
                strokeWidth="0.3"
                strokeDasharray="1,0.5"
                markerEnd="url(#arrow)"
              />
            );
          })
        )}
        
        {/* Animated data packets */}
        {nodes.map((node) => 
          node.connections.map((connId, i) => {
            const target = nodes.find(n => n.id === connId);
            if (!target) return null;
            return (
              <circle key={`packet-${node.id}-${connId}`} r="0.4" fill="#4DE3FF" opacity="0.8">
                <animate
                  attributeName="cx"
                  values={`${node.x};${target.x}`}
                  dur={`${2 + i * 0.3}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="cy"
                  values={`${node.y};${target.y}`}
                  dur={`${2 + i * 0.3}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;1;0"
                  dur={`${2 + i * 0.3}s`}
                  repeatCount="indefinite"
                />
              </circle>
            );
          })
        )}
      </svg>

      {/* Nodes */}
      {nodes.map((node) => (
        <div
          key={node.id}
          className={`graph-node ${node.id === 'ai' ? 'ai-node' : ''}`}
          style={{ left: `${node.x}%`, top: `${node.y}%` }}
        >
          {/* Health ring */}
          {node.health && (
            <svg className="health-ring" viewBox="0 0 36 36">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke={getHealthColor(node.health)}
                strokeWidth="2"
                strokeDasharray={`${node.health}, 100`}
                strokeLinecap="round"
                style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
              />
            </svg>
          )}
          
          {/* AI Pulse effect */}
          {node.id === 'ai' && (
            <>
              <div className="ai-pulse" />
              <div className="ai-pulse" style={{ animationDelay: '0.5s' }} />
            </>
          )}
          
          {/* Node content */}
          <div className="node-inner" style={{ borderColor: node.color }}>
            <span className="node-icon">{node.icon}</span>
          </div>
          
          {/* Labels */}
          <div className="node-labels">
            <div className="node-label">{node.label}</div>
            <div className="node-sublabel">{node.sublabel}</div>
            {node.health && (
              <div className="node-health" style={{ color: getHealthColor(node.health) }}>
                {node.health}%
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="graph-legend">
        <div className="legend-title">HEALTH STATUS</div>
        <div className="legend-item"><span className="dot green" /> Healthy (80%+)</div>
        <div className="legend-item"><span className="dot yellow" /> Warning (60-79%)</div>
        <div className="legend-item"><span className="dot red" /> Critical (&lt;60%)</div>
      </div>

      {/* Live indicator */}
      <div className="live-indicator">
        <span className="live-dot" /> LIVE DATA FLOW
      </div>
    </div>
  );
}

export default function LandingPage() {
  const trust = [
    "Built in the UK",
    "Row-level security enforced",
    "Governance-ready workflows",
    "Audit-grade decision trails",
    "AI-assisted oversight",
  ];

  const pains = [
    {
      title: "Fragmented control",
      desc: "Plans, RAID, approvals and reporting sit across spreadsheets, inboxes and disconnected tools.",
    },
    {
      title: "Reactive governance",
      desc: "Leaders hear about delivery risk too late, after schedule, budget or confidence has already slipped.",
    },
    {
      title: "Weak executive visibility",
      desc: "Decision-makers lack one reliable operating picture across projects, portfolios and approvals.",
    },
  ];

  const pillars = [
    {
      k: "01",
      title: "Governance Control",
      desc: "Run structured approval chains, maintain traceable decisions, and create confidence for programme boards, PMOs and sponsors.",
      bullets: [
        "Multi-step approvals",
        "Decision audit trail",
        "Delegated governance",
      ],
    },
    {
      k: "02",
      title: "Delivery Intelligence",
      desc: "Turn RAID, milestones, actions and exceptions into one live control layer with AI signals that surface what needs attention now.",
      bullets: [
        "AI risk signals",
        "Milestone visibility",
        "Weekly executive summaries",
      ],
    },
    {
      k: "03",
      title: "Financial Oversight",
      desc: "Bring budget, forecast, variance and commercial control into one place so leadership can see delivery impact earlier.",
      bullets: [
        "Budget vs forecast vs actual",
        "Variance detection",
        "Change impact visibility",
      ],
    },
    {
      k: "04",
      title: "Resource Command",
      desc: "See capacity, allocation pressure and delivery bottlenecks across teams before they become expensive constraints.",
      bullets: [
        "Capacity heatmaps",
        "Allocation pressure",
        "Forward planning insight",
      ],
    },
    {
      k: "05",
      title: "AI Governance Brain",
      desc: "Ask questions across your delivery estate, generate board-ready outputs, and surface the actions that matter most.",
      bullets: [
        "Natural language insights",
        "AI-generated summaries",
        "Due-soon governance prompts",
      ],
    },
  ];

  const showcaseCards = [
    {
      label: "EXECUTIVE COCKPIT",
      title: "One operating picture for leadership",
      text: "See financial variance, overdue actions, risk signals, approval bottlenecks and milestone health in one command view.",
    },
    {
      label: "GOVERNANCE HUB",
      title: "A control center, not a document graveyard",
      text: "Bring artefacts, guidance, workflows and approval history into one governed environment.",
    },
    {
      label: "AI SIGNALS",
      title: "AI that supports judgment, not noise",
      text: "Highlight blockers, summarise delivery posture, and guide decisions without removing human accountability.",
    },
  ];

  const outcomes = [
    { value: "Faster", label: "approval turnaround" },
    { value: "Earlier", label: "risk detection" },
    { value: "Stronger", label: "auditability" },
    { value: "Clearer", label: "executive reporting" },
  ];

  const audiences = [
    {
      title: "Enterprise PMOs",
      desc: "Gain portfolio-level visibility, governance discipline and leadership-ready reporting across complex delivery estates.",
    },
    {
      title: "Public Sector & Regulated Delivery",
      desc: "Support accountability, decision traceability and structured oversight without adding operational drag.",
    },
    {
      title: "Transformation & Delivery Leaders",
      desc: "Run programmes with one AI-powered control layer spanning risks, approvals, milestones, commercials and resourcing.",
    },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #06080B;
          --bg-soft: #0A0F14;
          --panel: rgba(255,255,255,0.04);
          --panel-2: rgba(255,255,255,0.03);
          --line: rgba(255,255,255,0.09);
          --line-strong: rgba(0,184,219,0.26);
          --text: #F6F7FB;
          --muted: #99A6B7;
          --muted-2: #7B8796;
          --cyan: #00B8DB;
          --cyan-bright: #4DE3FF;
          --green: #22C55E;
          --gold: #EAB308;
          --purple: #A855F7;
          --shadow: 0 18px 60px rgba(0,0,0,0.28);
          --radius: 22px;
          --radius-sm: 14px;
          --max: 1240px;
          --display: 'Syne', sans-serif;
          --body: 'Inter', sans-serif;
          --mono: 'DM Mono', monospace;
        }

        html { scroll-behavior: smooth; }

        body {
          background:
            radial-gradient(circle at top center, rgba(0,184,219,0.13), transparent 28%),
            radial-gradient(circle at 80% 20%, rgba(77,227,255,0.08), transparent 20%),
            linear-gradient(180deg, #05070A 0%, #071018 100%);
          color: var(--text);
          font-family: var(--body);
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
        }

        a { color: inherit; text-decoration: none; }

        .page {
          position: relative;
          min-height: 100vh;
        }

        .noise {
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.03;
          background-image:
            radial-gradient(circle at 20% 20%, white 0.5px, transparent 0.6px),
            radial-gradient(circle at 70% 40%, white 0.5px, transparent 0.6px),
            radial-gradient(circle at 40% 80%, white 0.5px, transparent 0.6px);
          background-size: 120px 120px;
          z-index: 0;
        }

        .shell {
          width: 100%;
          max-width: var(--max);
          margin: 0 auto;
          padding: 0 24px;
          position: relative;
          z-index: 1;
        }

        .nav {
          position: sticky;
          top: 0;
          z-index: 50;
          backdrop-filter: blur(18px);
          background: rgba(6,8,11,0.68);
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }

        .nav-inner {
          width: 100%;
          max-width: var(--max);
          margin: 0 auto;
          padding: 18px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
        }

        .nav-links {
          display: flex;
          align-items: center;
          gap: 26px;
        }

        .nav-link {
          font-size: 14px;
          color: var(--muted);
          transition: color 0.2s ease, opacity 0.2s ease;
        }

        .nav-link:hover { color: var(--text); }

        .nav-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          border-radius: 12px;
          padding: 12px 18px;
          font-size: 14px;
          font-weight: 600;
          transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
          white-space: nowrap;
        }

        .btn:hover { transform: translateY(-1px); }

        .btn-primary {
          background: linear-gradient(135deg, var(--cyan) 0%, var(--cyan-bright) 100%);
          color: #061018;
          box-shadow: 0 0 28px rgba(0,184,219,0.22);
        }

        .btn-secondary {
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.03);
          color: var(--text);
        }

        .btn-secondary:hover {
          border-color: rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.05);
        }

        .hero {
          padding: 54px 0 56px;
        }

        .hero-grid {
          display: grid;
          grid-template-columns: 1.05fr 0.95fr;
          gap: 34px;
          align-items: center;
        }

        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid rgba(0,184,219,0.22);
          background: rgba(0,184,219,0.08);
          color: var(--cyan-bright);
          font-size: 12px;
          font-family: var(--mono);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 22px;
        }

        .eyebrow-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--cyan);
          box-shadow: 0 0 14px var(--cyan);
        }

        .hero h1 {
          font-family: var(--display);
          font-size: clamp(46px, 7vw, 84px);
          line-height: 0.96;
          letter-spacing: -0.04em;
          font-weight: 800;
          max-width: 760px;
        }

        .hero h1 .accent {
          color: var(--cyan-bright);
          text-shadow: 0 0 18px rgba(0,184,219,0.18);
        }

        .hero-sub {
          margin-top: 22px;
          max-width: 640px;
          font-size: clamp(17px, 2.2vw, 21px);
          line-height: 1.65;
          color: var(--muted);
        }

        .hero-actions {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          margin-top: 32px;
        }

        .hero-proof {
          margin-top: 28px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .proof-pill {
          padding: 9px 12px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.03);
          color: var(--muted);
          font-size: 12px;
        }

        .hero-panel {
          position: relative;
          border-radius: 28px;
          border: 1px solid rgba(255,255,255,0.08);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%);
          box-shadow: var(--shadow);
          overflow: hidden;
          min-height: 620px;
        }

        .hero-panel::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(rgba(0,184,219,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,184,219,0.06) 1px, transparent 1px);
          background-size: 40px 40px;
          mask-image: radial-gradient(circle at center, black, transparent 88%);
          pointer-events: none;
        }

        .panel-top {
          padding: 18px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          position: relative;
          z-index: 1;
        }

        .panel-top-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .mini-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
        }

        .panel-title {
          font-size: 13px;
          color: var(--muted);
          letter-spacing: 0.06em;
          font-family: var(--mono);
        }

        .status-chip {
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid rgba(0,184,219,0.22);
          color: var(--cyan-bright);
          background: rgba(0,184,219,0.08);
          font-size: 11px;
          font-family: var(--mono);
        }

        .dashboard {
          padding: 22px;
          position: relative;
          z-index: 1;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: 1.15fr 0.85fr;
          gap: 16px;
        }

        .card {
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(8,14,20,0.78);
          padding: 18px;
          backdrop-filter: blur(12px);
        }

        .card h3 {
          font-size: 13px;
          color: var(--muted);
          font-weight: 600;
          margin-bottom: 14px;
          letter-spacing: 0.04em;
        }

        .big-metric {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 16px;
        }

        .metric-box {
          padding: 16px;
          border-radius: 16px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }

        .metric-value {
          font-family: var(--display);
          font-size: 30px;
          font-weight: 800;
          line-height: 1;
        }

        .metric-label {
          margin-top: 7px;
          font-size: 12px;
          color: var(--muted);
          line-height: 1.45;
        }

        .bars {
          display: grid;
          gap: 12px;
        }

        .bar-row {
          display: grid;
          grid-template-columns: 110px 1fr 46px;
          gap: 10px;
          align-items: center;
        }

        .bar-name {
          font-size: 12px;
          color: var(--muted);
        }

        .bar-track {
          height: 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          overflow: hidden;
        }

        .bar-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #00B8DB, #4DE3FF);
        }

        .bar-value {
          font-size: 12px;
          color: var(--text);
          text-align: right;
        }

        .signal-list {
          display: grid;
          gap: 12px;
        }

        .signal-item {
          padding: 14px;
          border-radius: 14px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }

        .signal-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }

        .signal-type {
          font-size: 11px;
          color: var(--cyan-bright);
          font-family: var(--mono);
          letter-spacing: 0.06em;
        }

        .signal-badge {
          font-size: 11px;
          color: #FDE68A;
          border: 1px solid rgba(234,179,8,0.2);
          background: rgba(234,179,8,0.08);
          padding: 4px 8px;
          border-radius: 999px;
        }

        .signal-text {
          font-size: 13px;
          color: var(--text);
          line-height: 1.6;
        }

        .floating-note {
          position: absolute;
          right: 18px;
          bottom: 18px;
          max-width: 240px;
          padding: 14px 14px 14px 16px;
          border-radius: 16px;
          background: rgba(0,184,219,0.10);
          border: 1px solid rgba(0,184,219,0.22);
          box-shadow: 0 12px 30px rgba(0,0,0,0.22);
          backdrop-filter: blur(14px);
          z-index: 2;
        }

        .floating-note-label {
          font-size: 11px;
          color: var(--cyan-bright);
          font-family: var(--mono);
          margin-bottom: 8px;
        }

        .floating-note p {
          font-size: 13px;
          line-height: 1.55;
          color: var(--text);
        }

        .trust-band {
          border-top: 1px solid rgba(255,255,255,0.06);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.02);
        }

        .trust-row {
          width: 100%;
          max-width: var(--max);
          margin: 0 auto;
          padding: 18px 24px;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          justify-content: center;
        }

        .trust-pill {
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          color: var(--muted);
          font-size: 12px;
        }

        .section {
          padding: 96px 0;
        }

        .section-head {
          max-width: 760px;
          margin-bottom: 42px;
        }

        .section-kicker {
          font-size: 12px;
          color: var(--cyan-bright);
          font-family: var(--mono);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 14px;
        }

        .section-title {
          font-family: var(--display);
          font-size: clamp(30px, 4.2vw, 54px);
          line-height: 1.02;
          letter-spacing: -0.03em;
          font-weight: 800;
        }

        .section-sub {
          margin-top: 16px;
          max-width: 680px;
          font-size: 17px;
          line-height: 1.75;
          color: var(--muted);
        }

        .pain-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          margin-top: 30px;
        }

        .pain-card, .pillar-card, .audience-card, .showcase-card {
          border-radius: var(--radius);
          border: 1px solid var(--line);
          background: var(--panel-2);
          box-shadow: var(--shadow);
        }

        .pain-card {
          padding: 28px;
          min-height: 220px;
        }

        .pain-card h3 {
          font-family: var(--display);
          font-size: 22px;
          line-height: 1.15;
          margin-bottom: 14px;
        }

        .pain-card p {
          color: var(--muted);
          font-size: 15px;
          line-height: 1.75;
        }

        .transform-banner {
          margin-top: 22px;
          padding: 24px 28px;
          border-radius: var(--radius);
          border: 1px solid rgba(0,184,219,0.18);
          background: linear-gradient(180deg, rgba(0,184,219,0.10), rgba(255,255,255,0.03));
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: center;
          flex-wrap: wrap;
        }

        .transform-copy {
          max-width: 760px;
        }

        .transform-title {
          font-family: var(--display);
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.03em;
          margin-bottom: 8px;
        }

        .transform-text {
          color: var(--muted);
          line-height: 1.7;
          font-size: 15px;
        }

        .pillars-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 18px;
        }

        .pillar-card {
          padding: 28px;
          position: relative;
          overflow: hidden;
        }

        .pillar-card::before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(77,227,255,0.8), transparent);
          opacity: 0.75;
        }

        .pillar-k {
          font-size: 12px;
          color: var(--cyan-bright);
          font-family: var(--mono);
          margin-bottom: 14px;
        }

        .pillar-title {
          font-family: var(--display);
          font-size: 26px;
          line-height: 1.08;
          letter-spacing: -0.03em;
          margin-bottom: 12px;
        }

        .pillar-desc {
          color: var(--muted);
          font-size: 15px;
          line-height: 1.75;
          margin-bottom: 18px;
        }

        .bullet-list {
          display: grid;
          gap: 10px;
        }

        .bullet {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          color: var(--text);
          font-size: 14px;
        }

        .bullet-mark {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background: rgba(34,197,94,0.12);
          border: 1px solid rgba(34,197,94,0.18);
          color: var(--green);
          font-size: 12px;
          margin-top: 1px;
        }

        .showcase-grid {
          display: grid;
          grid-template-columns: 1.15fr 0.85fr;
          gap: 18px;
        }

        .showcase-main {
          padding: 26px;
          min-height: 540px;
        }

        .showcase-main-shell {
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.08);
          background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
          padding: 18px;
          height: 100%;
        }

        .showcase-header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          margin-bottom: 18px;
        }

        .showcase-kicker {
          font-size: 11px;
          color: var(--cyan-bright);
          font-family: var(--mono);
          letter-spacing: 0.08em;
        }

        .showcase-title {
          font-family: var(--display);
          font-size: 30px;
          letter-spacing: -0.03em;
          margin-top: 8px;
        }

        .showcase-layout {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 14px;
          height: calc(100% - 82px);
        }

        .showcase-panel {
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.07);
          background: rgba(7,14,20,0.76);
          padding: 16px;
        }

        .mini-stats {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 14px;
        }

        .mini-stat {
          padding: 14px;
          border-radius: 14px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }

        .mini-stat strong {
          display: block;
          font-family: var(--display);
          font-size: 26px;
          line-height: 1;
          margin-bottom: 6px;
        }

        .mini-stat span {
          color: var(--muted);
          font-size: 12px;
          line-height: 1.45;
        }

        .table-list {
          display: grid;
          gap: 10px;
        }

        .table-row {
          display: grid;
          grid-template-columns: 1.2fr 0.7fr 0.5fr;
          gap: 10px;
          align-items: center;
          padding: 11px 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.05);
          font-size: 12px;
        }

        .muted { color: var(--muted); }

        .health {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 5px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
        }

        .health.good {
          color: #A7F3D0;
          background: rgba(16,185,129,0.12);
          border: 1px solid rgba(16,185,129,0.2);
        }

        .health.warn {
          color: #FDE68A;
          background: rgba(234,179,8,0.12);
          border: 1px solid rgba(234,179,8,0.2);
        }

        .showcase-side {
          display: grid;
          gap: 14px;
        }

        .showcase-card {
          padding: 24px;
        }

        .showcase-card-label {
          font-size: 11px;
          color: var(--cyan-bright);
          font-family: var(--mono);
          margin-bottom: 10px;
        }

        .showcase-card-title {
          font-family: var(--display);
          font-size: 22px;
          line-height: 1.12;
          margin-bottom: 10px;
        }

        .showcase-card-text {
          color: var(--muted);
          font-size: 15px;
          line-height: 1.7;
        }

        .comparison {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          margin-top: 26px;
        }

        .compare-box {
          border-radius: var(--radius);
          border: 1px solid var(--line);
          background: var(--panel-2);
          overflow: hidden;
        }

        .compare-head {
          padding: 18px 22px;
          border-bottom: 1px solid var(--line);
          font-family: var(--display);
          font-size: 24px;
        }

        .compare-head.old { color: #CBD5E1; }
        .compare-head.new { color: var(--cyan-bright); }

        .compare-list {
          display: grid;
        }

        .compare-item {
          padding: 16px 22px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          color: var(--muted);
          font-size: 15px;
          line-height: 1.65;
        }

        .compare-item:last-child { border-bottom: none; }

        .outcomes {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
          margin-top: 26px;
        }

        .outcome-card {
          padding: 26px 22px;
          border-radius: var(--radius);
          border: 1px solid var(--line);
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
          text-align: center;
        }

        .outcome-value {
          font-family: var(--display);
          font-size: 36px;
          line-height: 1;
          margin-bottom: 10px;
          color: var(--cyan-bright);
        }

        .outcome-label {
          color: var(--muted);
          font-size: 14px;
          line-height: 1.6;
        }

        .audience-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          margin-top: 28px;
        }

        .audience-card {
          padding: 28px;
        }

        .audience-card h3 {
          font-family: var(--display);
          font-size: 24px;
          letter-spacing: -0.03em;
          margin-bottom: 12px;
        }

        .audience-card p {
          color: var(--muted);
          font-size: 15px;
          line-height: 1.75;
        }

        .security-grid {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 18px;
          align-items: stretch;
          margin-top: 28px;
        }

        .security-panel {
          padding: 28px;
          border-radius: var(--radius);
          border: 1px solid var(--line);
          background: var(--panel-2);
        }

        .security-panel h3 {
          font-family: var(--display);
          font-size: 30px;
          letter-spacing: -0.03em;
          margin-bottom: 12px;
        }

        .security-panel p {
          color: var(--muted);
          line-height: 1.8;
          font-size: 15px;
        }

        .security-list {
          display: grid;
          gap: 12px;
          margin-top: 20px;
        }

        .security-item {
          padding: 14px 16px;
          border-radius: 14px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          color: var(--text);
          font-size: 14px;
        }

        .cta-wrap {
          padding: 100px 0 110px;
        }

        .cta-panel {
          border-radius: 30px;
          border: 1px solid rgba(0,184,219,0.18);
          background:
            radial-gradient(circle at top center, rgba(0,184,219,0.16), transparent 40%),
            linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03));
          box-shadow: var(--shadow);
          padding: 52px 32px;
          text-align: center;
        }

        .cta-panel h2 {
          font-family: var(--display);
          font-size: clamp(34px, 5vw, 58px);
          line-height: 1.02;
          letter-spacing: -0.04em;
          max-width: 860px;
          margin: 0 auto 18px;
        }

        .cta-panel p {
          max-width: 720px;
          margin: 0 auto;
          color: var(--muted);
          font-size: 17px;
          line-height: 1.8;
        }

        .cta-actions {
          display: flex;
          justify-content: center;
          gap: 14px;
          flex-wrap: wrap;
          margin-top: 28px;
        }

        .footer {
          border-top: 1px solid rgba(255,255,255,0.06);
          padding: 28px 0 44px;
        }

        .footer-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
        }

        .footer-links {
          display: flex;
          gap: 18px;
          flex-wrap: wrap;
        }

        .footer-link {
          color: var(--muted);
          font-size: 13px;
        }

        .footer-link:hover { color: var(--text); }

        .footer-copy {
          color: var(--muted-2);
          font-size: 13px;
        }

        /* ===== GOVERNANCE GRAPH STYLES ===== */
        .governance-section {
          padding: 80px 0;
          background: #020408;
          position: relative;
          overflow: hidden;
        }

        .governance-section::before {
          content: '';
          position: absolute;
          inset: 0;
          background: 
            radial-gradient(circle at 50% 50%, rgba(0,184,219,0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 0%, rgba(0,184,219,0.05) 0%, transparent 40%);
          pointer-events: none;
        }

        .starfield {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .star {
          position: absolute;
          width: 2px;
          height: 2px;
          background: white;
          border-radius: 50%;
          animation: twinkle 3s infinite;
        }

        @keyframes twinkle {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 0.8; }
        }

        .governance-graph {
          position: relative;
          width: 100%;
          height: 550px;
          background: rgba(11,15,20,0.6);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 24px;
          overflow: hidden;
        }

        .governance-graph::before,
        .governance-graph::after {
          content: '';
          position: absolute;
          width: 40px;
          height: 40px;
          border-color: rgba(0,184,219,0.3);
          border-style: solid;
          pointer-events: none;
        }

        .governance-graph::before {
          top: 0;
          left: 0;
          border-width: 2px 0 0 2px;
          border-radius: 24px 0 0 0;
        }

        .governance-graph::after {
          bottom: 0;
          right: 0;
          border-width: 0 2px 2px 0;
          border-radius: 0 0 24px 0;
        }

        .graph-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(rgba(0,184,219,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,184,219,0.05) 1px, transparent 1px);
          background-size: 40px 40px;
          opacity: 0.5;
        }

        .graph-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }

        .graph-node {
          position: absolute;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          z-index: 10;
          transition: transform 0.3s ease;
        }

        .graph-node:hover {
          transform: translate(-50%, -50%) scale(1.1);
        }

        .node-inner {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: rgba(5,7,10,0.95);
          border: 2px solid;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          position: relative;
          z-index: 2;
          box-shadow: 0 0 20px rgba(0,0,0,0.5);
        }

        .health-ring {
          position: absolute;
          width: 58px;
          height: 58px;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 1;
        }

        .ai-node .node-inner {
          animation: aiGlow 2s ease-in-out infinite;
        }

        @keyframes aiGlow {
          0%, 100% { box-shadow: 0 0 10px rgba(168,85,247,0.5); }
          50% { box-shadow: 0 0 25px rgba(168,85,247,0.8), 0 0 40px rgba(168,85,247,0.4); }
        }

        .ai-pulse {
          position: absolute;
          width: 50px;
          height: 50px;
          border-radius: 50%;
          border: 2px solid var(--purple);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          animation: pulse 1.5s ease-out infinite;
        }

        @keyframes pulse {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.8; }
          100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }

        .node-labels {
          margin-top: 8px;
          text-align: center;
          white-space: nowrap;
        }

        .node-label {
          font-family: var(--display);
          font-size: 11px;
          font-weight: 600;
          color: var(--text);
        }

        .node-sublabel {
          font-family: var(--mono);
          font-size: 9px;
          color: var(--muted-2);
          margin-top: 2px;
        }

        .node-health {
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 600;
          margin-top: 4px;
        }

        .graph-legend {
          position: absolute;
          bottom: 16px;
          left: 16px;
          background: rgba(11,15,20,0.9);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 12px 16px;
        }

        .legend-title {
          font-family: var(--mono);
          font-size: 9px;
          color: var(--muted-2);
          margin-bottom: 8px;
          letter-spacing: 0.1em;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: var(--muted);
          margin-bottom: 4px;
        }

        .legend-item:last-child { margin-bottom: 0; }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .dot.green { background: var(--green); }
        .dot.yellow { background: var(--gold); }
        .dot.red { background: #EF4444; }

        .live-indicator {
          position: absolute;
          top: 16px;
          left: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--mono);
          font-size: 10px;
          color: var(--green);
          letter-spacing: 0.05em;
        }

        .live-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--green);
          animation: livePulse 1.5s ease-in-out infinite;
        }

        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }

        .graph-header {
          position: absolute;
          top: 16px;
          right: 16px;
          display: flex;
          gap: 16px;
          font-family: var(--mono);
          font-size: 10px;
          color: var(--muted-2);
        }

        @media (max-width: 1120px) {
          .hero-grid,
          .showcase-grid,
          .security-grid,
          .dashboard-grid,
          .showcase-layout {
            grid-template-columns: 1fr;
          }

          .pain-grid,
          .comparison,
          .audience-grid,
          .outcomes,
          .pillars-grid {
            grid-template-columns: 1fr;
          }

          .hero-panel { min-height: auto; }
          
          .governance-graph { height: 400px; }
          .node-inner { width: 40px; height: 40px; font-size: 16px; }
          .health-ring { width: 48px; height: 48px; }
          .node-label { font-size: 9px; }
          .node-sublabel { font-size: 8px; }
        }

        @media (max-width: 860px) {
          .nav-links { display: none; }
          .nav-inner { padding: 16px 20px; }
          .shell { padding: 0 20px; }
          .section { padding: 74px 0; }
          .hero { padding: 34px 0 40px; }
          .big-metric,
          .mini-stats {
            grid-template-columns: 1fr;
          }
          .bar-row {
            grid-template-columns: 90px 1fr 42px;
          }
          .footer-inner {
            flex-direction: column;
            align-items: flex-start;
          }
          
          .governance-graph { height: 350px; }
          .graph-legend { display: none; }
        }

        @media (max-width: 560px) {
          .btn, .btn-primary, .btn-secondary {
            width: 100%;
          }

          .hero-actions,
          .cta-actions {
            display: grid;
            width: 100%;
          }

          .proof-pill,
          .trust-pill {
            width: 100%;
            text-align: center;
          }

          .transform-banner {
            padding: 22px 20px;
          }

          .cta-panel {
            padding: 38px 20px;
          }
          
          .governance-graph { height: 300px; }
          .node-inner { width: 32px; height: 32px; font-size: 14px; }
          .health-ring { width: 40px; height: 40px; }
        }
      `}</style>

      <div className="page">
        <div className="noise" />

        <nav className="nav">
          <div className="nav-inner">
            <a href="/" aria-label="Aliena AI home">
              <Logo size="md" />
            </a>

            <div className="nav-links">
              <a href="#platform" className="nav-link">
                Platform
              </a>
              <a href="#showcase" className="nav-link">
                Product
              </a>
              <a href="#intelligence" className="nav-link">
                Intelligence
              </a>
              <a href="#outcomes" className="nav-link">
                Outcomes
              </a>
              <a href="#security" className="nav-link">
                Security
              </a>
            </div>

            <div className="nav-actions">
              <a href="/login" className="btn btn-secondary">
                Sign in
              </a>
              <a href="mailto:hello@aliena.co.uk" className="btn btn-primary">
                Book a demo
              </a>
            </div>
          </div>
        </nav>

        <main>
          {/* ... (keep all your existing sections: hero, trust, problem, pillars, showcase) ... */}
          
          {/* HERO SECTION - keep existing */}
          <section className="hero">
            <div className="shell">
              <div className="hero-grid">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-dot" />
                    AI Governance Platform for Programme Delivery
                  </div>

                  <h1>
                    Govern complex delivery with an
                    <span className="accent"> AI-native control layer</span>
                  </h1>

                  <p className="hero-sub">
                    Aliena AI brings approvals, RAID, financial oversight,
                    resource planning and executive reporting into one
                    boardroom-grade operating system for PMOs, delivery leaders
                    and regulated organisations.
                  </p>

                  <div className="hero-actions">
                    <a href="/login" className="btn btn-primary">
                      Start pilot
                    </a>
                    <a
                      href="mailto:hello@aliena.co.uk"
                      className="btn btn-secondary"
                    >
                      Talk to Aliena
                    </a>
                  </div>

                  <div className="hero-proof">
                    <span className="proof-pill">Executive Cockpit</span>
                    <span className="proof-pill">Governance Hub</span>
                    <span className="proof-pill">AI Risk Signals</span>
                    <span className="proof-pill">Audit-ready workflows</span>
                  </div>
                </div>

                <div className="hero-panel">
                  <div className="panel-top">
                    <div className="panel-top-left">
                      <span className="mini-dot" />
                      <span className="mini-dot" />
                      <span className="mini-dot" />
                      <span className="panel-title">
                        ALIENA EXECUTIVE COCKPIT
                      </span>
                    </div>
                    <span className="status-chip">LIVE GOVERNANCE VIEW</span>
                  </div>

                  <div className="dashboard">
                    <div className="dashboard-grid">
                      <div className="card">
                        <h3>Portfolio posture</h3>
                        <div className="big-metric">
                          <div className="metric-box">
                            <div className="metric-value">17</div>
                            <div className="metric-label">
                              active projects under control
                            </div>
                          </div>
                          <div className="metric-box">
                            <div className="metric-value">4</div>
                            <div className="metric-label">
                              approvals requiring escalation
                            </div>
                          </div>
                          <div className="metric-box">
                            <div className="metric-value">£1.2m</div>
                            <div className="metric-label">
                              forecast variance flagged early
                            </div>
                          </div>
                        </div>

                        <div className="bars">
                          {[
                            ["Budget control", 86],
                            ["Milestone health", 78],
                            ["Approval compliance", 91],
                            ["Resource readiness", 73],
                          ].map(([label, value]) => (
                            <div key={label} className="bar-row">
                              <div className="bar-name">{label}</div>
                              <div className="bar-track">
                                <div
                                  className="bar-fill"
                                  style={{ width: `${value}%` }}
                                />
                              </div>
                              <div className="bar-value">{value}%</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="card">
                        <h3>AI governance signals</h3>
                        <div className="signal-list">
                          <div className="signal-item">
                            <div className="signal-head">
                              <span className="signal-type">APPROVAL FLOW</span>
                              <span className="signal-badge">Needs review</span>
                            </div>
                            <div className="signal-text">
                              One financial plan is waiting on step-two approval
                              and is now 5 days outside target SLA.
                            </div>
                          </div>

                          <div className="signal-item">
                            <div className="signal-head">
                              <span className="signal-type">BUDGET VARIANCE</span>
                              <span className="signal-badge">Emerging</span>
                            </div>
                            <div className="signal-text">
                              Change activity suggests a forecast overrun trend
                              in Q3 unless scope sequencing is adjusted.
                            </div>
                          </div>

                          <div className="signal-item">
                            <div className="signal-head">
                              <span className="signal-type">RESOURCE LOAD</span>
                              <span className="signal-badge">Pressure</span>
                            </div>
                            <div className="signal-text">
                              Delivery leadership capacity is over-allocated
                              across two programmes this month.
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="floating-note">
                      <div className="floating-note-label">AI SUMMARY</div>
                      <p>
                        Portfolio remains stable, but approval delay and Q3
                        variance risk now need leadership attention this week.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* TRUST BAND - keep existing */}
          <div className="trust-band">
            <div className="trust-row">
              {trust.map((item) => (
                <span key={item} className="trust-pill">
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* PROBLEM SECTION - keep existing */}
          <section className="section">
            <div className="shell">
              <div className="section-head">
                <div className="section-kicker">The problem</div>
                <h2 className="section-title">
                  Most PMOs do not struggle from lack of effort. They struggle
                  from fragmented control.
                </h2>
                <p className="section-sub">
                  Delivery teams work hard, but governance breaks when planning,
                  decisions, risks, approvals and reporting live across too many
                  disconnected places.
                </p>
              </div>

              <div className="pain-grid">
                {pains.map((item) => (
                  <div key={item.title} className="pain-card">
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </div>
                ))}
              </div>

              <div className="transform-banner">
                <div className="transform-copy">
                  <div className="transform-title">
                    Aliena turns delivery operations into a governed intelligence
                    system.
                  </div>
                  <div className="transform-text">
                    One control layer for programme oversight, one source of
                    truth for governance, and one AI brain to help leaders act
                    before issues escalate.
                  </div>
                </div>
                <a href="#platform" className="btn btn-primary">
                  Explore the platform
                </a>
              </div>
            </div>
          </section>

          {/* PLATFORM PILARS - keep existing */}
          <section className="section" id="platform">
            <div className="shell">
              <div className="section-head">
                <div className="section-kicker">Platform pillars</div>
                <h2 className="section-title">
                  Built as an AI governance platform, not another project tool.
                </h2>
                <p className="section-sub">
                  Aliena is designed to become the intelligence layer across
                  delivery, governance and executive reporting.
                </p>
              </div>

              <div className="pillars-grid">
                {pillars.map((p) => (
                  <div key={p.title} className="pillar-card">
                    <div className="pillar-k">{p.k}</div>
                    <div className="pillar-title">{p.title}</div>
                    <div className="pillar-desc">{p.desc}</div>
                    <div className="bullet-list">
                      {p.bullets.map((b) => (
                        <div key={b} className="bullet">
                          <span className="bullet-mark">✓</span>
                          <span>{b}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* SHOWCASE SECTION - keep existing */}
          <section className="section" id="showcase">
            <div className="shell">
              <div className="section-head">
                <div className="section-kicker">Product showcase</div>
                <h2 className="section-title">
                  A boardroom-grade control experience for modern delivery
                  organisations.
                </h2>
                <p className="section-sub">
                  The interface should feel like a command center, not a static
                  reporting page. That is where Aliena wins.
                </p>
              </div>

              <div className="showcase-grid">
                <div className="showcase-main pain-card">
                  <div className="showcase-main-shell">
                    <div className="showcase-header">
                      <div>
                        <div className="showcase-kicker">
                          GOVERNANCE INTELLIGENCE
                        </div>
                        <div className="showcase-title">
                          One operating picture for leadership
                        </div>
                      </div>
                      <span className="status-chip">BOARD VIEW</span>
                    </div>

                    <div className="showcase-layout">
                      <div className="showcase-panel">
                        <div className="mini-stats">
                          <div className="mini-stat">
                            <strong>11</strong>
                            <span>live approvals in flight</span>
                          </div>
                          <div className="mini-stat">
                            <strong>6</strong>
                            <span>red signals requiring attention</span>
                          </div>
                          <div className="mini-stat">
                            <strong>92%</strong>
                            <span>governance compliance this month</span>
                          </div>
                          <div className="mini-stat">
                            <strong>3</strong>
                            <span>milestones at delivery risk</span>
                          </div>
                        </div>

                        <div className="table-list">
                          <div className="table-row">
                            <span>Financial Plan — Q3 Reforecast</span>
                            <span className="muted">Awaiting CFO</span>
                            <span className="health warn">At risk</span>
                          </div>
                          <div className="table-row">
                            <span>Charter — Mobilisation Wave 2</span>
                            <span className="muted">Approved</span>
                            <span className="health good">Healthy</span>
                          </div>
                          <div className="table-row">
                            <span>Change Request — Supplier Extension</span>
                            <span className="muted">In review</span>
                            <span className="health warn">Watch</span>
                          </div>
                          <div className="table-row">
                            <span>RAID Digest — Weekly Board Pack</span>
                            <span className="muted">AI generated</span>
                            <span className="health good">Ready</span>
                          </div>
                        </div>
                      </div>

                      <div className="showcase-side">
                        {showcaseCards.map((c) => (
                          <div key={c.title} className="showcase-card">
                            <div className="showcase-card-label">{c.label}</div>
                            <div className="showcase-card-title">{c.title}</div>
                            <div className="showcase-card-text">{c.text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="showcase-side">
                  <div className="showcase-card">
                    <div className="showcase-card-label">UI DIRECTION</div>
                    <div className="showcase-card-title">
                      How this page should feel
                    </div>
                    <div className="showcase-card-text">
                      Premium, sharp, cinematic and executive. Less startup
                      template. More control tower. Use fewer generic cards,
                      more asymmetry, stronger typography, and real product
                      storytelling.
                    </div>
                  </div>

                  <div className="showcase-card">
                    <div className="showcase-card-label">COPY DIRECTION</div>
                    <div className="showcase-card-title">
                      How this page should sound
                    </div>
                    <div className="showcase-card-text">
                      Confident, strategic and outcome-led. Speak to governance,
                      visibility, delivery confidence and executive control
                      rather than just modules and checklists.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ===== NEW: GOVERNANCE INTELLIGENCE SECTION ===== */}
          <section className="governance-section" id="intelligence">
            {/* Starfield Background */}
            <div className="starfield">
              {[...Array(40)].map((_, i) => (
                <div
                  key={i}
                  className="star"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 3}s`,
                  }}
                />
              ))}
            </div>

            <div className="shell" style={{ position: 'relative', zIndex: 1 }}>
              <div className="section-head" style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 40px' }}>
                <div className="section-kicker">Governance Intelligence</div>
                <h2 className="section-title">
                  The <span style={{ color: '#00B8DB' }}>Ontology</span> of Delivery
                </h2>
                <p className="section-sub">
                  See how Aliena connects programmes, PMO, finance, and delivery into a unified intelligence layer. Data flows in real-time. Insights emerge automatically.
                </p>
              </div>

              <GovernanceGraph />
            </div>
          </section>

          {/* COMPARISON SECTION - keep existing */}
          <section className="section">
            <div className="shell">
              <div className="section-head">
                <div className="section-kicker">Why Aliena wins</div>
                <h2 className="section-title">
                  Traditional PM tools record activity. Aliena interprets it.
                </h2>
                <p className="section-sub">
                  This is the category shift: from system of record to system of
                  intelligence.
                </p>
              </div>

              <div className="comparison">
                <div className="compare-box">
                  <div className="compare-head old">Traditional PM tools</div>
                  <div className="compare-list">
                    <div className="compare-item">
                      Static reports assembled after the fact
                    </div>
                    <div className="compare-item">
                      Disconnected approvals and governance evidence
                    </div>
                    <div className="compare-item">
                      RAID logs that depend on manual interpretation
                    </div>
                    <div className="compare-item">
                      Executive visibility arrives too late
                    </div>
                  </div>
                </div>

                <div className="compare-box">
                  <div className="compare-head new">Aliena AI</div>
                  <div className="compare-list">
                    <div className="compare-item">
                      Live delivery intelligence with AI-assisted summaries
                    </div>
                    <div className="compare-item">
                      Traceable approval flows and defendable decisions
                    </div>
                    <div className="compare-item">
                      Risk, financial and schedule signals surfaced early
                    </div>
                    <div className="compare-item">
                      One control layer for leaders, PMOs and delivery teams
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* OUTCOMES SECTION - keep existing */}
          <section className="section" id="outcomes">
            <div className="shell">
              <div className="section-head">
                <div className="section-kicker">Outcomes</div>
                <h2 className="section-title">
                  Designed to improve the quality and speed of executive
                  decision-making.
                </h2>
                <p className="section-sub">
                  The goal is not more dashboards. The goal is better control,
                  earlier intervention and more confident delivery.
                </p>
              </div>

              <div className="outcomes">
                {outcomes.map((o) => (
                  <div key={o.label} className="outcome-card">
                    <div className="outcome-value">{o.value}</div>
                    <div className="outcome-label">{o.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* AUDIENCE SECTION - keep existing */}
          <section className="section">
            <div className="shell">
              <div className="section-head">
                <div className="section-kicker">Who it serves</div>
                <h2 className="section-title">
                  Built for organisations where governance and delivery both
                  matter.
                </h2>
                <p className="section-sub">
                  Aliena is strongest where complexity, accountability and
                  executive visibility are all non-negotiable.
                </p>
              </div>

              <div className="audience-grid">
                {audiences.map((a) => (
                  <div key={a.title} className="audience-card">
                    <h3>{a.title}</h3>
                    <p>{a.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* SECURITY SECTION - keep existing */}
          <section className="section" id="security">
            <div className="shell">
              <div className="section-head">
                <div className="section-kicker">Security & readiness</div>
                <h2 className="section-title">
                  Enterprise confidence is part of the product, not an afterthought.
                </h2>
                <p className="section-sub">
                  The landing page should reassure serious buyers that Aliena is
                  designed for control, accountability and scale.
                </p>
              </div>

              <div className="security-grid">
                <div className="security-panel">
                  <h3>Trust signals that actually matter</h3>
                  <p>
                    Move beyond generic badge language. Speak directly to how
                    Aliena protects data, supports auditability and enables
                    accountable AI-assisted decisions across organisations.
                  </p>
                  <div className="security-list">
                    <div className="security-item">
                      Row-level security and role-based access design
                    </div>
                    <div className="security-item">
                      Governed approval workflows with clear traceability
                    </div>
                    <div className="security-item">
                      AI assistance designed to support human decisions
                    </div>
                    <div className="security-item">
                      UK-built platform for complex delivery environments
                    </div>
                  </div>
                </div>

                <div className="security-panel">
                  <h3>Section-by-section redesign direction</h3>
                  <div className="security-list">
                    <div className="security-item">
                      <strong>Hero:</strong> category-defining headline, premium
                      product visual, executive positioning
                    </div>
                    <div className="security-item">
                      <strong>Problem:</strong> elevate from strip to strategic
                      transformation narrative
                    </div>
                    <div className="security-item">
                      <strong>Features:</strong> replace module list with
                      platform pillars
                    </div>
                    <div className="security-item">
                      <strong>Trust:</strong> speak to governance, control,
                      auditability and enterprise readiness
                    </div>
                    <div className="security-item">
                      <strong>CTA:</strong> make it feel like an enterprise
                      rollout conversation, not a generic signup prompt
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* CTA SECTION - keep existing */}
          <section className="cta-wrap">
            <div className="shell">
              <div className="cta-panel">
                <div className="section-kicker" style={{ marginBottom: 16 }}>
                  Final call to action
                </div>
                <h2>
                  Bring governance, visibility and AI decision intelligence into
                  one platform.
                </h2>
                <p>
                  If you want Aliena to feel world class, the page must present
                  it as a category-defining governance platform for serious
                  delivery organisations, not just a feature-rich PM app.
                </p>
                <div className="cta-actions">
                  <a href="/login" className="btn btn-primary">
                    Start pilot
                  </a>
                  <a
                    href="mailto:hello@aliena.co.uk"
                    className="btn btn-secondary"
                  >
                    Book a leadership demo
                  </a>
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* FOOTER - keep existing */}
        <footer className="footer">
          <div className="shell">
            <div className="footer-inner">
              <a href="/" aria-label="Aliena AI home">
                <Logo size="sm" />
              </a>

              <div className="footer-links">
                <a href="/security" className="footer-link">
                  Security
                </a>
                <a href="/privacy" className="footer-link">
                  Privacy
                </a>
                <a href="/.well-known/security.txt" className="footer-link">
                  security.txt
                </a>
                <a href="mailto:hello@aliena.co.uk" className="footer-link">
                  Contact
                </a>
              </div>

              <div className="footer-copy">© 2026 Aliena AI. Built in the UK.</div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}