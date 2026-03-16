"use client";

import { useMemo, useState, type ComponentType } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Brain,
  Building2,
  ChevronRight,
  Cpu,
  FileCheck,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Theme                                                              */
/* ------------------------------------------------------------------ */
const THEME = {
  cyan: "#00C2E8",
  cyanLt: "#57E7FF",
  green: "#22C55E",
  amber: "#EAB308",
  orange: "#F97316",
  purple: "#A855F7",
  red: "#EF4444",
  text: "#F5F8FC",
  muted: "#A0ACBC",
  muted2: "#667184",
  line: "rgba(255,255,255,0.07)",
  lineStrong: "rgba(255,255,255,0.1)",
  lineCyan: "rgba(0,194,232,0.18)",
  bg0: "#03050A",
  bg1: "#07101B",
  panel: "rgba(255,255,255,0.035)",
};

const FONT = {
  display: "'Sora', sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",
};

/* ------------------------------------------------------------------ */
/* Logo                                                               */
/* ------------------------------------------------------------------ */
function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: { icon: 28, text: 18, gap: 10 },
    md: { icon: 36, text: 22, gap: 12 },
    lg: { icon: 52, text: 32, gap: 14 },
  }[size];

const letters = [
    { ch: "\u039B", accent: true },
    { ch: "L",      accent: false },
    { ch: "I",      accent: true },
    { ch: "\u039E", accent: false },
    { ch: "N",      accent: false },
    { ch: "\u039B", accent: true },
  ];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: sizes.gap }}>
      <img
        src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
        alt="Aliena"
        width={sizes.icon}
        height={sizes.icon}
        style={{ objectFit: "contain", borderRadius: 10 }}
      />
      <span
        style={{
          fontFamily: FONT.display,
          letterSpacing: "0.18em",
          fontWeight: 700,
          fontSize: sizes.text,
          display: "inline-flex",
        }}
      >
        {letters.map((letter, index) => (
          <span key={index} style={{ color: letter.accent ? THEME.cyan : "inherit" }}>
            {letter.ch}
          </span>
        ))}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Starfield                                                          */
/* ------------------------------------------------------------------ */
const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  x: (i * 137.508 + 13) % 100,
  y: (i * 97.3 + 7) % 100,
  size: i % 3 === 0 ? 2 : 1,
  delay: (i * 0.19) % 4,
  dur: 2 + (i % 3),
  op: 0.3 + ((i * 0.07) % 0.5),
}));

function Starfield({ density = 1 }: { density?: number }) {
  const stars = STARS.slice(0, Math.floor(STARS.length * density));

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {stars.map((star) => (
        <div
          key={star.id}
          style={{
            position: "absolute",
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.size,
            height: star.size,
            borderRadius: "50%",
            background: "white",
            opacity: star.op,
            animation: `al-twinkle ${star.dur}s ${star.delay}s ease-in-out infinite alternate`,
            willChange: "opacity, transform",
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Governance Graph                                                    */
/* ------------------------------------------------------------------ */
type GraphNode = {
  id: string;
  x: number;
  y: number;
  label: string;
  sub: string;
  color: string;
  health: number;
  Icon: ComponentType<{ size?: number; color?: string }>;
  };

const GRAPH_NODES: GraphNode[] = [
  {
    id: "programme",
    x: 50,
    y: 13,
    label: "Programme",
    sub: "Portfolio View",
    color: THEME.cyan,
    health: 92,
    Icon: Building2,
  },
  {
    id: "pmo",
    x: 20,
    y: 33,
    label: "PMO Hub",
    sub: "Governance Control",
    color: THEME.cyanLt,
    health: 88,
    Icon: Users,
  },
  {
    id: "finance",
    x: 50,
    y: 33,
    label: "Finance",
    sub: "Budget & Forecast",
    color: THEME.green,
    health: 95,
    Icon: Wallet,
  },
  {
    id: "delivery",
    x: 80,
    y: 33,
    label: "Delivery",
    sub: "Milestones & Resources",
    color: THEME.amber,
    health: 78,
    Icon: TrendingUp,
  },
  {
    id: "approvals",
    x: 10,
    y: 54,
    label: "Approvals",
    sub: "4 Pending",
    color: THEME.orange,
    health: 65,
    Icon: FileCheck,
  },
  {
    id: "raid",
    x: 30,
    y: 54,
    label: "RAID",
    sub: "12 Active",
    color: THEME.red,
    health: 72,
    Icon: AlertTriangle,
  },
  {
    id: "variance",
    x: 48,
    y: 54,
    label: "Variance",
    sub: "1.2M Flagged",
    color: THEME.orange,
    health: 58,
    Icon: Activity,
  },
  {
    id: "milestones",
    x: 67,
    y: 54,
    label: "Milestones",
    sub: "3 At Risk",
    color: THEME.amber,
    health: 81,
    Icon: TrendingUp,
  },
  {
    id: "resources",
    x: 86,
    y: 54,
    label: "Resources",
    sub: "Overallocated",
    color: THEME.red,
    health: 45,
    Icon: Users,
  },
  {
    id: "ai",
    x: 50,
    y: 74,
    label: "AI Governance",
    sub: "Intelligence Layer",
    color: THEME.purple,
    health: 99,
    Icon: Cpu,
  },
  {
    id: "reporting",
    x: 50,
    y: 90,
    label: "Exec Cockpit",
    sub: "Unified View",
    color: THEME.cyan,
    health: 100,
    Icon: Activity,
  },
];

const GRAPH_EDGES: Array<[string, string]> = [
  ["programme", "pmo"],
  ["programme", "finance"],
  ["programme", "delivery"],
  ["pmo", "approvals"],
  ["pmo", "raid"],
  ["finance", "variance"],
  ["finance", "reporting"],
  ["delivery", "milestones"],
  ["delivery", "resources"],
  ["approvals", "ai"],
  ["raid", "ai"],
  ["variance", "ai"],
  ["milestones", "ai"],
  ["resources", "ai"],
  ["ai", "reporting"],
];

function healthColor(health: number) {
  if (health >= 80) return THEME.green;
  if (health >= 60) return THEME.amber;
  return THEME.red;
}

function GovernanceGraph() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const nodeMap = useMemo(
    () => Object.fromEntries(GRAPH_NODES.map((node) => [node.id, node])),
    []
  );

  const nx = (x: number) => (x / 100) * 800;
  const ny = (y: number) => (y / 100) * 500;

  const selectedNode = selected ? nodeMap[selected] : null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 480 }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.06,
          backgroundImage:
            "linear-gradient(rgba(0,194,232,0.55) 1px,transparent 1px),linear-gradient(90deg,rgba(0,194,232,0.55) 1px,transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <svg
        viewBox="0 0 800 500"
        style={{ width: "100%", height: "100%", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="gg-edge" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={THEME.cyan} stopOpacity="0.08" />
            <stop offset="50%" stopColor={THEME.cyan} stopOpacity="0.7" />
            <stop offset="100%" stopColor={THEME.cyan} stopOpacity="0.08" />
          </linearGradient>

          <marker id="gg-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 0,6 3,0 6" fill={THEME.cyan} opacity="0.5" />
          </marker>

          <filter id="gg-particle-glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="gg-soft-glow">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {GRAPH_EDGES.map(([from, to]) => {
          const start = nodeMap[from];
          const end = nodeMap[to];
          const highlighted = hovered === from || hovered === to || selected === from || selected === to;

          return (
            <line
              key={`${from}-${to}`}
              x1={nx(start.x)}
              y1={ny(start.y)}
              x2={nx(end.x)}
              y2={ny(end.y)}
              stroke={highlighted ? THEME.cyan : "url(#gg-edge)"}
              strokeWidth={highlighted ? 1.6 : 0.85}
              strokeDasharray="4 4"
              opacity={highlighted ? 1 : 0.42}
              markerEnd="url(#gg-arrow)"
            />
          );
        })}

        {GRAPH_EDGES.map(([from, to], index) => {
          const start = nodeMap[from];
          const end = nodeMap[to];
          const isAiFlow = to === "ai";

          return (
            <circle
              key={`particle-${from}-${to}`}
              r={isAiFlow ? 3.5 : 2.5}
              fill={isAiFlow ? THEME.purple : THEME.cyanLt}
              filter="url(#gg-particle-glow)"
              opacity="0"
            >
              <animateMotion
                dur={`${1.8 + (index % 5) * 0.3}s`}
                repeatCount="indefinite"
                path={`M${nx(start.x)},${ny(start.y)} L${nx(end.x)},${ny(end.y)}`}
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                dur={`${1.8 + (index % 5) * 0.3}s`}
                repeatCount="indefinite"
              />
            </circle>
          );
        })}

        {GRAPH_NODES.map((node) => {
          const x = nx(node.x);
          const y = ny(node.y);
          const isAi = node.id === "ai";
          const isReporting = node.id === "reporting";
          const isHovered = hovered === node.id;
          const isSelected = selected === node.id;
          const circumference = 2 * Math.PI * 22;
          const ringColor = healthColor(node.health);

          return (
            <g
              key={node.id}
              transform={`translate(${x},${y})`}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected((current) => (current === node.id ? null : node.id))}
            >
              {isAi && (
                <>
                  <circle r="44" fill="none" stroke={THEME.purple} strokeWidth="1.5" opacity="0.3">
                    <animate attributeName="r" values="36;52;36" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.4;0;0.4" dur="2.5s" repeatCount="indefinite" />
                  </circle>
                  <circle r="30" fill="none" stroke={THEME.purple} strokeWidth="1" opacity="0.5">
                    <animate
                      attributeName="r"
                      values="28;40;28"
                      dur="2s"
                      begin="0.5s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.6;0;0.6"
                      dur="2s"
                      begin="0.5s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </>
              )}

              {isReporting && (
                <circle r="34" fill="none" stroke={THEME.cyan} strokeWidth="1.25" opacity="0.22">
                  <animate attributeName="r" values="30;38;30" dur="3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.25;0.08;0.25" dur="3s" repeatCount="indefinite" />
                </circle>
              )}

              {(isHovered || isSelected) && (
                <circle
                  r="34"
                  fill="none"
                  stroke={node.color}
                  strokeWidth="1.5"
                  opacity="0.35"
                  filter="url(#gg-soft-glow)"
                />
              )}

              <circle
                r="22"
                fill="none"
                stroke={ringColor}
                strokeWidth="2.5"
                strokeDasharray={`${(node.health / 100) * circumference} ${circumference}`}
                strokeLinecap="round"
                transform="rotate(-90)"
                opacity="0.88"
              />
              <circle r="18" fill="rgba(7,10,18,0.95)" stroke={node.color} strokeWidth="1.5" />

              <text
                y="-28"
                textAnchor="middle"
                fill={ringColor}
                fontSize="9"
                fontWeight="600"
                fontFamily={FONT.mono}
              >
                {node.health}%
              </text>

              <g transform="translate(0,-1)">
                <foreignObject x="-10" y="-10" width="20" height="20">
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <node.Icon size={12} color={node.color} />
                  </div>
                </foreignObject>
              </g>

              <text
                y="34"
                textAnchor="middle"
                fill={THEME.text}
                fontSize="10"
                fontWeight="600"
                fontFamily={FONT.display}
              >
                {node.label}
              </text>

              <text y="45" textAnchor="middle" fill={THEME.muted2} fontSize="8" fontFamily={FONT.mono}>
                {node.sub}
              </text>
            </g>
          );
        })}
      </svg>

      {selectedNode && (
        <div
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 230,
            background: "rgba(9,13,22,0.95)",
            backdropFilter: "blur(22px)",
            border: `1px solid ${THEME.lineStrong}`,
            borderRadius: 18,
            padding: 16,
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                border: `2px solid ${selectedNode.color}`,
                background: `${selectedNode.color}18`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <selectedNode.Icon size={16} color={selectedNode.color} />
            </div>

            <div>
              <div
                style={{
                  fontFamily: FONT.display,
                  fontSize: 13,
                  fontWeight: 600,
                  color: THEME.text,
                }}
              >
                {selectedNode.label}
              </div>
              <div
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 9,
                  color: THEME.muted2,
                }}
              >
                {selectedNode.sub}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#7C889B", marginBottom: 6 }}>Health</div>

          <div
            style={{
              height: 5,
              background: "rgba(255,255,255,0.08)",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${selectedNode.health}%`,
                background: healthColor(selectedNode.health),
                borderRadius: 999,
              }}
            />
          </div>

          <div
            style={{
              textAlign: "right",
              fontSize: 11,
              color: healthColor(selectedNode.health),
              fontFamily: FONT.mono,
              marginTop: 5,
            }}
          >
            {selectedNode.health}%
          </div>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          background: "rgba(9,13,22,0.92)",
          backdropFilter: "blur(18px)",
          border: `1px solid ${THEME.line}`,
          borderRadius: 16,
          padding: "12px 14px",
          boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
        }}
      >
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 9,
            color: THEME.muted2,
            marginBottom: 7,
            letterSpacing: "0.12em",
          }}
        >
          SIGNAL LEGEND
        </div>

        {[
          [THEME.green, "Healthy (80%+)"],
          [THEME.amber, "Warning (60-79%)"],
          [THEME.red, "Critical (<60%)"],
        ].map(([color, label]) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginBottom: 4,
              fontSize: 10,
              color: THEME.muted,
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            {label}
          </div>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: FONT.mono,
          fontSize: 10,
          color: "#86EFAC",
          padding: "8px 10px",
          borderRadius: 999,
          border: "1px solid rgba(34,197,94,0.16)",
          background: "rgba(34,197,94,0.08)",
        }}
      >
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: THEME.green,
            animation: "al-live 1.5s ease-in-out infinite",
          }}
        />
        LIVE GOVERNANCE FLOW
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function LandingPageClient() {
  const pillars = [
    {
      k: "01",
      Icon: Shield,
      title: "Governance Control",
      desc: "Structured approvals, traceable decisions, delegated authority and boardroom-grade control.",
      bullets: ["Multi-step approvals", "Decision audit trail", "Delegated governance"],
    },
    {
      k: "02",
      Icon: Zap,
      title: "Delivery Intelligence",
      desc: "AI risk signals, milestone visibility and executive insight before issues escalate.",
      bullets: ["AI risk signals", "Milestone visibility", "Weekly executive summaries"],
    },
    {
      k: "03",
      Icon: BarChart3,
      title: "Financial Oversight",
      desc: "Budget, forecast and actuals brought together with early variance detection.",
      bullets: ["Budget vs forecast vs actual", "Variance detection", "Change impact visibility"],
    },
    {
      k: "04",
      Icon: Users,
      title: "Resource Command",
      desc: "Capacity heatmaps, allocation pressure and clearer forward planning across programmes.",
      bullets: ["Capacity heatmaps", "Allocation pressure", "Forward planning insight"],
    },
    {
      k: "05",
      Icon: Brain,
      title: "AI Governance Brain",
      desc: "Natural-language insight, AI summaries and due-soon prompts across the delivery estate.",
      bullets: ["Natural-language insights", "AI-generated summaries", "Due-soon prompts"],
    },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth}
        body{
          background:${THEME.bg0};
          color:${THEME.text};
          font-family:${FONT.body};
          -webkit-font-smoothing:antialiased;
          overflow-x:hidden;
        }
        a{color:inherit;text-decoration:none}

        @keyframes al-twinkle{from{opacity:0.14}to{opacity:0.86}}
        @keyframes al-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        @keyframes al-live{0%,100%{opacity:1}50%{opacity:0.28}}
        @keyframes al-glow{0%,100%{box-shadow:0 0 28px rgba(0,194,232,0.12)}50%{box-shadow:0 0 54px rgba(0,194,232,0.26)}}
        @keyframes al-fadeup{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}

        .al-f1{animation:al-fadeup .7s .05s both}
        .al-f2{animation:al-fadeup .7s .15s both}
        .al-f3{animation:al-fadeup .7s .25s both}
        .al-f4{animation:al-fadeup .7s .35s both}
        .al-f5{animation:al-fadeup .7s .45s both}

        .tg{
          background:linear-gradient(135deg,${THEME.cyan} 0%,${THEME.cyanLt} 100%);
          -webkit-background-clip:text;
          -webkit-text-fill-color:transparent;
          background-clip:text;
        }

        .al-shell{
          width:100%;
          max-width:1280px;
          margin:0 auto;
          padding:0 28px;
        }

        .al-kicker{
          font-size:11px;
          color:${THEME.cyanLt};
          font-family:${FONT.mono};
          letter-spacing:.14em;
          text-transform:uppercase;
          margin-bottom:12px;
        }

        .al-h2{
          font-family:${FONT.display};
          font-size:clamp(32px,4.5vw,58px);
          line-height:.98;
          letter-spacing:-.045em;
          font-weight:700;
          margin-bottom:18px;
        }

        .al-sub{
          font-size:17px;
          line-height:1.8;
          color:${THEME.muted};
          max-width:700px;
        }

        .al-card{
          border-radius:22px;
          border:1px solid ${THEME.line};
          background:rgba(255,255,255,0.03);
          box-shadow:0 10px 30px rgba(0,0,0,0.18);
          transition:border-color .25s, transform .25s, box-shadow .25s;
        }
        .al-card:hover{
          border-color:${THEME.lineCyan};
          transform:translateY(-4px);
          box-shadow:0 24px 60px rgba(0,0,0,0.28);
        }

        .al-btn{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          padding:12px 22px;
          border-radius:12px;
          font-size:14px;
          font-weight:600;
          cursor:pointer;
          transition:all .2s;
          border:none;
          white-space:nowrap;
          font-family:${FONT.body};
        }
        .al-btn:hover{transform:translateY(-1px)}

        .al-btn-p{
          background:linear-gradient(135deg,${THEME.cyan},${THEME.cyanLt});
          color:#031018;
          box-shadow:0 0 24px rgba(0,194,232,0.2);
        }
        .al-btn-p:hover{box-shadow:0 0 42px rgba(0,194,232,0.34)}

        .al-btn-g{
          background:rgba(255,255,255,0.045);
          color:${THEME.text};
          border:1px solid rgba(255,255,255,0.1)!important;
        }
        .al-btn-g:hover{background:rgba(255,255,255,0.08)}

        .al-btn-o{
          background:transparent;
          color:${THEME.text};
          border:1px solid rgba(0,194,232,0.28)!important;
        }
        .al-btn-o:hover{
          background:rgba(0,194,232,0.07);
          border-color:${THEME.cyan}!important;
        }

        .al-btn-lg{padding:14px 28px;font-size:15px;border-radius:14px}

        .chip{
          padding:8px 13px;
          border-radius:999px;
          border:1px solid rgba(255,255,255,0.08);
          background:rgba(255,255,255,0.03);
          color:${THEME.muted};
          font-size:12px;
        }

        .hero-panel{
          background:rgba(8,12,20,0.88);
          backdrop-filter:blur(28px);
          -webkit-backdrop-filter:blur(28px);
          border:1px solid rgba(255,255,255,0.1);
          border-radius:24px;
          box-shadow:0 32px 90px rgba(0,0,0,0.55);
          animation:al-glow 4s 2s ease-in-out infinite;
          overflow:hidden;
        }

        .hero-grid{display:grid;grid-template-columns:1.02fr .98fr;gap:54px;align-items:center}
        .pillars-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
        .three-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
        .ontology-grid{display:grid;grid-template-columns:280px 1fr;gap:20px}

        @media(max-width:1100px){
          .hero-r{display:none!important}
          .hero-grid,.pillars-grid,.three-grid,.ontology-grid{grid-template-columns:1fr!important}
        }
        @media(max-width:768px){
          .nav-links{display:none!important}
          .hero-actions{display:grid!important;width:100%}
          .al-btn{width:100%}
        }
      `}</style>

      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          background: "rgba(4,7,12,0.7)",
          borderBottom: `1px solid ${THEME.line}`,
        }}
      >
        <div
          className="al-shell"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            paddingTop: 14,
            paddingBottom: 14,
          }}
        >
          <a href="/">
            <Logo size="md" />
          </a>

          <div className="nav-links" style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {["Platform", "Intelligence"].map((label) => (
              <a
                key={label}
                href={`#${label.toLowerCase()}`}
                style={{
                  fontSize: 13,
                  color: THEME.muted,
                  fontWeight: 500,
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = THEME.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = THEME.muted;
                }}
              >
                {label}
              </a>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <a href="/login" className="al-btn al-btn-g">
              Sign in
            </a>
            <a href="mailto:support@aliena.co.uk" className="al-btn al-btn-p">
              Book a demo
            </a>
          </div>
        </div>
      </nav>

      <section
        style={{
          position: "relative",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          paddingTop: 88,
          overflow: "hidden",
          background:
            "radial-gradient(ellipse at 68% 45%,rgba(0,194,232,0.08) 0%,transparent 55%),radial-gradient(ellipse at 92% 12%,rgba(87,231,255,0.05) 0%,transparent 28%),linear-gradient(180deg,#03050A 0%,#07101B 100%)",
        }}
      >
        <Starfield density={1} />

        <div
          aria-hidden
          style={{
            position: "absolute",
            right: "-4%",
            top: "50%",
            transform: "translateY(-50%)",
            width: "52vw",
            maxWidth: 760,
            aspectRatio: "1",
            opacity: 0.05,
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          <img
            src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain", filter: "blur(2px)" }}
          />
        </div>

        <div className="al-shell" style={{ position: "relative", zIndex: 2 }}>
          <div className="hero-grid" style={{ minHeight: "calc(100vh - 88px)", padding: "60px 0" }}>
            <div>
              <div
                className="al-f1"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: `1px solid ${THEME.lineCyan}`,
                  background: "rgba(0,194,232,0.08)",
                  color: THEME.cyanLt,
                  fontSize: 11,
                  fontFamily: FONT.mono,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 24,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: THEME.cyan,
                    boxShadow: `0 0 10px ${THEME.cyan}`,
                    display: "inline-block",
                  }}
                />
                AI governance platform for programme delivery
              </div>

              <h1 className="al-f2" style={{ marginBottom: 22 }}>
                <span
                  style={{
                    fontFamily: FONT.body,
                    fontSize: "clamp(30px,4vw,54px)",
                    lineHeight: 1.06,
                    letterSpacing: "-0.03em",
                    fontWeight: 300,
                    display: "block",
                    color: "rgba(245,248,252,0.82)",
                  }}
                >
                  Govern complex delivery with an
                </span>
                <span
                  style={{
                    fontFamily: FONT.display,
                    fontSize: "clamp(40px,5.5vw,78px)",
                    lineHeight: 0.94,
                    letterSpacing: "-0.055em",
                    fontWeight: 700,
                    display: "block",
                    marginTop: 4,
                  }}
                >
                  <span className="tg">AI-native</span> control layer
                </span>
              </h1>

              <p
                className="al-f3"
                style={{
                  fontSize: 18,
                  lineHeight: 1.8,
                  color: THEME.muted,
                  maxWidth: 560,
                  marginBottom: 34,
                }}
              >
                Aliena AI brings approvals, RAID, financial oversight, resource planning and
                executive reporting into one boardroom-grade operating system for PMOs, delivery
                leaders and regulated organisations.
              </p>

              <div
                className="al-f4 hero-actions"
                style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}
              >
                <a href="/login" className="al-btn al-btn-p al-btn-lg">
                  Start pilot <ArrowRight size={16} />
                </a>
                <a href="mailto:support@aliena.co.uk" className="al-btn al-btn-o al-btn-lg">
                  Talk to Aliena
                </a>
              </div>

              <div className="al-f5" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
                {["Executive Cockpit", "Governance Hub", "AI Risk Signals", "Audit-ready workflows"].map(
                  (pill) => (
                    <span key={pill} className="chip">
                      {pill}
                    </span>
                  )
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                  gap: 12,
                  maxWidth: 620,
                }}
              >
                {[
                  { n: "17", l: "active projects" },
                  { n: "4", l: "approvals escalated" },
                  { n: "91%", l: "governance compliance" },
                ].map((metric) => (
                  <div
                    key={metric.l}
                    style={{
                      padding: "14px 16px",
                      borderRadius: 18,
                      background: "rgba(255,255,255,0.035)",
                      border: `1px solid ${THEME.lineStrong}`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: FONT.display,
                        fontWeight: 700,
                        fontSize: 26,
                        lineHeight: 1,
                        marginBottom: 6,
                        color: THEME.text,
                      }}
                    >
                      {metric.n}
                    </div>
                    <div style={{ color: THEME.muted, fontSize: 12, lineHeight: 1.4 }}>{metric.l}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hero-r" style={{ position: "relative", height: 620 }}>
              {[320, 440, 560].map((radius, index) => (
                <div
                  key={radius}
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: radius,
                    height: radius,
                    borderRadius: "50%",
                    border: `1px solid rgba(0,194,232,${0.07 - index * 0.02})`,
                    transform: "translate(-50%,-50%)",
                    animation: `al-float ${8 + index * 2}s ${index * 1.5}s ease-in-out infinite`,
                  }}
                />
              ))}

              <div
                className="hero-panel"
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  width: 470,
                  zIndex: 2,
                }}
              >
                <div
                  style={{
                    padding: "13px 16px",
                    borderBottom: `1px solid ${THEME.line}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <div style={{ display: "flex", gap: 6 }}>
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: "50%",
                          background: "rgba(255,255,255,0.25)",
                          display: "inline-block",
                        }}
                      />
                    ))}
                  </div>

                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 10,
                      color: THEME.muted2,
                      letterSpacing: "0.08em",
                    }}
                  >
                    ALIENA EXECUTIVE COCKPIT
                  </span>

                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${THEME.lineCyan}`,
                      color: THEME.cyanLt,
                      background: "rgba(0,194,232,0.08)",
                      fontFamily: FONT.mono,
                      fontSize: 10,
                    }}
                  >
                    LIVE
                  </span>
                </div>

                <div style={{ padding: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
                    {[
                      { v: "17", l: "active projects", c: THEME.cyanLt },
                      { v: "4", l: "approvals escalated", c: THEME.amber },
                      { v: "1.2m", l: "variance flagged", c: THEME.green },
                    ].map((metric) => (
                      <div
                        key={metric.v + metric.l}
                        style={{
                          padding: 13,
                          borderRadius: 16,
                          background: "rgba(255,255,255,0.04)",
                          border: `1px solid ${THEME.line}`,
                        }}
                      >
                        <div
                          style={{
                            fontFamily: FONT.display,
                            fontSize: 24,
                            fontWeight: 700,
                            lineHeight: 1,
                            marginBottom: 6,
                            color: metric.c,
                          }}
                        >
                          {metric.v}
                        </div>
                        <div style={{ fontSize: 11, color: THEME.muted, lineHeight: 1.4 }}>{metric.l}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                    {[
                      ["Budget control", 86],
                      ["Milestone health", 78],
                      ["Approval compliance", 91],
                      ["Resource readiness", 73],
                    ].map(([label, value]) => (
                      <div
                        key={label as string}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "118px 1fr 38px",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: 11, color: THEME.muted }}>{label}</span>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.08)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${value}%`,
                              borderRadius: 999,
                              background: "linear-gradient(90deg,#00C2E8,#57E7FF)",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            color: THEME.text,
                            textAlign: "right",
                            fontFamily: FONT.mono,
                          }}
                        >
                          {value}%
                        </span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gap: 9 }}>
                    {[
                      {
                        t: "APPROVAL FLOW",
                        b: "Needs review",
                        tx: "One financial plan is 5 days outside target SLA.",
                      },
                      {
                        t: "BUDGET VARIANCE",
                        b: "Emerging",
                        tx: "Forecast overrun trend in Q3 unless scope is adjusted.",
                      },
                      {
                        t: "RESOURCE LOAD",
                        b: "Pressure",
                        tx: "Delivery leadership is over-allocated across two programmes.",
                      },
                    ].map((signal) => (
                      <div
                        key={signal.t}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.03)",
                          border: `1px solid ${THEME.line}`,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 6,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10,
                              color: THEME.cyanLt,
                              fontFamily: FONT.mono,
                              letterSpacing: "0.06em",
                            }}
                          >
                            {signal.t}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              color: "#FDE68A",
                              background: "rgba(234,179,8,0.1)",
                              border: "1px solid rgba(234,179,8,0.2)",
                              padding: "2px 8px",
                              borderRadius: 999,
                            }}
                          >
                            {signal.b}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: THEME.text, lineHeight: 1.55 }}>{signal.tx}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div
                style={{
                  position: "absolute",
                  right: 10,
                  bottom: 34,
                  width: 184,
                  padding: 14,
                  borderRadius: 18,
                  background: "rgba(8,12,20,0.9)",
                  border: `1px solid ${THEME.lineStrong}`,
                  backdropFilter: "blur(18px)",
                  boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
                }}
              >
                <div
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 10,
                    color: THEME.purple,
                    letterSpacing: "0.1em",
                    marginBottom: 8,
                  }}
                >
                  AI INSIGHT
                </div>
                <div
                  style={{
                    fontFamily: FONT.display,
                    fontSize: 15,
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  Governance pressure emerging
                </div>
                <div style={{ fontSize: 12, color: THEME.muted, lineHeight: 1.55 }}>
                  2 approvals and 1 milestone now influence portfolio confidence.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div
        style={{
          borderTop: `1px solid rgba(255,255,255,0.05)`,
          borderBottom: `1px solid rgba(255,255,255,0.05)`,
          background: "rgba(255,255,255,0.015)",
          padding: "16px 28px",
        }}
      >
        <div
          className="al-shell"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            justifyContent: "center",
          }}
        >
          {[
            "Built in the UK",
            "Row-level security",
            "Governance-ready workflows",
            "Audit-grade decision trails",
            "AI-assisted oversight",
          ].map((item) => (
            <span key={item} className="chip">
              {item}
            </span>
          ))}
        </div>
      </div>

      <section
        style={{
          padding: "104px 0",
          background: "linear-gradient(180deg,#07101B 0%,#04080F 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div className="al-shell">
          <div className="al-kicker">The problem</div>
          <h2 className="al-h2" style={{ maxWidth: 860 }}>
            Most PMOs don&apos;t suffer from lack of effort.
            <br />
            They suffer from <span className="tg">fragmented control.</span>
          </h2>

          <p className="al-sub" style={{ marginBottom: 40 }}>
            Delivery teams work hard, but governance breaks when planning, decisions, risks,
            approvals and reporting live across too many disconnected places.
          </p>

          <div className="three-grid" style={{ marginBottom: 24 }}>
            {[
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
            ].map((problem) => (
              <div key={problem.title} className="al-card" style={{ padding: 30 }}>
                <h3
                  style={{
                    fontFamily: FONT.display,
                    fontSize: 22,
                    marginBottom: 12,
                    lineHeight: 1.1,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {problem.title}
                </h3>
                <p style={{ color: THEME.muted, fontSize: 15, lineHeight: 1.75 }}>{problem.desc}</p>
              </div>
            ))}
          </div>

          <div
            style={{
              padding: "30px 32px",
              borderRadius: 24,
              border: "1px solid rgba(0,194,232,0.14)",
              background:
                "linear-gradient(135deg,rgba(0,194,232,0.08) 0%,rgba(255,255,255,0.02) 100%)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            <div style={{ maxWidth: 760 }}>
              <div
                style={{
                  fontFamily: FONT.display,
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: "-0.04em",
                  marginBottom: 8,
                }}
              >
                Aliena turns delivery operations into a governed intelligence system.
              </div>
              <div style={{ color: THEME.muted, fontSize: 15, lineHeight: 1.8 }}>
                One control layer for programme oversight, one source of truth for governance, and
                one AI brain to help leaders act before issues escalate.
              </div>
            </div>

            <a href="#platform" className="al-btn al-btn-p al-btn-lg">
              Explore the platform <ChevronRight size={16} />
            </a>
          </div>
        </div>
      </section>

      <section
        id="platform"
        style={{
          position: "relative",
          padding: "108px 0",
          overflow: "hidden",
          background: "#020507",
        }}
      >
        <Starfield density={0.6} />

        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            backgroundImage:
              "repeating-linear-gradient(0deg,transparent,transparent 38px,rgba(0,194,232,0.03) 38px,rgba(0,194,232,0.03) 39px),repeating-linear-gradient(60deg,transparent,transparent 38px,rgba(0,194,232,0.025) 38px,rgba(0,194,232,0.025) 39px)",
            maskImage: "linear-gradient(to bottom right,rgba(0,0,0,0.4) 0%,transparent 70%)",
            WebkitMaskImage:
              "linear-gradient(to bottom right,rgba(0,0,0,0.4) 0%,transparent 70%)",
          }}
        />

        <div className="al-shell" style={{ position: "relative", zIndex: 1 }}>
          <div style={{ maxWidth: 650, marginBottom: 48 }}>
            <div className="al-kicker">Platform pillars</div>
            <h2 className="al-h2">
              Five pillars.
              <br />
              <span className="tg">One control layer.</span>
            </h2>
            <p className="al-sub">
              Built to replace fragmented tools with a governed, AI-assisted delivery system.
            </p>
          </div>

          <div className="pillars-grid">
            {pillars.map((pillar) => (
              <div
                key={pillar.k}
                style={{
                  padding: "30px 28px",
                  borderRadius: 22,
                  border: `1px solid ${THEME.line}`,
                  background: "rgba(5,9,14,0.82)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  position: "relative",
                  overflow: "hidden",
                  transition: "border-color 0.25s, transform 0.25s, box-shadow 0.25s",
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.borderColor = "rgba(0,194,232,0.22)";
                  el.style.transform = "translateY(-3px)";
                  el.style.boxShadow = "0 24px 60px rgba(0,0,0,0.28)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.borderColor = THEME.line;
                  el.style.transform = "translateY(0)";
                  el.style.boxShadow = "none";
                }}
              >
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: "linear-gradient(90deg,transparent,rgba(87,231,255,0.5),transparent)",
                  }}
                />

                <div
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 11,
                    color: THEME.cyanLt,
                    marginBottom: 14,
                    letterSpacing: "0.1em",
                  }}
                >
                  {pillar.k}
                </div>

                <div style={{ marginBottom: 16, color: THEME.cyan }}>
                  <pillar.Icon size={22} />
                </div>

                <div
                  style={{
                    fontFamily: FONT.display,
                    fontSize: 24,
                    letterSpacing: "-0.04em",
                    marginBottom: 10,
                  }}
                >
                  {pillar.title}
                </div>

                <div
                  style={{
                    color: THEME.muted,
                    fontSize: 14,
                    lineHeight: 1.75,
                    marginBottom: 18,
                  }}
                >
                  {pillar.desc}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {pillar.bullets.map((bullet) => (
                    <div
                      key={bullet}
                      style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13 }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "rgba(34,197,94,0.1)",
                          border: "1px solid rgba(34,197,94,0.2)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: THEME.green,
                          fontSize: 11,
                          flexShrink: 0,
                          marginTop: 1,
                        }}
                      >
                       >
                        &#10003;
                      </span>
                                            {bullet}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div
              style={{
                padding: 30,
                borderRadius: 22,
                border: "1px solid rgba(0,194,232,0.15)",
                background:
                  "linear-gradient(135deg,rgba(0,194,232,0.07) 0%,rgba(255,255,255,0.02) 100%)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                textAlign: "center",
                gap: 14,
              }}
            >
              <Sparkles size={28} color={THEME.cyan} />
              <div
                style={{
                  fontFamily: FONT.display,
                  fontSize: 23,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                }}
              >
                Ready to see it live?
              </div>
              <div style={{ color: THEME.muted, fontSize: 14, lineHeight: 1.7, maxWidth: 230 }}>
                Book a leadership demo and see Aliena in your delivery context.
              </div>
              <a href="mailto:support@aliena.co.uk" className="al-btn al-btn-p" style={{ marginTop: 4 }}>
                Book demo <ArrowRight size={14} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        id="intelligence"
        style={{
          position: "relative",
          padding: "110px 0",
          overflow: "hidden",
          background:
            "radial-gradient(circle at 20% 20%, rgba(0,194,232,0.06) 0%, transparent 30%), linear-gradient(180deg, #020408 0%, #03060B 100%)",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.65), rgba(0,0,0,0.08))",
            WebkitMaskImage:
              "linear-gradient(to bottom, rgba(0,0,0,0.65), rgba(0,0,0,0.08))",
            pointerEvents: "none",
          }}
        />

        <div className="al-shell" style={{ position: "relative", zIndex: 1 }}>
          <div
            className="ontology-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 420px) minmax(0, 1fr)",
              gap: 24,
              alignItems: "stretch",
            }}
          >
            <div
              style={{
                borderRadius: 28,
                border: `1px solid ${THEME.lineStrong}`,
                background:
                  "linear-gradient(180deg, rgba(10,14,22,0.96) 0%, rgba(6,9,15,0.92) 100%)",
                boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
                padding: 28,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: 620,
              }}
            >
              <div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(168,85,247,0.24)",
                    background: "rgba(168,85,247,0.08)",
                    marginBottom: 18,
                  }}
                >
                  <Sparkles size={14} color={THEME.purple} />
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 10,
                      color: "#D8B4FE",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    Governance Intelligence
                  </span>
                </div>

                <h2
                  style={{
                    fontFamily: FONT.display,
                    fontSize: "clamp(34px,4.5vw,56px)",
                    lineHeight: 0.98,
                    letterSpacing: "-0.05em",
                    fontWeight: 700,
                    marginBottom: 16,
                  }}
                >
                  Delivery ontology,
                  <br />
                  <span className="tg">made executive.</span>
                </h2>

                <p
                  style={{
                    color: THEME.muted,
                    fontSize: 16,
                    lineHeight: 1.8,
                    marginBottom: 26,
                    maxWidth: 360,
                  }}
                >
                  Aliena connects approvals, RAID, finance, milestones, resources and AI governance
                  into one live operating picture so leaders can see pressure before it becomes
                  failure.
                </p>

                <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
                  {[
                    {
                      title: "Live governance graph",
                      desc: "Every node contributes to one connected delivery model.",
                      color: THEME.cyan,
                    },
                    {
                      title: "Health scoring",
                      desc: "Critical pressure points are surfaced automatically.",
                      color: THEME.green,
                    },
                    {
                      title: "AI synthesis",
                      desc: "Signals converge into one intelligence layer for action.",
                      color: THEME.purple,
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      style={{
                        padding: "14px 14px 14px 16px",
                        borderRadius: 18,
                        border: `1px solid ${THEME.line}`,
                        background: "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginBottom: 6,
                        }}
                      >
                        <div
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: "50%",
                            background: item.color,
                            boxShadow: `0 0 14px ${item.color}`,
                            flexShrink: 0,
                          }}
                        />
                        <div
                          style={{
                            fontFamily: FONT.display,
                            fontSize: 15,
                            fontWeight: 600,
                            color: THEME.text,
                            letterSpacing: "-0.02em",
                          }}
                        >
                          {item.title}
                        </div>
                      </div>
                      <div
                        style={{
                          color: THEME.muted,
                          fontSize: 13,
                          lineHeight: 1.65,
                          paddingLeft: 19,
                        }}
                      >
                        {item.desc}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${THEME.line}`, paddingTop: 18 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,1fr)",
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  {[
                    { v: "11", l: "nodes" },
                    { v: "15", l: "connections" },
                    { v: "84%", l: "health" },
                  ].map((metric) => (
                    <div
                      key={metric.l}
                      style={{
                        padding: "14px 10px",
                        borderRadius: 16,
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid ${THEME.line}`,
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: FONT.display,
                          fontSize: 22,
                          fontWeight: 700,
                          lineHeight: 1,
                          color: THEME.text,
                          marginBottom: 6,
                        }}
                      >
                        {metric.v}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: THEME.muted2,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          fontFamily: FONT.mono,
                        }}
                      >
                        {metric.l}
                      </div>
                    </div>
                  ))}
                </div>

                <a
                  href="mailto:support@aliena.co.uk"
                  className="al-btn al-btn-p"
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Explore governance intelligence <ArrowRight size={14} />
                </a>
              </div>
            </div>

            <div
              style={{
                position: "relative",
                borderRadius: 30,
                border: `1px solid ${THEME.lineStrong}`,
                background:
                  "linear-gradient(180deg, rgba(8,12,20,0.96) 0%, rgba(5,8,14,0.94) 100%)",
                boxShadow: "0 40px 100px rgba(0,0,0,0.5)",
                overflow: "hidden",
                minHeight: 620,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "18px 22px",
                  borderBottom: `1px solid ${THEME.line}`,
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 12,
                      background:
                        "linear-gradient(135deg, rgba(0,194,232,0.18), rgba(168,85,247,0.18))",
                      border: `1px solid ${THEME.line}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: THEME.cyan,
                      flexShrink: 0,
                    }}
                  >
                    <Cpu size={16} />
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: FONT.display,
                        fontSize: 16,
                        fontWeight: 600,
                        color: THEME.text,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      Governance ontology map
                    </div>
                    <div
                      style={{
                        fontFamily: FONT.mono,
                        fontSize: 10,
                        color: THEME.muted2,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        marginTop: 2,
                      }}
                    >
                      Connected intelligence across the delivery estate
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(34,197,94,0.18)",
                    background: "rgba(34,197,94,0.08)",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: THEME.green,
                      animation: "al-live 1.5s ease-in-out infinite",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 10,
                      color: "#86EFAC",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Live
                  </span>
                </div>
              </div>

              <div style={{ padding: 20, position: "relative" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0,1fr))",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  {[
                    { label: "AI signals", value: "27", tone: THEME.purple },
                    { label: "At-risk areas", value: "3", tone: THEME.amber },
                    { label: "Governed flow", value: "84%", tone: THEME.cyan },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        padding: 14,
                        borderRadius: 18,
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid ${THEME.line}`,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: FONT.mono,
                          fontSize: 10,
                          color: THEME.muted2,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        {item.label}
                      </div>
                      <div
                        style={{
                          fontFamily: FONT.display,
                          fontSize: 28,
                          lineHeight: 1,
                          fontWeight: 700,
                          color: item.tone,
                          letterSpacing: "-0.04em",
                        }}
                      >
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    borderRadius: 24,
                    border: `1px solid ${THEME.line}`,
                    background:
                      "radial-gradient(circle at 50% 20%, rgba(0,194,232,0.05) 0%, transparent 30%), rgba(4,8,14,0.8)",
                    padding: 16,
                    minHeight: 500,
                  }}
                >
                  <GovernanceGraph />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}