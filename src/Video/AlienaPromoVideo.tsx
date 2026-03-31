import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
  spring,
  Easing,
} from "remotion";

const C = {
  bg:      "#06090F",
  surf:    "#0C1320",
  border:  "#162033",
  text:    "#EDF1F8",
  muted:   "#4A6080",
  dim:     "#2A3D55",
  purple:  "#7C5CFC",
  purpleL: "#9B82FD",
  teal:    "#00C6B8",
  amber:   "#F59E0B",
  red:     "#EF4444",
  green:   "#22C55E",
  cyan:    "#06B6D4",
  orange:  "#F97316",
  blue:    "#3B82F6",
} as const;

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const SCENES = {
  intro:        { start: f(0),  dur: f(9)  },
  problem:      { start: f(9),  dur: f(10) },
  crBoard:      { start: f(19), dur: f(9)  },
  aiAssessment: { start: f(28), dur: f(10) }, // ← NEW: AI scoring a CR
  raidScene:    { start: f(38), dur: f(10) },
  milestones:   { start: f(48), dur: f(10) },
  platform:     { start: f(58), dur: f(18) },
  graphReturn:  { start: f(76), dur: f(9)  },
  cta:          { start: f(85), dur: f(5)  },
} as const;

function ease(frame: number, s0: number, s1: number, from = 0, to = 1, fn = Easing.out(Easing.cubic)) {
  return interpolate(frame, [s0 * FPS, s1 * FPS], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: fn });
}
function sp(frame: number, sf: number, cfg = { stiffness: 55, damping: 18 }) {
  return spring({ frame: Math.max(0, frame - sf), fps: FPS, config: cfg });
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

const NODES = [
  { id: "charter",   x: 11, y: 16, label: "Project Charter",  sub: "Signed off",         color: C.purple, ring: C.green,   delay: 0  },
  { id: "approval",  x: 26, y: 16, label: "Approvals",        sub: "4 pending",           color: C.orange, ring: C.amber,   delay: 6  },
  { id: "decision",  x: 41, y: 16, label: "Decision Log",     sub: "8 recorded",          color: C.purple, ring: C.green,   delay: 11 },
  { id: "change",    x: 56, y: 16, label: "Change Control",   sub: "5 open",              color: C.orange, ring: C.red,     delay: 15 },
  { id: "wbs",       x: 71, y: 16, label: "WBS",              sub: "Level 3 breakdown",   color: C.cyan,   ring: C.green,   delay: 20 },
  { id: "raid",      x: 11, y: 44, label: "RAID Log",         sub: "12 items tracked",    color: C.red,    ring: C.red,     delay: 24 },
  { id: "financial", x: 26, y: 44, label: "Financial Plan",   sub: "£1.2M variance",      color: C.green,  ring: C.amber,   delay: 28 },
  { id: "milestone", x: 41, y: 44, label: "Milestones",       sub: "3 at risk",           color: C.amber,  ring: C.amber,   delay: 32 },
  { id: "schedule",  x: 56, y: 44, label: "Schedule",         sub: "On track",            color: C.teal,   ring: C.green,   delay: 36 },
  { id: "resources", x: 71, y: 44, label: "Resources",        sub: "Capacity tracked",    color: C.blue,   ring: C.cyan,    delay: 40 },
  { id: "weekly",    x: 86, y: 44, label: "Weekly Report",    sub: "Auto-generated",      color: C.teal,   ring: C.green,   delay: 44 },
  { id: "ai",        x: 48, y: 67, label: "Governance AI",    sub: "Intelligence layer",  color: C.purple, ring: C.purpleL, delay: 52 },
  { id: "exec",      x: 48, y: 87, label: "Executive View",   sub: "Portfolio dashboard", color: C.cyan,   ring: C.teal,    delay: 62 },
];
const CONNECTIONS = [
  ["charter","ai"],["approval","ai"],["decision","ai"],["change","ai"],
  ["wbs","ai"],["raid","ai"],["financial","ai"],["milestone","ai"],
  ["schedule","ai"],["resources","ai"],["weekly","ai"],["ai","exec"],
] as const;

function DarkBg({ opacity = 1, pid = "g" }: { opacity?: number; pid?: string }) {
  return (
    <AbsoluteFill style={{ background: C.bg, opacity }}>
      <svg width="100%" height="100%" viewBox="0 0 1920 1080" style={{ opacity: 0.18 }}>
        <defs>
          <pattern id={pid} width="72" height="72" patternUnits="userSpaceOnUse">
            <path d="M72 0L0 0 0 72" fill="none" stroke={C.border} strokeWidth="0.7"/>
          </pattern>
        </defs>
        <rect width="1920" height="1080" fill={`url(#${pid})`}/>
      </svg>
    </AbsoluteFill>
  );
}

function GraphLayer({ frame, startFrame, connOp = 1 }: { frame: number; startFrame: number; connOp?: number }) {
  const pulse = Math.sin(frame / (FPS * 0.9)) * 0.5 + 0.5;
  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="lg-c" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={C.purple} stopOpacity="0.15"/>
          <stop offset="100%" stopColor={C.teal} stopOpacity="0.65"/>
        </linearGradient>
        <linearGradient id="lg-e" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={C.purple} stopOpacity="0.85"/>
          <stop offset="100%" stopColor={C.cyan} stopOpacity="0.95"/>
        </linearGradient>
        <radialGradient id="aig" cx="50%" cy="50%">
          <stop offset="0%" stopColor={C.purple} stopOpacity="0.35"/>
          <stop offset="60%" stopColor={C.purple} stopOpacity="0.1"/>
          <stop offset="100%" stopColor={C.purple} stopOpacity="0"/>
        </radialGradient>
        <filter id="bl"><feGaussianBlur stdDeviation="2"/></filter>
      </defs>
      <ellipse cx={0.48 * 1920} cy={0.67 * 1080} rx={320} ry={240} fill="url(#aig)"/>
      {CONNECTIONS.map(([fid, tid], i) => {
        const fn = NODES.find(n => n.id === fid)!;
        const tn = NODES.find(n => n.id === tid)!;
        const fx = (fn.x / 100) * 1920, fy = (fn.y / 100) * 1080;
        const tx = (tn.x / 100) * 1920, ty = (tn.y / 100) * 1080;
        const isE = tid === "exec";
        const spd = isE ? FPS * 2 : FPS * 3;
        const t = ((frame + i * 22) % spd) / spd;
        const dotOp = t < 0.08 ? t / 0.08 : t > 0.92 ? (1 - t) / 0.08 : 1;
        return (
          <g key={i}>
            <line x1={fx} y1={fy} x2={tx} y2={ty} stroke={isE ? "url(#lg-e)" : "url(#lg-c)"} strokeWidth={isE ? 2.5 : 1.2} strokeDasharray={isE ? undefined : "5 5"} opacity={connOp * (isE ? 0.9 : 0.4)}/>
            <circle cx={lerp(fx, tx, t)} cy={lerp(fy, ty, t)} r={isE ? 7 : 5} fill={isE ? C.teal : fn.color} opacity={connOp * dotOp * 0.95} filter="url(#bl)"/>
            <circle cx={lerp(fx, tx, t)} cy={lerp(fy, ty, t)} r={isE ? 4 : 3} fill={isE ? C.teal : fn.color} opacity={connOp * dotOp}/>
          </g>
        );
      })}
      {[1, 1.6].map((m, i) => (
        <circle key={i} cx={0.48 * 1920} cy={0.67 * 1080} r={(55 + pulse * 28) * m} fill="none" stroke={C.purple} strokeWidth={1.5 / m} opacity={(1 - pulse) * 0.35 * connOp / m}/>
      ))}
      {NODES.map((n) => {
        const nx = (n.x / 100) * 1920, ny = (n.y / 100) * 1080;
        const rf = startFrame + n.delay;
        const sc = sp(frame, rf, { stiffness: 55, damping: 16 });
        const op = interpolate(frame, [rf, rf + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const isAI = n.id === "ai";
        const r = isAI ? 46 : 30;
        const circ = 2 * Math.PI * (r + 9);
        return (
          <g key={n.id} transform={`translate(${nx},${ny}) scale(${sc})`} opacity={op}>
            <circle r={r + 20} fill={n.color} opacity={0.05}/>
            <circle r={r + 9} fill="none" stroke={n.ring} strokeWidth={isAI ? 3 : 2} strokeDasharray={`${circ * 0.72} ${circ}`} strokeLinecap="round" transform="rotate(-90)" opacity={0.7}/>
            <circle r={r} fill={C.surf} stroke={n.color} strokeWidth={isAI ? 3 : 1.8}/>
            {isAI && <circle r={r + 26} fill="none" stroke={C.purpleL} strokeWidth={1.5} opacity={0.25}/>}
            <circle r={isAI ? 12 : 6} fill={n.color} opacity={0.9}/>
            <text y={r + 22} textAnchor="middle" fill={C.text} fontSize={isAI ? 14 : 11} fontWeight={700} fontFamily="system-ui">{n.label}</text>
            <text y={r + 36} textAnchor="middle" fill={C.muted} fontSize={9.5} fontFamily="system-ui">{n.sub}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Shared UI atoms ── */
function Badge({ text, color, frame, rf }: { text: string; color: string; frame: number; rf: number }) {
  const op = ease(frame, rf / FPS, rf / FPS + 0.5);
  return (
    <div style={{ opacity: op, transform: `translateY(${interpolate(op, [0, 1], [10, 0])}px)`, display: "inline-flex", alignItems: "center", gap: 8, background: color + "22", border: `1.5px solid ${color}`, borderRadius: 100, padding: "9px 22px", fontSize: 17, fontWeight: 600, color, fontFamily: "system-ui", alignSelf: "flex-start" }}>
      {text}
    </div>
  );
}

function Headline({ line1, line2, accent = C.purple, frame, rf, size = 58 }: { line1: string; line2?: string; accent?: string; frame: number; rf: number; size?: number }) {
  const op = ease(frame, rf / FPS, rf / FPS + 0.7);
  return (
    <div style={{ opacity: op, transform: `translateY(${interpolate(op, [0, 1], [36, 0])}px)` }}>
      <div style={{ fontFamily: "'SF Pro Display', system-ui", fontSize: size, fontWeight: 800, color: C.text, lineHeight: 1.08, letterSpacing: "-0.022em" }}>{line1}</div>
      {line2 && <div style={{ fontFamily: "'SF Pro Display', system-ui", fontSize: size, fontWeight: 800, color: accent, lineHeight: 1.08, letterSpacing: "-0.022em", marginTop: 4 }}>{line2}</div>}
    </div>
  );
}

function Copy({ text, frame, rf }: { text: string; frame: number; rf: number }) {
  const op = ease(frame, rf / FPS, rf / FPS + 0.6);
  return <p style={{ opacity: op, transform: `translateY(${interpolate(op, [0, 1], [14, 0])}px)`, fontFamily: "system-ui", fontSize: 20, color: C.muted, lineHeight: 1.6, maxWidth: 520, margin: 0 }}>{text}</p>;
}

function Pill({ icon, value, label, color, frame, rf }: { icon: string; value: string; label: string; color: string; frame: number; rf: number }) {
  const op = ease(frame, rf / FPS, rf / FPS + 0.45);
  return (
    <div style={{ opacity: op, transform: `translateY(${interpolate(op, [0, 1], [12, 0])}px)`, display: "flex", alignItems: "center", gap: 10, background: color + "18", border: `1.5px solid ${color}44`, borderRadius: 100, padding: "9px 18px" }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "system-ui" }}>{value}</div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: "system-ui" }}>{label}</div>
      </div>
    </div>
  );
}

function SplitScreen({ frame, src, badge, badgeColor, line1, line2, accent, pid, children }: { frame: number; src: string; badge?: string; badgeColor?: string; line1: string; line2?: string; accent?: string; pid: string; children?: React.ReactNode }) {
  const imgOp = ease(frame, 0, 0.8);
  const textY  = interpolate(frame, [0, 270], [0, -60], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Full bleed screenshot */}
      <AbsoluteFill style={{ opacity: imgOp }}>
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}/>
      </AbsoluteFill>
      {/* Dark gradient overlays */}
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.45) 35%, rgba(0,0,0,0.45) 65%, rgba(0,0,0,0.82) 100%)" }}/>
      {/* Movie-style text scrolling top to bottom */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 80 }}>
        <div style={{ transform: `translateY(${textY}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center", maxWidth: 900, padding: "0 60px" }}>

          {badge && badgeColor && <Badge text={badge} color={badgeColor} frame={frame} rf={f(0.3)}/>}
          <Headline line1={line1} line2={line2} frame={frame} rf={f(0.5)} accent={accent} size={72}/>
          {children}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function RiskRow({ text, level, frame, rf }: { text: string; level: "HIGH" | "MED" | "LOW"; frame: number; rf: number }) {
  const c = { HIGH: C.red, MED: C.amber, LOW: C.green }[level];
  const op = ease(frame, rf / FPS, rf / FPS + 0.4);
  return (
    <div style={{ opacity: op, transform: `translateX(${interpolate(op, [0, 1], [-18, 0])}px)`, display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: c + "10", border: `1px solid ${c}30`, borderRadius: 10 }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, boxShadow: `0 0 7px ${c}`, flexShrink: 0 }}/>
      <span style={{ fontSize: 15, color: C.text, fontFamily: "system-ui", flex: 1 }}>{text}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: "system-ui", letterSpacing: "0.1em", padding: "3px 9px", background: c + "20", borderRadius: 100 }}>{level}</span>
    </div>
  );
}

function MsRow({ title, date, status, frame, rf }: { title: string; date: string; status: "ON TRACK" | "AT RISK" | "DONE"; frame: number; rf: number }) {
  const c = { "ON TRACK": C.green, "AT RISK": C.amber, "DONE": C.muted }[status];
  const op = ease(frame, rf / FPS, rf / FPS + 0.4);
  return (
    <div style={{ opacity: op, transform: `translateX(${interpolate(op, [0, 1], [-18, 0])}px)`, display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12 }}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", background: c + "20", border: `1.5px solid ${c}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, color: c }}>{status === "DONE" ? "✓" : status === "AT RISK" ? "!" : "·"}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: C.text, fontFamily: "system-ui", fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: "system-ui", marginTop: 2 }}>{date}</div>
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: "system-ui", letterSpacing: "0.1em", padding: "4px 10px", background: c + "20", borderRadius: 100, border: `1px solid ${c}40` }}>{status}</span>
    </div>
  );
}

/* ── AI Assessment components ── */
function DimBar({ label, rag, score, frame, rf }: { label: string; rag: "green" | "amber" | "red"; score: number; frame: number; rf: number }) {
  const c = { green: C.green, amber: C.amber, red: C.red }[rag];
  const op = ease(frame, rf / FPS, rf / FPS + 0.4);
  const fill = interpolate(frame, [rf + 6, rf + 24], [0, score], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ opacity: op, transform: `translateX(${interpolate(op, [0, 1], [-14, 0])}px)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: C.text, fontFamily: "system-ui", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: c, fontFamily: "system-ui" }}>{score}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: C.border, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 3, width: `${fill}%`, background: `linear-gradient(90deg, ${c}88, ${c})` }}/>
      </div>
    </div>
  );
}

function ScoreRing({ score, frame, rf }: { score: number; frame: number; rf: number }) {
  const animScore = interpolate(frame, [rf, rf + 36], [0, score], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const op = ease(frame, rf / FPS, rf / FPS + 0.6);
  const sc = sp(frame, rf, { stiffness: 42, damping: 17 });
  const r = 68, circ = 2 * Math.PI * r;
  const c = score >= 75 ? C.green : score >= 50 ? C.amber : C.red;
  const lbl = score >= 75 ? "READY" : score >= 50 ? "NEEDS WORK" : "NOT READY";
  const filled = (animScore / 100) * circ * 0.75;
  return (
    <div style={{ opacity: op, transform: `scale(${sc})`, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={176} height={176} viewBox="0 0 176 176">
        <defs>
          <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={c} stopOpacity="0.5"/>
            <stop offset="100%" stopColor={c}/>
          </linearGradient>
        </defs>
        <circle cx={88} cy={88} r={r} fill="none" stroke={C.border} strokeWidth={9} strokeDasharray={`${circ * 0.75} ${circ}`} strokeLinecap="round" transform="rotate(135 88 88)"/>
        <circle cx={88} cy={88} r={r} fill="none" stroke="url(#rg)" strokeWidth={9} strokeDasharray={`${filled} ${circ}`} strokeLinecap="round" transform="rotate(135 88 88)"/>
        <text x="88" y="82" textAnchor="middle" fill={C.text} fontSize={30} fontWeight={800} fontFamily="system-ui">{Math.round(animScore)}</text>
        <text x="88" y="100" textAnchor="middle" fill={C.muted} fontSize={10} fontFamily="system-ui">/ 100</text>
        <text x="88" y="122" textAnchor="middle" fill={c} fontSize={10} fontWeight={700} fontFamily="system-ui" letterSpacing="0.07em">{lbl}</text>
      </svg>
      <div style={{ fontSize: 11, color: C.muted, fontFamily: "system-ui", marginTop: 4 }}>Readiness score</div>
    </div>
  );
}

function Blocker({ text, frame, rf }: { text: string; frame: number; rf: number }) {
  const op = ease(frame, rf / FPS, rf / FPS + 0.35);
  return (
    <div style={{ opacity: op, transform: `translateX(${interpolate(op, [0, 1], [-10, 0])}px)`, display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 13px", background: C.red + "0D", border: `1px solid ${C.red}25`, borderRadius: 9 }}>
      <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.red, marginTop: 6, flexShrink: 0 }}/>
      <span style={{ fontSize: 12, color: C.text, fontFamily: "system-ui", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

function Action({ text, frame, rf }: { text: string; frame: number; rf: number }) {
  const op = ease(frame, rf / FPS, rf / FPS + 0.35);
  return (
    <div style={{ opacity: op, transform: `translateX(${interpolate(op, [0, 1], [-10, 0])}px)`, display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 13px", background: C.purple + "10", border: `1px solid ${C.purple}25`, borderRadius: 9 }}>
      <span style={{ fontSize: 11, color: C.purple, fontWeight: 700, fontFamily: "system-ui", marginTop: 1 }}>→</span>
      <span style={{ fontSize: 12, color: C.text, fontFamily: "system-ui", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

/* ── Scene 4: AI Assessment ── */
function AiAssessmentScene({ frame }: { frame: number }) {
  const imgOp = ease(frame, 0.2, 1.0);
  const imgSc = sp(frame, 0, { stiffness: 38, damping: 20 });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <DarkBg pid="grd-ai"/>

      {/* Ambient purple orb */}
      <AbsoluteFill style={{ opacity: 0.1 }}>
        <svg width="100%" height="100%" viewBox="0 0 1920 1080">
          <defs>
            <radialGradient id="aio" cx="72%" cy="50%">
              <stop offset="0%" stopColor={C.purple} stopOpacity="1"/>
              <stop offset="100%" stopColor={C.purple} stopOpacity="0"/>
            </radialGradient>
          </defs>
          <ellipse cx={1380} cy={540} rx={520} ry={400} fill="url(#aio)"/>
        </svg>
      </AbsoluteFill>

      {/* Screenshot */}
      <AbsoluteFill style={{ left: "44%", opacity: imgOp, transform: `scale(${0.93 + imgSc * 0.07})`, borderRadius: "24px 0 0 24px", overflow: "hidden", boxShadow: "none" }}>
        <Img src={staticFile("/screenshots/ai-assessment.png")} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left" }}/>
        <AbsoluteFill style={{ background: "linear-gradient(to right, rgba(6,9,15,0.98) 0%, rgba(6,9,15,0.35) 20%, transparent 45%)", pointerEvents: "none" }}/>
      </AbsoluteFill>

      {/* Left panel */}
      <AbsoluteFill style={{ right: "56%", paddingLeft: 80, justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Badge */}
          <Badge text="🤖 AI Impact Assessment" color={C.purple} frame={frame} rf={f(0.3)}/>

          {/* Headline */}
          <Headline line1="CR scored." line2="In seconds." accent={C.purpleL} frame={frame} rf={f(0.5)} size={56}/>

          {/* Sub-copy */}
          <Copy text="AI reviews every change for schedule, cost, scope and governance risk — before it reaches the board." frame={frame} rf={f(1.0)}/>

          {/* Ring + dimension bars */}
          <div style={{
            opacity: ease(frame, 1.4, 2.1),
            transform: `translateY(${interpolate(ease(frame, 1.4, 2.1), [0, 1], [18, 0])}px)`,
            display: "flex", gap: 20, alignItems: "flex-start",
          }}>
            <div style={{ flexShrink: 0 }}>
              <ScoreRing score={72} frame={frame} rf={f(1.5)}/>
            </div>
            <div style={{ flex: 1, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 18px 14px", display: "flex", flexDirection: "column", gap: 13 }}>
              <DimBar label="Schedule"   rag="amber" score={68} frame={frame} rf={f(1.7)}/>
              <DimBar label="Cost"       rag="amber" score={74} frame={frame} rf={f(2.0)}/>
              <DimBar label="Scope"      rag="green" score={82} frame={frame} rf={f(2.3)}/>
              <DimBar label="Risk"       rag="red"   score={45} frame={frame} rf={f(2.6)}/>
              <DimBar label="Governance" rag="amber" score={71} frame={frame} rf={f(2.9)}/>
            </div>
          </div>

          {/* Blockers + Actions */}
          <div style={{
            opacity: ease(frame, 3.7, 4.6),
            transform: `translateY(${interpolate(ease(frame, 3.7, 4.6), [0, 1], [16, 0])}px)`,
            display: "flex", gap: 14,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.red, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "system-ui", marginBottom: 7 }}>Blockers</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <Blocker text="Rollback plan not defined" frame={frame} rf={f(3.9)}/>
                <Blocker text="Cost estimate not attached" frame={frame} rf={f(4.25)}/>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.purple, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "system-ui", marginBottom: 7 }}>AI Recommendation</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <Action text="Request rework before approval" frame={frame} rf={f(3.9)}/>
                <Action text="Attach cost estimate from finance" frame={frame} rf={f(4.25)}/>
              </div>
            </div>
          </div>

        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/* ── Main export ── */
export const AlienaPromo90: React.FC = () => {
  const frame = useCurrentFrame();
  const fadeOut = ease(frame, 88.5, 90);

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Audio src={staticFile("/audio/background.mp3")} volume={0.12} />

      {/* Scene 1: Intro */}
      <Sequence from={SCENES.intro.start} durationInFrames={SCENES.intro.dur}>
        <AbsoluteFill>
          <DarkBg pid="grd-intro"/>
          <AbsoluteFill style={{ opacity: ease(frame, 0, 3) * 0.14 }}>
            <svg width="100%" height="100%" viewBox="0 0 1920 1080">
              <defs><radialGradient id="oi" cx="48%" cy="65%"><stop offset="0%" stopColor={C.purple} stopOpacity="1"/><stop offset="100%" stopColor={C.purple} stopOpacity="0"/></radialGradient></defs>
              <ellipse cx={921} cy={702} rx={560} ry={420} fill="url(#oi)"/>
            </svg>
          </AbsoluteFill>
          <AbsoluteFill style={{ opacity: ease(frame, 0, 0.8) }}>
            <GraphLayer frame={frame} startFrame={0} connOp={ease(frame, 3, 8)}/>
          </AbsoluteFill>
          <AbsoluteFill style={{ justifyContent: "flex-end", paddingLeft: 90, paddingBottom: 110 }}>
            <div style={{ opacity: ease(frame, 4.5, 6.5), transform: `translateY(${interpolate(ease(frame, 4.5, 6.5), [0, 1], [44, 0])}px)` }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: C.teal, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "system-ui", marginBottom: 18 }}>Aliena — Governance Intelligence</div>
              <div style={{ fontFamily: "'SF Pro Display', system-ui", fontSize: 72, fontWeight: 800, color: C.text, lineHeight: 1.07, letterSpacing: "-0.025em", maxWidth: 900 }}>
                Every governance signal.{" "}
                <span style={{ color: C.purple }}>One</span>{" "}
                <span style={{ color: C.teal }}>intelligent platform.</span>
              </div>
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
      </Sequence>

      {/* Scene 2: Problem */}
      <Sequence from={SCENES.problem.start} durationInFrames={SCENES.problem.dur}>
        {(() => { const lf = frame - SCENES.problem.start; return (
          <SplitScreen frame={lf} src="/screenshots/fp-approved.png" badge="Budget approved · £103k" badgeColor={C.green} line1="Budget locked." line2="Scope just changed." accent={C.amber} pid="grd-prob">
            <Copy text="A change request lands. The budget stays frozen. Decisions happen in spreadsheets, email, and guesswork." frame={lf} rf={f(1.2)}/>
          </SplitScreen>
        ); })()}
      </Sequence>

      {/* Scene 3: CR Board */}
      <Sequence from={SCENES.crBoard.start} durationInFrames={SCENES.crBoard.dur}>
        {(() => { const lf = frame - SCENES.crBoard.start; return (
          <SplitScreen frame={lf} src="/screenshots/cr-board.png" badge="5 change requests open" badgeColor={C.orange} line1="Raised." line2="Governed. Approved." accent={C.orange} pid="grd-crb">
            <Copy text="A Kanban board moves every change from intake through AI impact scoring to governance decision." frame={lf} rf={f(1.2)}/>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Pill icon="⚡" value="AI Impact" label="scored & ranked" color={C.purple} frame={lf} rf={f(1.8)}/>
              <Pill icon="🔐" value="Approvals" label="full audit trail"  color={C.amber}  frame={lf} rf={f(2.2)}/>
            </div>
          </SplitScreen>
        ); })()}
      </Sequence>

      {/* Scene 4: AI Assessment — NEW */}
      <Sequence from={SCENES.aiAssessment.start} durationInFrames={SCENES.aiAssessment.dur}>
        <AiAssessmentScene frame={frame - SCENES.aiAssessment.start}/>
      </Sequence>

      {/* Scene 5: RAID */}
      <Sequence from={SCENES.raidScene.start} durationInFrames={SCENES.raidScene.dur}>
        {(() => { const lf = frame - SCENES.raidScene.start; return (
          <SplitScreen frame={lf} src="/screenshots/raid.png" badge="12 RAID items tracked" badgeColor={C.red} line1="Risks surface." line2="Before they land." accent={C.red} pid="grd-raid">
            <Copy text="Every risk, assumption, issue and dependency — in one place. AI flags severity and drives action before it's too late." frame={lf} rf={f(1.2)}/>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, maxWidth: 510 }}>
              <RiskRow text="Vendor access not confirmed for go-live" level="HIGH" frame={lf} rf={f(1.8)}/>
              <RiskRow text="Programme scope creep from parallel workstream" level="HIGH" frame={lf} rf={f(2.2)}/>
              <RiskRow text="Resource conflict — SZC project overlaps" level="MED" frame={lf} rf={f(2.6)}/>
            </div>
          </SplitScreen>
        ); })()}
      </Sequence>

      {/* Scene 6: Milestones */}
      <Sequence from={SCENES.milestones.start} durationInFrames={SCENES.milestones.dur}>
        {(() => { const lf = frame - SCENES.milestones.start; return (
          <SplitScreen frame={lf} src="/screenshots/milestones.png" badge="Schedule intelligence · live" badgeColor={C.amber} line1="Milestones due." line2="Slippage predicted." accent={C.amber} pid="grd-ms">
            <Copy text="AI monitors every milestone. Slip probabilities, overdue signals, and delivery forecasts visible before your board report." frame={lf} rf={f(1.2)}/>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, maxWidth: 510 }}>
              <MsRow title="Scoping Documentation" date="27 Mar 2026" status="DONE"     frame={lf} rf={f(1.8)}/>
              <MsRow title="Test"                  date="15 Apr 2026" status="ON TRACK" frame={lf} rf={f(2.2)}/>
              <MsRow title="Design Review"         date="22 Apr 2026" status="AT RISK"  frame={lf} rf={f(2.6)}/>
            </div>
          </SplitScreen>
        ); })()}
      </Sequence>

      {/* Scene 7: Platform montage */}
      <Sequence from={SCENES.platform.start} durationInFrames={SCENES.platform.dur}>
        {(() => {
          const lf = frame - SCENES.platform.start;
          const screens = [
            { src: "/screenshots/approvals.png", label: "Approvals Control Centre", sub: "Decisions with full audit trail", accent: C.amber, pills: [{ icon: "⚡", value: "Real-time", label: "governance alerts", color: C.amber }, { icon: "🔐", value: "Full audit", label: "trail per decision", color: C.purple }] },
            { src: "/screenshots/resources.png", label: "Resource Intelligence",    sub: "Capacity vs demand — live",      accent: C.cyan,  pills: [{ icon: "👥", value: "FTE tracking", label: "week on week",     color: C.cyan   }, { icon: "📊", value: "Pipeline",     label: "vs active demand", color: C.purple }] },
            { src: "/screenshots/executive.png", label: "Executive Portfolio View", sub: "Board-ready · always on",        accent: C.teal,  pills: [{ icon: "🎯", value: "RAG status",  label: "every project",    color: C.green  }, { icon: "🤖", value: "AI briefing", label: "generated live",   color: C.purple }] },
          ];
          const segLen = f(6);
          const idx    = Math.min(Math.max(0, Math.floor(lf / segLen)), screens.length - 1);
          const segLf  = lf - idx * segLen;
          const sc     = screens[idx];
          const imgOp  = ease(segLf, 0, 0.6);
          const scale  = 0.95 + sp(segLf, 0, { stiffness: 38, damping: 20 }) * 0.05;
          const platTextY = interpolate(segLf, [0, 180], [0, -40], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <AbsoluteFill style={{ background: "#000" }}>
              <AbsoluteFill style={{ opacity: imgOp }}>
                <Img src={staticFile(sc.src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}/>
              </AbsoluteFill>
              <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.45) 35%, rgba(0,0,0,0.45) 65%, rgba(0,0,0,0.82) 100%)" }}/>
              <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 80 }}>
                <div style={{ transform: `translateY(${platTextY}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center", maxWidth: 900, padding: "0 60px" }}>
                  <div style={{ display: "flex", gap: 7, opacity: ease(segLf, 0.2, 0.8) }}>
                    {screens.map((_, i) => <div key={i} style={{ height: 4, borderRadius: 2, width: i === idx ? 30 : 11, background: i === idx ? sc.accent : "rgba(255,255,255,0.3)" }}/>)}
                  </div>
                  <div style={{ fontSize: 13, color: sc.accent, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: "system-ui", opacity: ease(segLf, 0.3, 1.1) }}>{sc.sub}</div>
                  <div style={{ fontFamily: "'SF Pro Display', system-ui", fontSize: 72, fontWeight: 800, color: C.text, lineHeight: 1.08, letterSpacing: "-0.025em", opacity: ease(segLf, 0.4, 1.2) }}>{sc.label}</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    {sc.pills.map((p, i) => <Pill key={i} {...p} frame={segLf} rf={f(0.9 + i * 0.4)}/>)}
                  </div>
                </div>
              </AbsoluteFill>
            </AbsoluteFill>
          );
        })()}
      </Sequence>

      {/* Scene 8: Graph return */}
      <Sequence from={SCENES.graphReturn.start} durationInFrames={SCENES.graphReturn.dur}>
        {(() => { const lf = frame - SCENES.graphReturn.start; return (
          <AbsoluteFill>
            <DarkBg pid="grd-ret"/>
            <AbsoluteFill style={{ opacity: ease(lf, 0, 1.5) }}><GraphLayer frame={lf} startFrame={0} connOp={1}/></AbsoluteFill>
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
              <div style={{ textAlign: "center", opacity: ease(lf, 2, 4), transform: `translateY(${interpolate(ease(lf, 2, 4), [0, 1], [28, 0])}px)`, background: "rgba(6,9,15,0.72)", padding: "46px 70px", borderRadius: 28, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 74, fontWeight: 800, color: C.text, fontFamily: "'SF Pro Display', system-ui", letterSpacing: "-0.025em", lineHeight: 1.08 }}>Every signal.</div>
                <div style={{ fontSize: 74, fontWeight: 800, color: C.purple, fontFamily: "'SF Pro Display', system-ui", letterSpacing: "-0.025em", lineHeight: 1.08 }}>One platform.</div>
                <div style={{ fontSize: 18, color: C.muted, marginTop: 18, fontFamily: "system-ui", opacity: ease(lf, 3.5, 5) }}>Change · RAID · Schedule · Budget · AI · Approvals</div>
              </div>
            </AbsoluteFill>
          </AbsoluteFill>
        ); })()}
      </Sequence>

      {/* Scene 9: CTA */}
      <Sequence from={SCENES.cta.start} durationInFrames={SCENES.cta.dur}>
        {(() => { const lf = frame - SCENES.cta.start; return (
          <AbsoluteFill style={{ background: C.bg, justifyContent: "center", alignItems: "center" }}>
            <DarkBg pid="grd-cta"/>
            <AbsoluteFill style={{ opacity: 0.12 }}>
              <svg width="100%" height="100%" viewBox="0 0 1920 1080">
                <defs><radialGradient id="co" cx="50%" cy="50%"><stop offset="0%" stopColor={C.purple} stopOpacity="1"/><stop offset="100%" stopColor={C.purple} stopOpacity="0"/></radialGradient></defs>
                <ellipse cx={960} cy={540} rx={640} ry={480} fill="url(#co)"/>
              </svg>
            </AbsoluteFill>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26, opacity: ease(lf, 0, 1.2), transform: `translateY(${interpolate(ease(lf, 0, 1.2), [0, 1], [30, 0])}px)` }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase", color: C.teal, fontFamily: "system-ui", padding: "7px 18px", background: C.teal + "14", border: `1px solid ${C.teal}44`, borderRadius: 100 }}>Aliena</div>
              <div style={{ fontFamily: "'SF Pro Display', system-ui", fontSize: 58, fontWeight: 800, color: C.text, textAlign: "center", lineHeight: 1.1, letterSpacing: "-0.025em" }}>
                Built for project owners<br/><span style={{ color: C.purple }}>who need more than a task list.</span>
              </div>
              <div style={{ marginTop: 6, padding: "19px 56px", borderRadius: 100, background: `linear-gradient(135deg, ${C.purple}, ${C.teal})`, fontSize: 24, fontWeight: 700, color: "#fff", fontFamily: "system-ui", opacity: ease(lf, 1.2, 2.5), boxShadow: `0 8px 40px ${C.purple}55` }}>
                Try Aliena free — aliena.co.uk
              </div>
              <div style={{ fontSize: 15, color: C.muted, fontFamily: "system-ui", opacity: ease(lf, 2.2, 3.5) }}>No credit card · Free for small teams</div>
            </div>
          </AbsoluteFill>
        ); })()}
      </Sequence>

      <AbsoluteFill style={{ background: "#000", opacity: fadeOut, pointerEvents: "none" }}/>
    </AbsoluteFill>
  );
};