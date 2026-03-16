"use client";

import { useEffect, useRef, useState } from "react";
import { GovernanceIntelligenceSection } from "@/components/GovernanceIntelligenceSection";
import {
  ArrowRight, Shield, Zap, BarChart3, Users, Brain,
  CheckCircle2, AlertTriangle, TrendingUp, Lock,
  ChevronRight, Sparkles, Activity,
} from "lucide-react";

/* --- Logo --------------------------------------------------- */
function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sz = { sm: 28, md: 36, lg: 52 }[size];
  const tx = { sm: "text-base", md: "text-xl", lg: "text-3xl" }[size];
  const letters = ["?", "L", "I", "?", "N", "?"];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <img
        src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png "
        alt="Aliena"
        width={sz} height={sz}
        style={{ objectFit: "contain", borderRadius: 8 }}
      />
      <span className={`font-bold ${tx}`} style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.18em" }}>
        {letters.map((l, i) => (
          <span key={i} style={{ color: i === 0 || i === 2 || i === 5 ? "#00B8DB" : "inherit" }}>{l}</span>
        ))}
      </span>
    </span>
  );
}

/* --- Starfield ----------------------------------------------- */
function Starfield({ count = 60 }: { count?: number }) {
  const stars = Array.from({ length: count }, (_, i) => ({
    id: i,
    x: (i * 17 + 7) % 100,
    y: (i * 23 + 11) % 100,
    size: i % 3 === 0 ? 2 : 1,
    delay: (i * 0.15) % 4,
    dur: 2 + (i % 3),
  }));
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {stars.map(s => (
        <div key={s.id} style={{
          position: "absolute", left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size, borderRadius: "50%",
          background: "white", opacity: 0.6,
          animation: `twinkle ${s.dur}s ${s.delay}s infinite alternate`,
        }} />
      ))}
    </div>
  );
}

/* --- Main Component ------------------------------------------ */
export default function LandingPageClient() {
  const [scrollY, setScrollY] = useState(0);
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const trust = ["Built in the UK", "Row-level security", "Governance-ready workflows", "Audit-grade decision trails", "AI-assisted oversight"];

  const pillars = [
    { k: "01", icon: Shield, title: "Governance Control", short: "Structured approvals, traceable decisions, delegated authority.", bullets: ["Multi-step approvals", "Decision audit trail", "Delegated governance"] },
    { k: "02", icon: Zap, title: "Delivery Intelligence", short: "AI risk signals, milestone visibility, weekly executive summaries.", bullets: ["AI risk signals", "Milestone visibility", "Weekly executive summaries"] },
    { k: "03", icon: BarChart3, title: "Financial Oversight", short: "Budget vs forecast vs actual with variance detection.", bullets: ["Budget vs forecast vs actual", "Variance detection", "Change impact visibility"] },
    { k: "04", icon: Users, title: "Resource Command", short: "Capacity heatmaps, allocation pressure, forward planning.", bullets: ["Capacity heatmaps", "Allocation pressure", "Forward planning insight"] },
    { k: "05", icon: Brain, title: "AI Governance Brain", short: "Natural language insights, AI-generated summaries, due-soon prompts.", bullets: ["Natural language insights", "AI-generated summaries", "Due-soon governance prompts"] },
  ];

  const outcomes = [
    { value: "Faster", label: "approval turnaround" },
    { value: "Earlier", label: "risk detection" },
    { value: "Stronger", label: "auditability" },
    { value: "Clearer", label: "executive reporting" },
  ];

  const audiences = [
    { title: "Enterprise PMOs", desc: "Gain portfolio-level visibility, governance discipline and leadership-ready reporting across complex delivery estates." },
    { title: "Public Sector & Regulated Delivery", desc: "Support accountability, decision traceability and structured oversight without adding operational drag." },
    { title: "Transformation & Delivery Leaders", desc: "Run programmes with one AI-powered control layer spanning risks, approvals, milestones, commercials and resourcing." },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --cyan: #00B8DB; --cyan-lt: #4DE3FF; --green: #22C55E;
          --amber: #EAB308; --purple: #A855F7; --red: #EF4444;
          --bg: #05070A; --text: #F2F5FA; --muted: #99A6B7; --muted2: #5A6475;
          --line: rgba(255,255,255,0.07); --line2: rgba(0,184,219,0.18);
          --glass: rgba(11,15,22,0.72); --glass2: rgba(255,255,255,0.04);
          --sans: 'Inter', system-ui, sans-serif;
          --display: 'Space Grotesk', sans-serif;
          --mono: 'IBM Plex Mono', monospace;
          --max: 1280px;
        }

        html { scroll-behavior: smooth; }
        body { background: var(--bg); color: var(--text); font-family: var(--sans); -webkit-font-smoothing: antialiased; overflow-x: hidden; }
        a { color: inherit; text-decoration: none; }

        @keyframes twinkle { from { opacity: 0.2; } to { opacity: 0.9; } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
        @keyframes pulse-ring { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.4); opacity: 0; } }
        @keyframes data-flow { 0% { transform: translateX(0); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateX(100%); opacity: 0; } }
        @keyframes scanline { 0% { top: 0; } 100% { top: 100%; } }
        @keyframes fade-up { from { opacity: 0; transform: translateY(32px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes glow-pulse { 0%,100% { box-shadow: 0 0 20px rgba(0,184,219,0.15); } 50% { box-shadow: 0 0 40px rgba(0,184,219,0.35); } }

        .shell { width: 100%; max-width: var(--max); margin: 0 auto; padding: 0 28px; }

        /* NAV */
        .nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          background: rgba(5,7,10,0.72);
          border-bottom: 1px solid var(--line);
          transition: border-color 0.3s;
        }
        .nav-inner {
          display: flex; align-items: center; justify-content: space-between;
          gap: 24px; padding: 16px 28px; max-width: var(--max); margin: 0 auto;
        }
        .nav-links { display: flex; align-items: center; gap: 28px; }
        .nav-link { font-size: 13px; color: var(--muted); transition: color 0.2s; font-weight: 500; }
        .nav-link:hover { color: var(--text); }
        .nav-actions { display: flex; align-items: center; gap: 10px; }

        .btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 600;
          transition: all 0.2s; cursor: pointer; white-space: nowrap; border: none;
        }
        .btn:hover { transform: translateY(-1px); }
        .btn-ghost { background: rgba(255,255,255,0.05); color: var(--text); border: 1px solid var(--line); }
        .btn-ghost:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.14); }
        .btn-primary {
          background: linear-gradient(135deg, var(--cyan) 0%, var(--cyan-lt) 100%);
          color: #061018; box-shadow: 0 0 24px rgba(0,184,219,0.22);
        }
        .btn-primary:hover { box-shadow: 0 0 36px rgba(0,184,219,0.38); }
        .btn-outline { background: transparent; color: var(--text); border: 1px solid rgba(0,184,219,0.35); }
        .btn-outline:hover { background: rgba(0,184,219,0.08); border-color: var(--cyan); }
        .btn-lg { padding: 14px 28px; font-size: 15px; border-radius: 12px; }

        /* HERO */
        .hero {
          position: relative; min-height: 100vh;
          display: flex; align-items: center; overflow: hidden;
          padding-top: 80px;
          background: radial-gradient(ellipse at 60% 50%, rgba(0,184,219,0.07) 0%, transparent 50%),
            radial-gradient(ellipse at 90% 20%, rgba(77,227,255,0.05) 0%, transparent 30%),
            linear-gradient(180deg, #03050A 0%, #060C14 100%);
        }
        .hero-space-right {
          position: absolute; right: 0; top: 0; bottom: 0; width: 55%;
          overflow: hidden;
        }
        .hero-space-right::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(90deg, #03050A 0%, rgba(3,5,10,0.5) 30%, transparent 100%);
          z-index: 1;
        }
        /* Astronaut silhouette via CSS — swap with <img> for real asset */
        .hero-astronaut {
          position: absolute; right: 5%; top: 50%; transform: translateY(-50%);
          width: 480px; height: 480px; z-index: 0;
          background: radial-gradient(ellipse at 40% 40%, rgba(0,184,219,0.12) 0%, transparent 60%);
          animation: float 8s ease-in-out infinite;
        }
        /* Orbit rings behind astronaut */
        .hero-orbit {
          position: absolute; border-radius: 50%; border: 1px solid rgba(0,184,219,0.1);
          top: 50%; left: 50%; transform: translate(-50%, -50%);
        }

        .hero-content { position: relative; z-index: 2; max-width: 680px; }

        .eyebrow {
          display: inline-flex; align-items: center; gap: 10px;
          padding: 7px 14px; border-radius: 999px;
          border: 1px solid rgba(0,184,219,0.22);
          background: rgba(0,184,219,0.08);
          color: var(--cyan-lt); font-size: 11px;
          font-family: var(--mono); letter-spacing: 0.1em; text-transform: uppercase;
          margin-bottom: 24px;
          animation: fade-up 0.6s ease both;
        }
        .eyebrow-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--cyan); box-shadow: 0 0 10px var(--cyan);
        }

        .hero h1 {
          font-family: var(--display);
          font-size: clamp(48px, 6.5vw, 88px);
          line-height: 0.95; letter-spacing: -0.04em; font-weight: 800;
          margin-bottom: 22px;
          animation: fade-up 0.7s 0.1s ease both;
        }
        .hero h1 .cy { color: var(--cyan-lt); text-shadow: 0 0 30px rgba(0,184,219,0.22); }

        .hero-sub {
          font-size: 18px; line-height: 1.7; color: var(--muted);
          max-width: 560px; margin-bottom: 34px;
          animation: fade-up 0.7s 0.2s ease both;
        }
        .hero-actions {
          display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 32px;
          animation: fade-up 0.7s 0.3s ease both;
        }
        .hero-proof {
          display: flex; flex-wrap: wrap; gap: 8px;
          animation: fade-up 0.7s 0.4s ease both;
        }
        .proof-pill {
          padding: 7px 12px; border-radius: 999px;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.03);
          color: var(--muted); font-size: 12px;
        }

        /* HERO GLASS CARD */
        .hero-glass-card {
          position: absolute; right: 4%; top: 50%; transform: translateY(-50%);
          width: 440px; z-index: 3;
          background: var(--glass);
          backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 22px;
          box-shadow: 0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,184,219,0.08);
          animation: fade-up 0.9s 0.5s ease both, glow-pulse 4s 2s ease-in-out infinite;
          overflow: hidden;
        }
        .glass-card-bar {
          padding: 14px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          display: flex; align-items: center; justify-content: space-between;
          background: rgba(255,255,255,0.02);
        }
        .glass-card-dots { display: flex; gap: 6px; }
        .glass-dot { width: 9px; height: 9px; border-radius: 50%; background: rgba(255,255,255,0.25); }
        .glass-card-title { font-family: var(--mono); font-size: 11px; color: var(--muted2); letter-spacing: 0.08em; }
        .glass-chip {
          padding: 5px 10px; border-radius: 999px;
          border: 1px solid var(--line2);
          color: var(--cyan-lt); background: rgba(0,184,219,0.08);
          font-family: var(--mono); font-size: 10px;
        }
        .glass-card-body { padding: 16px; }

        .cockpit-metrics {
          display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 14px;
        }
        .cockpit-metric {
          padding: 12px; border-radius: 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .cockpit-metric-val {
          font-family: var(--display); font-size: 26px; font-weight: 800;
          line-height: 1; margin-bottom: 5px;
        }
        .cockpit-metric-val.cy { color: #4DE3FF; }
        .cockpit-metric-val.amber { color: #EAB308; }
        .cockpit-metric-val.gr { color: #22C55E; }
        .cockpit-metric-label { font-size: 11px; color: var(--muted); line-height: 1.4; }

        .cockpit-bars { display: grid; gap: 10px; margin-bottom: 14px; }
        .cockpit-bar-row { display: grid; grid-template-columns: 110px 1fr 38px; gap: 8px; align-items: center; }
        .cockpit-bar-name { font-size: 11px; color: var(--muted); }
        .cockpit-bar-track { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.07); overflow: hidden; }
        .cockpit-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #00B8DB, #4DE3FF); }
        .cockpit-bar-val { font-size: 11px; color: var(--text); text-align: right; font-family: var(--mono); }

        .cockpit-signals { display: grid; gap: 8px; }
        .cockpit-signal {
          padding: 10px 12px; border-radius: 12px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .signal-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
        .signal-type { font-size: 10px; color: var(--cyan-lt); font-family: var(--mono); letter-spacing: 0.06em; }
        .signal-badge {
          padding: 3px 8px; border-radius: 999px; font-size: 10px;
          color: #FDE68A; background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.2);
        }
        .signal-text { font-size: 12px; color: var(--text); line-height: 1.5; }

        /* TRUST BAND */
        .trust-band {
          border-top: 1px solid rgba(255,255,255,0.05);
          border-bottom: 1px solid rgba(255,255,255,0.05);
          background: rgba(255,255,255,0.015);
          padding: 16px 28px;
        }
        .trust-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; max-width: var(--max); margin: 0 auto; }
        .trust-pill {
          padding: 9px 14px; border-radius: 999px;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.025); color: var(--muted); font-size: 12px;
        }

        /* SECTION HEADER */
        .section-kicker {
          font-size: 11px; color: var(--cyan-lt); font-family: var(--mono);
          letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 14px;
        }
        .section-title {
          font-family: var(--display); font-size: clamp(32px, 4.5vw, 58px);
          line-height: 1.0; letter-spacing: -0.035em; font-weight: 800;
          margin-bottom: 16px;
        }
        .section-sub {
          font-size: 17px; line-height: 1.75; color: var(--muted); max-width: 680px;
        }
        /* Text Gradient — mirrors global utility */
        .text-gradient {
          background: linear-gradient(135deg, #00B8DB 0%, #4DE3FF 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .text-gradient.gr {
          background: linear-gradient(135deg, #22C55E 0%, #86EFAC 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* .cy/.gr kept for non-gradient uses (borders, icons, etc.) */

        /* PROBLEM SECTION */
        .problem-section {
          padding: 96px 0;
          background: linear-gradient(180deg, #060C14 0%, #04080F 100%);
          position: relative; overflow: hidden;
        }
        .problem-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-top: 36px; }
        .problem-card {
          padding: 28px; border-radius: 20px;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.025);
        }
        .problem-card h3 { font-family: var(--display); font-size: 22px; margin-bottom: 12px; line-height: 1.1; }
        .problem-card p { color: var(--muted); font-size: 15px; line-height: 1.75; }

        .transform-banner {
          margin-top: 24px; padding: 28px 32px;
          border-radius: 20px;
          border: 1px solid rgba(0,184,219,0.15);
          background: linear-gradient(135deg, rgba(0,184,219,0.07) 0%, rgba(255,255,255,0.025) 100%);
          display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap;
        }
        .transform-title { font-family: var(--display); font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 8px; }
        .transform-text { color: var(--muted); font-size: 15px; line-height: 1.7; max-width: 680px; }

        /* PILLARS — full viewport with space BG */
        .pillars-section {
          position: relative; padding: 100px 0; overflow: hidden;
          background: #020507;
        }
        /* Spacecraft silhouette via CSS gradient — swap for real image */
        .pillars-section::before {
          content: '';
          position: absolute; inset: 0; z-index: 0;
          background:
            radial-gradient(ellipse at 15% 60%, rgba(0,184,219,0.04) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 30%, rgba(0,100,120,0.06) 0%, transparent 45%),
            linear-gradient(135deg, rgba(0,30,45,0.6) 0%, rgba(0,10,18,0.95) 60%);
        }
        /* Honeycomb/mesh pattern to simulate spacecraft hull */
        .pillars-section::after {
          content: '';
          position: absolute; top: 0; right: 0; width: 55%; height: 100%; z-index: 0;
          background-image:
            repeating-linear-gradient(0deg, transparent, transparent 38px, rgba(0,184,219,0.04) 38px, rgba(0,184,219,0.04) 39px),
            repeating-linear-gradient(60deg, transparent, transparent 38px, rgba(0,184,219,0.03) 38px, rgba(0,184,219,0.03) 39px),
            repeating-linear-gradient(120deg, transparent, transparent 38px, rgba(0,184,219,0.03) 38px, rgba(0,184,219,0.03) 39px);
          mask-image: linear-gradient(to left, rgba(0,0,0,0.5) 0%, transparent 100%);
        }
        .pillars-inner { position: relative; z-index: 1; }
        .pillars-header { max-width: 640px; margin-bottom: 48px; }
        .pillars-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 16px; }
        .pillar-card {
          padding: 28px 26px; border-radius: 20px;
          border: 1px solid var(--line);
          background: rgba(5,9,14,0.8);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          position: relative; overflow: hidden;
          transition: border-color 0.3s, transform 0.3s;
        }
        .pillar-card::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(77,227,255,0.5), transparent);
        }
        .pillar-card:hover { border-color: rgba(0,184,219,0.2); transform: translateY(-3px); }
        .pillar-num { font-family: var(--mono); font-size: 11px; color: var(--cyan-lt); margin-bottom: 12px; letter-spacing: 0.1em; }
        .pillar-icon { margin-bottom: 14px; color: var(--cyan); }
        .pillar-title { font-family: var(--display); font-size: 24px; letter-spacing: -0.03em; margin-bottom: 10px; }
        .pillar-desc { color: var(--muted); font-size: 14px; line-height: 1.7; margin-bottom: 16px; }
        .bullet-list { display: grid; gap: 8px; }
        .bullet { display: flex; align-items: flex-start; gap: 9px; font-size: 13px; }
        .bullet-mark {
          width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
          background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.2);
          display: flex; align-items: center; justify-content: center;
          color: var(--green); font-size: 11px; margin-top: 1px;
        }

        /* COMPARISON SECTION — space/planet BG */
        .comparison-section {
          position: relative; padding: 96px 0; overflow: hidden;
          background: #020507;
        }
        .comparison-section::before {
          content: ''; position: absolute; inset: 0; z-index: 0;
          background:
            radial-gradient(circle at 75% 60%, rgba(50,20,80,0.3) 0%, transparent 40%),
            radial-gradient(circle at 70% 50%, rgba(0,184,219,0.06) 0%, transparent 35%),
            radial-gradient(circle at 80% 55%, rgba(20,8,40,0.4) 0%, transparent 20%),
            linear-gradient(180deg, #020507 0%, #04060C 100%);
        }
        /* Planet ring effect */
        .planet-decoration {
          position: absolute; right: 5%; top: 50%; transform: translateY(-50%);
          width: 380px; height: 380px; border-radius: 50%; z-index: 0;
          background: radial-gradient(circle at 35% 35%, rgba(50,20,80,0.9) 0%, rgba(10,5,20,0.95) 60%, transparent 100%);
          box-shadow: inset -30px -20px 60px rgba(0,0,0,0.8);
        }
        .planet-ring {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%) rotateX(75deg);
          width: 550px; height: 550px; border-radius: 50%;
          border: 12px solid rgba(77,227,255,0.06);
          box-shadow: 0 0 40px rgba(0,184,219,0.04);
        }
        .comparison-inner { position: relative; z-index: 1; }
        .comparison-glass {
          max-width: 700px;
          background: rgba(8,12,18,0.88);
          backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 24px; overflow: hidden;
          box-shadow: 0 40px 100px rgba(0,0,0,0.5);
        }
        .comparison-header { padding: 20px 24px; border-bottom: 1px solid var(--line); }
        .comparison-title { font-family: var(--display); font-size: 34px; letter-spacing: -0.04em; line-height: 1.05; }
        .comparison-sub { color: var(--muted); font-size: 14px; margin-top: 6px; }
        .comparison-cols { display: grid; grid-template-columns: 1fr 1fr; }
        .compare-col { padding: 20px 24px; }
        .compare-col:first-child { border-right: 1px solid var(--line); }
        .compare-col-head { font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 16px; }
        .compare-col-head.old { color: var(--muted2); }
        .compare-col-head.new { color: var(--cyan-lt); }
        .compare-items { display: grid; gap: 10px; }
        .compare-item { display: flex; align-items: flex-start; gap: 9px; font-size: 14px; line-height: 1.55; }
        .compare-item .icon { flex-shrink: 0; margin-top: 2px; }
        .compare-item.old-item { color: var(--muted); }
        .compare-item.new-item { color: var(--text); }

        /* OUTCOMES */
        .outcomes-section {
          position: relative; padding: 96px 0; overflow: hidden;
          background: linear-gradient(180deg, #04060C 0%, #050810 100%);
        }
        .outcomes-section::before {
          content: ''; position: absolute;
          top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: 800px; height: 400px;
          background: radial-gradient(ellipse, rgba(0,184,219,0.05) 0%, transparent 70%);
          pointer-events: none;
        }
        .outcomes-inner { position: relative; z-index: 1; }
        .outcomes-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin-top: 28px; }
        .outcome-card {
          padding: 28px 20px; border-radius: 20px; text-align: center;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.025);
          transition: border-color 0.3s, transform 0.3s;
        }
        .outcome-card:hover { border-color: rgba(0,184,219,0.2); transform: translateY(-3px); }
        .outcome-value { font-family: var(--display); font-size: 42px; font-weight: 800; line-height: 1; margin-bottom: 10px; }
        .outcome-label { color: var(--muted); font-size: 14px; line-height: 1.6; }

        /* AUDIENCE */
        .audience-section { padding: 96px 0; background: #04060C; }
        .audience-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-top: 32px; }
        .audience-card {
          padding: 28px; border-radius: 20px;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.025);
          transition: border-color 0.3s;
        }
        .audience-card:hover { border-color: rgba(0,184,219,0.15); }
        .audience-card h3 { font-family: var(--display); font-size: 22px; letter-spacing: -0.03em; margin-bottom: 12px; }
        .audience-card p { color: var(--muted); font-size: 15px; line-height: 1.75; }

        /* CTA */
        .cta-section { padding: 100px 0 110px; background: #04060C; }
        .cta-panel {
          border-radius: 28px;
          border: 1px solid rgba(0,184,219,0.15);
          background: radial-gradient(ellipse at top center, rgba(0,184,219,0.10) 0%, transparent 50%),
            rgba(255,255,255,0.03);
          padding: 60px 32px; text-align: center;
          box-shadow: 0 0 80px rgba(0,184,219,0.06);
        }
        .cta-panel h2 { font-family: var(--display); font-size: clamp(36px, 5vw, 60px); line-height: 1.02; letter-spacing: -0.04em; max-width: 860px; margin: 0 auto 18px; }
        .cta-panel p { max-width: 640px; margin: 0 auto 28px; color: var(--muted); font-size: 17px; line-height: 1.8; }
        .cta-actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }

        /* FOOTER */
        .footer {
          border-top: 1px solid rgba(255,255,255,0.05);
          padding: 28px 0 42px; background: #03050A;
        }
        .footer-inner { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
        .footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
        .footer-link { color: var(--muted); font-size: 13px; transition: color 0.2s; }
        .footer-link:hover { color: var(--text); }
        .footer-copy { color: var(--muted2); font-size: 13px; }

        /* HERO TWO-COL (for positioning card) */
        .hero-two-col {
          display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center;
          min-height: calc(100vh - 80px);
          padding: 60px 0;
        }
        .hero-left { position: relative; z-index: 2; }
        .hero-right { position: relative; height: 600px; }

        /* SPACE BG for hero right */
        .hero-right-space {
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse at 60% 40%, rgba(0,184,219,0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 30% 70%, rgba(77,227,255,0.04) 0%, transparent 40%);
          overflow: hidden;
        }
        /* Glow orb */
        .glow-orb {
          position: absolute; border-radius: 50%;
          background: radial-gradient(circle, rgba(0,184,219,0.15) 0%, transparent 70%);
        }

        @media (max-width: 1100px) {
          .hero-two-col { grid-template-columns: 1fr; }
          .hero-right { display: none; }
          .pillars-grid, .problem-grid, .audience-grid { grid-template-columns: 1fr; }
          .outcomes-grid { grid-template-columns: repeat(2,1fr); }
          .comparison-cols { grid-template-columns: 1fr; }
          .planet-decoration, .planet-ring { display: none; }
        }
        @media (max-width: 768px) {
          .nav-links { display: none; }
          .outcomes-grid { grid-template-columns: 1fr 1fr; }
          .hero h1 { font-size: 42px; }
          .cta-panel { padding: 40px 20px; }
        }
        @media (max-width: 500px) {
          .btn-lg, .btn { width: 100%; justify-content: center; }
          .hero-actions, .cta-actions { display: grid; width: 100%; }
          .outcomes-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* NAV */}
      <nav className="nav">
        <div className="nav-inner">
          <a href="/"><Logo size="md" /></a>
          <div className="nav-links">
            <a href="#platform" className="nav-link">Platform</a>
            <a href="#intelligence" className="nav-link">Intelligence</a>
            <a href="#outcomes" className="nav-link">Outcomes</a>
            <a href="#security" className="nav-link">Security</a>
          </div>
          <div className="nav-actions">
            <a href="/login" className="btn btn-ghost">Sign in</a>
            <a href="mailto:hello@aliena.co.uk" className="btn btn-primary">Book a demo</a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section ref={heroRef} className="hero">
        <Starfield count={80} />

        {/* Glow orbs */}
        <div className="glow-orb" style={{ width: 600, height: 600, top: "10%", right: "20%", opacity: 0.6 }} />
        <div className="glow-orb" style={{ width: 300, height: 300, top: "50%", left: "40%", opacity: 0.3 }} />

        <div className="shell" style={{ position: "relative", zIndex: 2 }}>
          <div className="hero-two-col">
            {/* LEFT: copy */}
            <div className="hero-left">
              <div className="eyebrow">
                <span className="eyebrow-dot" />
                AI Governance Platform for Programme Delivery
              </div>
              <h1>
                Govern complex<br />
                delivery with an<br />
                <span className="text-gradient">AI-native</span><br />
                control layer
              </h1>
              <p className="hero-sub">
                Aliena AI brings approvals, RAID, financial oversight, resource planning
                and executive reporting into one boardroom-grade operating system for PMOs,
                delivery leaders and regulated organisations.
              </p>
              <div className="hero-actions">
                <a href="/login" className="btn btn-primary btn-lg">
                  Start pilot <ArrowRight size={16} />
                </a>
                <a href="mailto:hello@aliena.co.uk" className="btn btn-outline btn-lg">
                  Talk to Aliena
                </a>
              </div>
              <div className="hero-proof">
                {["Executive Cockpit", "Governance Hub", "AI Risk Signals", "Audit-ready workflows"].map(p => (
                  <span key={p} className="proof-pill">{p}</span>
                ))}
              </div>
            </div>

            {/* RIGHT: floating glass card */}
            <div className="hero-right">
              <div className="hero-right-space">
                <Starfield count={40} />
                {/* Orbit rings */}
                {[280, 380, 480].map((r, i) => (
                  <div key={r} style={{
                    position: "absolute", top: "50%", left: "50%",
                    width: r, height: r, borderRadius: "50%",
                    border: `1px solid rgba(0,184,219,${0.06 - i * 0.015})`,
                    transform: "translate(-50%, -50%)",
                    animation: `float ${8 + i * 2}s ease-in-out infinite`,
                    animationDelay: `${i * 1.5}s`,
                  }} />
                ))}
              </div>

              {/* Executive Cockpit glass card */}
              <div className="hero-glass-card" style={{ position: "absolute", inset: 0, margin: "auto", width: 420, height: "fit-content", top: "50%", right: "auto", left: "50%", transform: "translate(-50%, -50%)" }}>
                <div className="glass-card-bar">
                  <div className="glass-card-dots">
                    <span className="glass-dot" /><span className="glass-dot" /><span className="glass-dot" />
                  </div>
                  <span className="glass-card-title">ALIENA EXECUTIVE COCKPIT</span>
                  <span className="glass-chip">LIVE</span>
                </div>
                <div className="glass-card-body">
                  <div className="cockpit-metrics">
                    {[
                      { val: "17", label: "active projects", cls: "cy" },
                      { val: "4", label: "approvals escalated", cls: "amber" },
                      { val: "£1.2m", label: "variance flagged", cls: "gr" },
                    ].map(m => (
                      <div key={m.val} className="cockpit-metric">
                        <div className={`cockpit-metric-val ${m.cls}`}>{m.val}</div>
                        <div className="cockpit-metric-label">{m.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="cockpit-bars">
                    {[["Budget control", 86], ["Milestone health", 78], ["Approval compliance", 91], ["Resource readiness", 73]].map(([l, v]) => (
                      <div key={l} className="cockpit-bar-row">
                        <div className="cockpit-bar-name">{l}</div>
                        <div className="cockpit-bar-track"><div className="cockpit-bar-fill" style={{ width: `${v}%` }} /></div>
                        <div className="cockpit-bar-val">{v}%</div>
                      </div>
                    ))}
                  </div>
                  <div className="cockpit-signals">
                    {[
                      { type: "APPROVAL FLOW", badge: "Needs review", text: "One financial plan is waiting on step-two approval and is 5 days outside SLA." },
                      { type: "BUDGET VARIANCE", badge: "Emerging", text: "Forecast overrun trend in Q3 unless scope sequencing is adjusted." },
                      { type: "RESOURCE LOAD", badge: "Pressure", text: "Delivery leadership capacity over-allocated across two programmes." },
                    ].map(s => (
                      <div key={s.type} className="cockpit-signal">
                        <div className="signal-row">
                          <span className="signal-type">{s.type}</span>
                          <span className="signal-badge">{s.badge}</span>
                        </div>
                        <div className="signal-text">{s.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST BAND */}
      <div className="trust-band">
        <div className="trust-row">
          {trust.map(t => <span key={t} className="trust-pill">{t}</span>)}
        </div>
      </div>

      {/* PROBLEM */}
      <section className="problem-section">
        <div className="shell">
          <div className="section-kicker">The problem</div>
          <h2 className="section-title">Most PMOs don't struggle from lack<br />of effort. They struggle from<br /><span className="text-gradient">fragmented control.</span></h2>
          <p className="section-sub">Delivery teams work hard, but governance breaks when planning, decisions, risks, approvals and reporting live across too many disconnected places.</p>
          <div className="problem-grid">
            {[
              { title: "Fragmented control", desc: "Plans, RAID, approvals and reporting sit across spreadsheets, inboxes and disconnected tools." },
              { title: "Reactive governance", desc: "Leaders hear about delivery risk too late, after schedule, budget or confidence has already slipped." },
              { title: "Weak executive visibility", desc: "Decision-makers lack one reliable operating picture across projects, portfolios and approvals." },
            ].map(p => (
              <div key={p.title} className="problem-card">
                <h3>{p.title}</h3>
                <p>{p.desc}</p>
              </div>
            ))}
          </div>
          <div className="transform-banner">
            <div>
              <div className="transform-title">Aliena turns delivery operations into a governed intelligence system.</div>
              <div className="transform-text">One control layer for programme oversight, one source of truth for governance, and one AI brain to help leaders act before issues escalate.</div>
            </div>
            <a href="#platform" className="btn btn-primary btn-lg">Explore the platform <ChevronRight size={16} /></a>
          </div>
        </div>
      </section>

      {/* PILLARS — with space/spacecraft bg feel */}
      <section className="pillars-section" id="platform">
        <Starfield count={50} />
        <div className="shell pillars-inner">
          <div className="pillars-header">
            <div className="section-kicker">Platform pillars</div>
            <h2 className="section-title">Five pillars.<br /><span className="text-gradient">One control layer.</span></h2>
            <p className="section-sub">Built to replace fragmented tools with a governed, AI-assisted delivery system.</p>
          </div>
          <div className="pillars-grid">
            {pillars.map(p => (
              <div key={p.k} className="pillar-card">
                <div className="pillar-num">{p.k}</div>
                <div className="pillar-icon"><p.icon size={22} /></div>
                <div className="pillar-title">{p.title}</div>
                <div className="pillar-desc">{p.desc}</div>
                <div className="bullet-list">
                  {p.bullets.map(b => (
                    <div key={b} className="bullet">
                      <span className="bullet-mark">?</span>
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {/* 5th card fills odd slot with a CTA */}
            <div className="pillar-card" style={{ background: "linear-gradient(135deg, rgba(0,184,219,0.08) 0%, rgba(255,255,255,0.02) 100%)", borderColor: "rgba(0,184,219,0.15)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: 12 }}>
              <Sparkles size={28} color="var(--cyan)" />
              <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700 }}>Ready to see it live?</div>
              <div style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, maxWidth: 220 }}>Book a leadership demo and see Aliena in your delivery context.</div>
              <a href="mailto:hello@aliena.co.uk" className="btn btn-primary" style={{ marginTop: 6 }}>Book demo <ArrowRight size={14} /></a>
            </div>
          </div>
        </div>
      </section>

      {/* GOVERNANCE INTELLIGENCE SECTION (full component) */}
      <GovernanceIntelligenceSection />

      {/* COMPARISON — with planet/nebula bg */}
      <section className="comparison-section">
        <Starfield count={40} />
        <div className="planet-decoration" />
        <div className="planet-ring" />
        <div className="shell comparison-inner">
          <div className="comparison-glass">
            <div className="comparison-header">
              <div className="section-kicker" style={{ marginBottom: 8 }}>Why Aliena wins</div>
              <div className="comparison-title">Traditional tools <span className="text-gradient gr">record.</span><br />Aliena <span className="text-gradient">interprets.</span></div>
              <div className="comparison-sub">From system of record to system of intelligence.</div>
            </div>
            <div className="comparison-cols">
              <div className="compare-col">
                <div className="compare-col-head old">Traditional PM tools</div>
                <div className="compare-items">
                  {["Static reports assembled after the fact", "Disconnected approvals and governance evidence", "RAID logs that depend on manual interpretation", "Executive visibility arrives too late"].map(t => (
                    <div key={t} className="compare-item old-item">
                      <span className="icon" style={{ color: "var(--muted2)", marginTop: 2 }}>•</span>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
              <div className="compare-col">
                <div className="compare-col-head new">Aliena AI</div>
                <div className="compare-items">
                  {["Live delivery intelligence with AI-assisted summaries", "Traceable approval flows and defendable decisions", "Risk, financial and schedule signals surfaced early", "One control layer for leaders, PMOs and delivery teams"].map(t => (
                    <div key={t} className="compare-item new-item">
                      <CheckCircle2 size={14} className="icon" color="var(--green)" />
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* OUTCOMES */}
      <section className="outcomes-section" id="outcomes">
        <div className="shell outcomes-inner">
          <div className="section-kicker">Outcomes</div>
          <h2 className="section-title">Better decisions.<br /><span className="text-gradient">Earlier intervention.</span></h2>
          <p className="section-sub">The goal isn't more dashboards. It's control, speed and confidence.</p>
          <div className="outcomes-grid">
            {outcomes.map(o => (
              <div key={o.label} className="outcome-card">
              <div className="outcome-value text-gradient">{o.value}</div>
                <div className="outcome-label">{o.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AUDIENCE */}
      <section className="audience-section">
        <div className="shell">
          <div className="section-kicker">Who it serves</div>
          <h2 className="section-title">Built for organisations where<br /><span className="text-gradient">governance and delivery</span><br />both matter.</h2>
          <div className="audience-grid">
            {audiences.map(a => (
              <div key={a.title} className="audience-card">
                <h3>{a.title}</h3>
                <p>{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="shell">
          <div className="cta-panel">
            <div className="section-kicker" style={{ marginBottom: 16 }}>Get started</div>
            <h2>Bring governance, visibility and AI decision intelligence into one platform.</h2>
            <p>If you want a world-class governance system for your delivery estate, Aliena is built for exactly that.</p>
            <div className="cta-actions">
              <a href="/login" className="btn btn-primary btn-lg">Start pilot <ArrowRight size={16} /></a>
              <a href="mailto:hello@aliena.co.uk" className="btn btn-outline btn-lg">Book a leadership demo</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="shell">
          <div className="footer-inner">
            <a href="/"><Logo size="sm" /></a>
            <div className="footer-links">
              <a href="/security" className="footer-link">Security</a>
              <a href="/privacy" className="footer-link">Privacy</a>
              <a href="/.well-known/security.txt" className="footer-link">security.txt</a>
              <a href="mailto:hello@aliena.co.uk" className="footer-link">Contact</a>
            </div>
            <div className="footer-copy">© 2026 Aliena AI. Built in the UK.</div>
          </div>
        </div>
      </footer>
    </>
  );
}