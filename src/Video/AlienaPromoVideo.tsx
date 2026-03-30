import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
  spring,
  Easing,
} from "remotion";

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg:     "#080C14",
  grid:   "#1A2235",
  surf:   "#0F1825",
  border: "#1E2D45",
  text:   "#E8EDF5",
  muted:  "#5A7090",
  purple: "#7C5CFC",
  teal:   "#00C6B8",
  amber:  "#F59E0B",
  red:    "#EF4444",
  green:  "#22C55E",
  cyan:   "#06B6D4",
  orange: "#F97316",
} as const;

// ─── Timing ──────────────────────────────────────────────────────────────────
const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const SCENES = {
  intro:       { start: f(0),  dur: f(8)  },
  problem:     { start: f(8),  dur: f(12) },
  crBoard:     { start: f(20), dur: f(10) },
  crApproved:  { start: f(30), dur: f(8)  },
  applyBudget: { start: f(38), dur: f(12) },
  platform:    { start: f(50), dur: f(22) },
  graphReturn: { start: f(72), dur: f(10) },
  cta:         { start: f(82), dur: f(8)  },
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ease(
  frame: number,
  startSec: number,
  endSec: number,
  from = 0,
  to = 1,
  easingFn = Easing.out(Easing.cubic)
) {
  return interpolate(
    frame,
    [startSec * FPS, endSec * FPS],
    [from, to],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easingFn }
  );
}

function useSpring(
  frame: number,
  startFrame: number,
  config = { stiffness: 60, damping: 18 }
) {
  return spring({ frame: Math.max(0, frame - startFrame), fps: FPS, config });
}

// ─── Node data ────────────────────────────────────────────────────────────────
const NODES = [
  { id: "charter",   x: 10, y: 18, label: "Project Charter", sub: "Approved",          color: C.purple, ring: C.green,  delay: 0  },
  { id: "approval",  x: 25, y: 18, label: "Approvals",       sub: "4 pending",          color: C.orange, ring: C.amber,  delay: 5  },
  { id: "decision",  x: 40, y: 18, label: "Decisions",       sub: "8 logged",           color: C.purple, ring: C.green,  delay: 10 },
  { id: "change",    x: 55, y: 18, label: "Change Control",  sub: "5 open",             color: C.orange, ring: C.red,    delay: 14 },
  { id: "wbs",       x: 70, y: 18, label: "WBS",             sub: "Level 3",            color: C.cyan,   ring: C.green,  delay: 18 },
  { id: "raid",      x: 10, y: 45, label: "RAID Log",        sub: "12 active",          color: C.red,    ring: C.red,    delay: 22 },
  { id: "financial", x: 25, y: 45, label: "Financial Plan",  sub: "£1.2M variance",    color: C.green,  ring: C.amber,  delay: 26 },
  { id: "milestone", x: 40, y: 45, label: "Milestones",      sub: "3 at risk",          color: C.amber,  ring: C.amber,  delay: 30 },
  { id: "schedule",  x: 55, y: 45, label: "Schedule",        sub: "On track",           color: C.teal,   ring: C.green,  delay: 34 },
  { id: "resources", x: 70, y: 45, label: "Resources",       sub: "Overallocated",      color: C.red,    ring: C.red,    delay: 38 },
  { id: "weekly",    x: 85, y: 45, label: "Weekly Report",   sub: "Auto-generated",     color: C.teal,   ring: C.green,  delay: 42 },
  { id: "ai",        x: 47, y: 68, label: "Governance AI",   sub: "Intelligence layer", color: C.purple, ring: C.purple, delay: 50 },
  { id: "exec",      x: 47, y: 88, label: "Executive View",  sub: "Unified dashboard",  color: C.cyan,   ring: C.teal,   delay: 60 },
];

const CONNECTIONS = [
  ["charter",   "ai"], ["approval",  "ai"], ["decision",  "ai"],
  ["change",    "ai"], ["wbs",       "ai"], ["raid",      "ai"],
  ["financial", "ai"], ["milestone", "ai"], ["schedule",  "ai"],
  ["resources", "ai"], ["weekly",    "ai"], ["ai",        "exec"],
] as const;

// ─── DarkBg ───────────────────────────────────────────────────────────────────
function DarkBg({ opacity = 1, patternId = "grd" }: { opacity?: number; patternId?: string }) {
  return (
    <AbsoluteFill style={{ background: C.bg, opacity }}>
      <svg width="100%" height="100%" viewBox="0 0 1920 1080" style={{ opacity: 0.2 }}>
        <defs>
          <pattern id={patternId} width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M80 0L0 0 0 80" fill="none" stroke={C.grid} strokeWidth="0.8"/>
          </pattern>
        </defs>
        <rect width="1920" height="1080" fill={`url(#${patternId})`}/>
      </svg>
    </AbsoluteFill>
  );
}

// ─── GraphLayer ───────────────────────────────────────────────────────────────
function GraphLayer({
  frame, startFrame, connOpacity = 1,
}: {
  frame: number; startFrame: number; connOpacity?: number;
}) {
  const aiPulse = Math.sin(frame / (FPS * 0.8)) * 0.5 + 0.5;

  return (
    <svg
      width="100%" height="100%"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid meet"
      style={{ position: "absolute", inset: 0 }}
    >
      <defs>
        <linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={C.purple} stopOpacity="0.2"/>
          <stop offset="100%" stopColor={C.teal} stopOpacity="0.7"/>
        </linearGradient>
        <linearGradient id="lg2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={C.purple} stopOpacity="0.8"/>
          <stop offset="100%" stopColor={C.cyan} stopOpacity="0.9"/>
        </linearGradient>
        <radialGradient id="aiGlow" cx="50%" cy="50%">
          <stop offset="0%" stopColor={C.purple} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={C.purple} stopOpacity="0"/>
        </radialGradient>
      </defs>

      <ellipse cx={0.47 * 1920} cy={0.68 * 1080} rx={350} ry={260} fill="url(#aiGlow)"/>

      {CONNECTIONS.map(([fid, tid], i) => {
        const fn  = NODES.find(n => n.id === fid)!;
        const tn  = NODES.find(n => n.id === tid)!;
        const fx  = (fn.x / 100) * 1920, fy = (fn.y / 100) * 1080;
        const tx  = (tn.x / 100) * 1920, ty = (tn.y / 100) * 1080;
        const isExec = tid === "exec";
        const t   = ((frame + i * 18) % (FPS * 2.5)) / (FPS * 2.5);
        const cx2 = fx + (tx - fx) * t;
        const cy2 = fy + (ty - fy) * t;
        const dotOp = t < 0.1 ? t / 0.1 : t > 0.9 ? (1 - t) / 0.1 : 1;
        return (
          <g key={i}>
            <line
              x1={fx} y1={fy} x2={tx} y2={ty}
              stroke={isExec ? "url(#lg2)" : "url(#lg1)"}
              strokeWidth={isExec ? 3 : 1.5}
              strokeDasharray={isExec ? undefined : "6 4"}
              opacity={connOpacity * (isExec ? 0.9 : 0.45)}
            />
            <circle cx={cx2} cy={cy2} r={5}
              fill={isExec ? C.teal : fn.color}
              opacity={connOpacity * dotOp * 0.9}
            />
          </g>
        );
      })}

      <circle cx={0.47 * 1920} cy={0.68 * 1080} r={60 + aiPulse * 30}
        fill="none" stroke={C.purple} strokeWidth={1.5}
        opacity={(1 - aiPulse) * 0.4 * connOpacity}
      />
      <circle cx={0.47 * 1920} cy={0.68 * 1080} r={95 + aiPulse * 50}
        fill="none" stroke={C.purple} strokeWidth={1}
        opacity={(1 - aiPulse) * 0.18 * connOpacity}
      />

      {NODES.map((n) => {
        const nx   = (n.x / 100) * 1920;
        const ny   = (n.y / 100) * 1080;
        const revF = startFrame + n.delay;
        const sc   = spring({
          frame: Math.max(0, frame - revF),
          fps: FPS,
          config: { stiffness: 60, damping: 18 },
        });
        const op   = interpolate(frame, [revF, revF + 12], [0, 1], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp",
        });
        const isAI = n.id === "ai";
        const r    = isAI ? 44 : 32;
        const circ = 2 * Math.PI * (r + 8);

        return (
          <g key={n.id} transform={`translate(${nx},${ny}) scale(${sc})`} opacity={op}>
            <circle r={r + 14} fill={n.color} opacity={0.07}/>
            <circle r={r + 8} fill="none" stroke={n.ring} strokeWidth={isAI ? 3 : 2}
              strokeDasharray={`${circ * 0.78} ${circ}`}
              strokeLinecap="round" transform="rotate(-90)" opacity={0.6}
            />
            <circle r={r} fill={C.surf} stroke={n.color} strokeWidth={isAI ? 3 : 2}/>
            {isAI && <circle r={r + 22} fill="none" stroke={C.purple} strokeWidth={1.5} opacity={0.3}/>}
            <circle r={isAI ? 10 : 7} fill={n.color} opacity={0.9}/>
            <text y={r + 20} textAnchor="middle" fill={C.text}
              fontSize={isAI ? 15 : 12} fontWeight={600} fontFamily="system-ui, sans-serif">
              {n.label}
            </text>
            <text y={r + 34} textAnchor="middle" fill={C.muted}
              fontSize={10} fontFamily="system-ui, sans-serif">
              {n.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────
function Chip({ text, color, x, y, frame, revealFrame }: {
  text: string; color: string; x: string; y: string;
  frame: number; revealFrame: number;
}) {
  const op = ease(frame, revealFrame / FPS, revealFrame / FPS + 0.5);
  const ty = interpolate(op, [0, 1], [12, 0]);
  return (
    <div style={{
      position: "absolute", left: x, top: y,
      opacity: op, transform: `translateY(${ty}px)`,
      background: color + "22", border: `1.5px solid ${color}`,
      color, fontFamily: "system-ui, sans-serif", fontSize: 20,
      fontWeight: 600, padding: "10px 24px", borderRadius: 100,
      letterSpacing: "0.03em",
    }}>
      {text}
    </div>
  );
}

// ─── Counter ─────────────────────────────────────────────────────────────────
function Counter({ from, to, prefix = "£", frame, startFrame, durationFrames = 25 }: {
  from: number; to: number; prefix?: string;
  frame: number; startFrame: number; durationFrames?: number;
}) {
  const t = interpolate(frame, [startFrame, startFrame + durationFrames], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const value = Math.round(from + (to - from) * t);
  return <span>{prefix}{value.toLocaleString("en-GB")}</span>;
}

// ─── SceneTitle ───────────────────────────────────────────────────────────────
function SceneTitle({ line1, line2, frame, revealFrame, accent = C.purple }: {
  line1: string; line2?: string;
  frame: number; revealFrame: number; accent?: string;
}) {
  const op = ease(frame, revealFrame / FPS, revealFrame / FPS + 0.6);
  const ty = interpolate(op, [0, 1], [40, 0]);
  return (
    <div style={{
      position: "absolute", left: 90, bottom: 130,
      opacity: op, transform: `translateY(${ty}px)`,
    }}>
      <div style={{
        fontFamily: "system-ui, sans-serif", fontSize: 58,
        fontWeight: 700, color: C.text, lineHeight: 1.1, maxWidth: 900,
      }}>
        {line1}
      </div>
      {line2 && (
        <div style={{
          fontFamily: "system-ui, sans-serif", fontSize: 58,
          fontWeight: 700, color: accent, lineHeight: 1.1,
        }}>
          {line2}
        </div>
      )}
    </div>
  );
}

// ─── ScreenshotScene ──────────────────────────────────────────────────────────
function ScreenshotScene({ frame, src, chip, chipColor, line1, line2, accent, patternId }: {
  frame: number; src: string; chip?: string; chipColor?: string;
  line1: string; line2?: string; accent?: string; patternId: string;
}) {
  const imgOp = ease(frame, 0.3, 1.2);
  const sc    = useSpring(frame, 0, { stiffness: 45, damping: 22 });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <DarkBg opacity={0.5} patternId={patternId}/>
      <AbsoluteFill style={{
        left: "38%", opacity: imgOp,
        transform: `scale(${0.92 + sc * 0.08})`,
        borderRadius: "20px 0 0 20px", overflow: "hidden",
      }}>
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "left top" }}/>
        <AbsoluteFill style={{
          background: "linear-gradient(to right, rgba(8,12,20,0.95) 0%, rgba(8,12,20,0.1) 30%, transparent 60%)",
          pointerEvents: "none",
        }}/>
      </AbsoluteFill>
      <AbsoluteFill style={{ right: "60%", paddingLeft: 90, justifyContent: "center" }}>
        {chip && chipColor && (
          <Chip text={chip} color={chipColor} x="0" y="calc(50% - 130px)"
            frame={frame} revealFrame={f(0.4)}/>
        )}
        <SceneTitle line1={line1} line2={line2} frame={frame}
          revealFrame={f(0.5)} accent={accent}/>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────
export const AlienaPromo90: React.FC = () => {
  const frame = useCurrentFrame();
  const globalFadeOut = ease(frame, 88, 90);

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: "system-ui, sans-serif" }}>

      {/* Add Audio back once /public/vo.mp3 and /public/music.mp3 exist:
      <Audio src={staticFile("/vo.mp3")}    volume={1}    />
      <Audio src={staticFile("/music.mp3")} volume={0.12} /> */}

      {/* ── Scene 1: Intro graph [0–8s] ── */}
      <Sequence from={SCENES.intro.start} durationInFrames={SCENES.intro.dur}>
        <AbsoluteFill>
          <DarkBg patternId="grd-intro"/>
          <AbsoluteFill style={{ opacity: ease(frame, 0, 2) * 0.18 }}>
            <svg width="100%" height="100%" viewBox="0 0 1920 1080">
              <defs>
                <radialGradient id="amb-intro" cx="50%" cy="50%">
                  <stop offset="0%" stopColor={C.purple} stopOpacity="1"/>
                  <stop offset="100%" stopColor={C.purple} stopOpacity="0"/>
                </radialGradient>
              </defs>
              <ellipse cx={960} cy={734} rx={500} ry={380} fill="url(#amb-intro)"/>
            </svg>
          </AbsoluteFill>
          <AbsoluteFill style={{ opacity: ease(frame, 0, 1) }}>
            <GraphLayer frame={frame} startFrame={0} connOpacity={ease(frame, 3, 7)}/>
          </AbsoluteFill>
          <AbsoluteFill style={{ justifyContent: "flex-end", paddingLeft: 90, paddingBottom: 100 }}>
            <div style={{
              opacity: ease(frame, 4.5, 6.5),
              transform: `translateY(${interpolate(ease(frame, 4.5, 6.5), [0, 1], [40, 0])}px)`,
            }}>
              <div style={{
                fontSize: 20, fontWeight: 600, color: C.teal,
                letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 16,
              }}>
                Aliena — Governance Intelligence
              </div>
              <div style={{ fontSize: 68, fontWeight: 700, color: C.text, lineHeight: 1.08, maxWidth: 880 }}>
                Every project signal.{" "}
                <span style={{ color: C.purple }}>One intelligent </span>
                <span style={{ color: C.teal }}>workspace.</span>
              </div>
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
      </Sequence>

      {/* ── Scene 2: Problem [8–20s] ── */}
      <Sequence from={SCENES.problem.start} durationInFrames={SCENES.problem.dur}>
        <ScreenshotScene
          frame={frame - SCENES.problem.start}
          src="/screenshots/fp-approved.png"
          chip="Approved — budget locked"
          chipColor={C.green}
          line1="Budget approved."
          line2="Scope just changed."
          accent={C.amber}
          patternId="grd-problem"
        />
      </Sequence>

      {/* ── Scene 3: CR board [20–30s] ── */}
      <Sequence from={SCENES.crBoard.start} durationInFrames={SCENES.crBoard.dur}>
        <ScreenshotScene
          frame={frame - SCENES.crBoard.start}
          src="/screenshots/cr-board.png"
          chip="5 change requests open"
          chipColor={C.orange}
          line1="Raised."
          line2="Under review."
          accent={C.orange}
          patternId="grd-crboard"
        />
      </Sequence>

      {/* ── Scene 4: CR approved [30–38s] ── */}
      <Sequence from={SCENES.crApproved.start} durationInFrames={SCENES.crApproved.dur}>
        <ScreenshotScene
          frame={frame - SCENES.crApproved.start}
          src="/screenshots/cr-approved.png"
          chip="✓ Approved"
          chipColor={C.green}
          line1="Reviewed."
          line2="Approved."
          accent={C.green}
          patternId="grd-crapproved"
        />
      </Sequence>

      {/* ── Scene 5: Apply to budget [38–50s] ── */}
      <Sequence from={SCENES.applyBudget.start} durationInFrames={SCENES.applyBudget.dur}>
        {(() => {
          const lf           = frame - SCENES.applyBudget.start;
          const showUpdated  = lf > f(4.5) && lf >= 0;
          const imgSrc       = showUpdated ? "/screenshots/fp-updated.png" : "/screenshots/fp-changes.png";
          const counterStart = f(5.5);
          return (
            <AbsoluteFill style={{ background: C.bg }}>
              <DarkBg opacity={0.5} patternId="grd-apply"/>
              <AbsoluteFill style={{
                opacity: ease(lf, 0, 1),
                transform: `scale(${0.96 + ease(lf, 0, 3) * 0.04})`,
              }}>
                <Img src={staticFile(imgSrc)} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                <AbsoluteFill style={{
                  background: "linear-gradient(to top, rgba(8,12,20,0.85) 0%, rgba(8,12,20,0.2) 50%, transparent 100%)",
                }}/>
              </AbsoluteFill>
              <AbsoluteFill style={{
                justifyContent: "flex-end", alignItems: "flex-start",
                paddingLeft: 90, paddingBottom: 120,
              }}>
                <div style={{ opacity: ease(lf, 0, 1) }}>
                  {!showUpdated && (
                    <div style={{
                      fontSize: 26, color: C.muted,
                      marginBottom: 12, opacity: ease(lf, 0.5, 1.5),
                    }}>
                      Approved CR · £18,000 cost impact
                    </div>
                  )}
                  <div style={{ fontSize: 80, fontWeight: 700, color: C.text, lineHeight: 1 }}>
                    {showUpdated ? (
                      <>
                        <Counter from={103000} to={121000} frame={lf} startFrame={counterStart}/>
                        <div style={{ fontSize: 28, color: C.green, marginTop: 12, fontWeight: 500 }}>
                          ✓ Budget updated · Variance recalculated
                        </div>
                      </>
                    ) : (
                      <>
                        One click.
                        <div style={{ fontSize: 42, color: C.teal, marginTop: 8, fontWeight: 500 }}>
                          The budget updates automatically.
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </AbsoluteFill>
            </AbsoluteFill>
          );
        })()}
      </Sequence>

      {/* ── Scene 6: Platform montage [50–72s] ── */}
      <Sequence from={SCENES.platform.start} durationInFrames={SCENES.platform.dur}>
        {(() => {
          const lf      = frame - SCENES.platform.start;
          const screens = [
            { src: "/screenshots/approvals.png", label: "Approvals Control Centre", sub: "Who's blocking what",    accent: C.amber  },
            { src: "/screenshots/resources.png", label: "Resource heatmap",          sub: "Cost vs capacity",       accent: C.cyan   },
            { src: "/screenshots/monthly.png",   label: "Monthly phasing",           sub: "Forecast meets actuals", accent: C.purple },
            { src: "/screenshots/executive.png", label: "Executive cockpit",         sub: "Board-ready insights",   accent: C.teal   },
          ];
          const segLen   = f(5.5);
          const idx      = Math.min(Math.max(0, Math.floor(lf / segLen)), screens.length - 1);
          const segFrame = lf - idx * segLen;
          const sc       = screens[idx];
          return (
            <AbsoluteFill style={{ background: C.bg }}>
              <DarkBg opacity={0.4} patternId="grd-platform"/>
              <AbsoluteFill style={{
                opacity: ease(segFrame, 0, 0.5),
                transform: `scale(${0.96 + ease(segFrame, 0, 2) * 0.04})`,
              }}>
                <Img src={staticFile(sc.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                <AbsoluteFill style={{
                  background: "linear-gradient(to top, rgba(8,12,20,0.8) 0%, rgba(8,12,20,0.1) 50%, transparent 100%)",
                }}/>
              </AbsoluteFill>
              <AbsoluteFill style={{ justifyContent: "flex-end", paddingLeft: 80, paddingBottom: 80 }}>
                <div style={{ opacity: ease(segFrame, 0.4, 1.4) }}>
                  <div style={{
                    fontSize: 18, color: sc.accent, fontWeight: 600,
                    letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10,
                  }}>
                    {sc.sub}
                  </div>
                  <div style={{ fontSize: 52, fontWeight: 700, color: C.text }}>
                    {sc.label}
                  </div>
                </div>
              </AbsoluteFill>
              <AbsoluteFill style={{
                justifyContent: "flex-end", alignItems: "flex-end",
                paddingRight: 80, paddingBottom: 88,
              }}>
                <div style={{ display: "flex", gap: 10 }}>
                  {screens.map((_, i) => (
                    <div key={i} style={{
                      width: i === idx ? 28 : 10, height: 10, borderRadius: 5,
                      background: i === idx ? sc.accent : C.border,
                    }}/>
                  ))}
                </div>
              </AbsoluteFill>
            </AbsoluteFill>
          );
        })()}
      </Sequence>

      {/* ── Scene 7: Graph returns [72–82s] ── */}
      <Sequence from={SCENES.graphReturn.start} durationInFrames={SCENES.graphReturn.dur}>
        <AbsoluteFill>
          <DarkBg patternId="grd-return"/>
          <AbsoluteFill style={{ opacity: ease(frame - SCENES.graphReturn.start, 0, 2) }}>
            <GraphLayer frame={frame - SCENES.graphReturn.start} startFrame={0} connOpacity={1}/>
          </AbsoluteFill>
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <div style={{
              textAlign: "center",
              opacity: ease(frame - SCENES.graphReturn.start, 1.5, 3),
            }}>
              <div style={{ fontSize: 72, fontWeight: 700, color: C.text, lineHeight: 1.1 }}>
                Every signal.
              </div>
              <div style={{ fontSize: 72, fontWeight: 700, color: C.purple }}>
                One platform.
              </div>
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
      </Sequence>

      {/* ── Scene 8: CTA [82–90s] ── */}
      <Sequence from={SCENES.cta.start} durationInFrames={SCENES.cta.dur}>
        {(() => {
          const lf = frame - SCENES.cta.start;
          return (
            <AbsoluteFill style={{ background: C.bg, justifyContent: "center", alignItems: "center" }}>
              <DarkBg patternId="grd-cta"/>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 32,
                opacity: ease(lf, 0, 1.5),
                transform: `translateY(${interpolate(ease(lf, 0, 1.5), [0, 1], [30, 0])}px)`,
              }}>
                <div style={{
                  fontSize: 22, fontWeight: 600, letterSpacing: "0.2em",
                  textTransform: "uppercase", color: C.teal,
                }}>
                  Aliena
                </div>
                <div style={{
                  fontSize: 64, fontWeight: 700, color: C.text,
                  textAlign: "center", lineHeight: 1.1,
                }}>
                  Built for project owners
                  <br/>
                  <span style={{ color: C.purple }}>who need more than a task list.</span>
                </div>
                <div style={{
                  marginTop: 16, padding: "20px 56px", borderRadius: 100,
                  background: C.purple, fontSize: 28, fontWeight: 600,
                  color: "#fff", letterSpacing: "0.03em",
                  opacity: ease(lf, 1.5, 3),
                }}>
                  Try Aliena free — aliena.ai
                </div>
                <div style={{ fontSize: 18, color: C.muted, opacity: ease(lf, 2.5, 4) }}>
                  No credit card needed
                </div>
              </div>
            </AbsoluteFill>
          );
        })()}
      </Sequence>

      {/* Global fade to black */}
      <AbsoluteFill style={{ background: "#000", opacity: globalFadeOut, pointerEvents: "none" }}/>
    </AbsoluteFill>
  );
};