"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Brain,
  Building2,
  CheckCircle2,
  ChevronDown,
  FileCheck,
  Lock,
  Network,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
  Zap,
  Play,
  X,
  ScanEye,
  ShieldCheck,
  Clock3,
  Mail,
  Check,
  Menu,
} from "lucide-react";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
    plausible?: (event: string, options?: { props?: Record<string, unknown> }) => void;
  }
}

// Design Tokens
const T = {
  cyan: "#00D4FF",
  cyanDark: "#00A8CC",
  cyanGlow: "rgba(0, 212, 255, 0.4)",
  cyanSubtle: "rgba(0, 212, 255, 0.08)",
  purple: "#8B5CF6",
  purpleGlow: "rgba(139, 92, 246, 0.4)",
  emerald: "#10B981",
  emeraldGlow: "rgba(16, 185, 129, 0.4)",
  amber: "#F59E0B",
  rose: "#F43F5E",
  bg: "#0A0C0F",
  bgElevated: "#111318",
  bgCard: "#15171D",
  surface: "#1A1D24",
  surfaceHover: "#22262E",
  text: "#FAFBFC",
  textMuted: "#9CA3AF",
  textSubtle: "#6B7280",
  textGhost: "#4B5563",
  border: "rgba(255, 255, 255, 0.06)",
  borderHover: "rgba(0, 212, 255, 0.2)",
  glow: "0 0 40px rgba(0, 212, 255, 0.15)",
  glowStrong: "0 0 60px rgba(0, 212, 255, 0.25)",
};

const F = {
  display: "var(--font-geist-sans), system-ui, sans-serif",
  mono: "var(--font-geist-mono), 'SF Mono', monospace",
};

type TrackPayload = Record<string, string | number | boolean | null | undefined>;

function trackEvent(name: string, payload: TrackPayload = {}) {
  if (typeof window === "undefined") return;
  try {
    window.gtag?.("event", name, payload);
    window.dataLayer?.push({ event: name, ...payload });
    window.plausible?.(name, { props: payload });
  } catch {}
}

function withUtm(href: string, source: string) {
  if (typeof window === "undefined") return href;
  try {
    const url = new URL(href, window.location.origin);
    if (!url.searchParams.get("utm_source")) url.searchParams.set("utm_source", source);
    if (!url.searchParams.get("utm_medium")) url.searchParams.set("utm_medium", "landing_page");
    return url.toString();
  } catch {
    return href;
  }
}

function scrollToId(id: string) {
  if (typeof window === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - 92;
  window.scrollTo({ top: y, behavior: "smooth" });
}

function AnchorLink({
  href,
  children,
  style,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (href.startsWith("#")) {
        e.preventDefault();
        trackEvent("nav_anchor_click", { href });
        scrollToId(href.slice(1));
      } else {
        trackEvent("nav_link_click", { href });
      }
      onClick?.();
    },
    [href, onClick]
  );

  return (
    <a href={href} style={style} onClick={handleClick}>
      {children}
    </a>
  );
}

// Logo uses the actual Aliena cosmic eye image
function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" | "xl" }) {
  const s = {
    sm: { icon: 28, text: 15, gap: 8 },
    md: { icon: 36, text: 19, gap: 10 },
    lg: { icon: 52, text: 26, gap: 12 },
    xl: { icon: 68, text: 34, gap: 14 },
  }[size];

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: s.gap }}>
      <img
        src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
        alt="Aliena"
        width={s.icon}
        height={s.icon}
        style={{ display: "block", flexShrink: 0, filter: `drop-shadow(0 0 10px ${T.cyanGlow})` }}
      />
      <span
        style={{
          fontFamily: F.display,
          letterSpacing: "0.14em",
          fontWeight: 700,
          fontSize: s.text,
          color: T.text,
          display: "inline-flex",
          alignItems: "baseline",
        }}
      >
        <span style={{ color: T.cyan }}>A</span>
        <span>L</span>
        <span style={{ color: T.cyan }}>I</span>
        <span>E</span>
        <span>N</span>
        <span style={{ color: T.cyan }}>A</span>
      </span>
    </span>
  );
}

function GridBackground() {
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(to right, ${T.border} 1px, transparent 1px), linear-gradient(to bottom, ${T.border} 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "20%",
          left: "10%",
          width: 400,
          height: 400,
          background: `radial-gradient(circle, ${T.cyan}08, transparent 70%)`,
          borderRadius: "50%",
          filter: "blur(60px)",
          animation: "float 20s ease-in-out infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "60%",
          right: "15%",
          width: 500,
          height: 500,
          background: `radial-gradient(circle, ${T.purple}06, transparent 70%)`,
          borderRadius: "50%",
          filter: "blur(80px)",
          animation: "float 25s ease-in-out infinite reverse",
        }}
      />
    </div>
  );
}

function HUDCard({
  title,
  value,
  trend,
  status = "neutral",
  delay = 0,
}: {
  title: string;
  value: string;
  trend?: string;
  status?: "positive" | "negative" | "warning" | "neutral";
  delay?: number;
}) {
  const statusColors = { positive: T.emerald, negative: T.rose, warning: T.amber, neutral: T.cyan };
  return (
    <div
      style={{
        background: T.bgCard,
        border: `1px solid ${T.border}`,
        borderRadius: 16,
        padding: 20,
        position: "relative",
        overflow: "hidden",
        animation: `fadeUp 0.6s ${delay}s both`,
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, width: 20, height: 1, background: T.cyan }} />
      <div style={{ position: "absolute", top: 0, left: 0, width: 1, height: 20, background: T.cyan }} />
      <div style={{ position: "absolute", top: 0, right: 0, width: 20, height: 1, background: T.cyan }} />
      <div style={{ position: "absolute", top: 0, right: 0, width: 1, height: 20, background: T.cyan }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: T.textSubtle, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          {title}
        </span>
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: statusColors[status],
            boxShadow: `0 0 10px ${statusColors[status]}`,
            animation: "pulse 2s ease-in-out infinite",
          }}
        />
      </div>
      <div style={{ fontFamily: F.display, fontSize: 28, fontWeight: 700, color: T.text, letterSpacing: "-0.02em", marginBottom: 4 }}>
        {value}
      </div>
      {trend && (
        <div style={{ fontFamily: F.mono, fontSize: 11, color: status === "positive" ? T.emerald : status === "negative" ? T.rose : T.textMuted }}>
          {trend}
        </div>
      )}
    </div>
  );
}

function GovernanceGraph() {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const nodes = useMemo(
    () => [
      { id: "programme", x: 50, y: 12, label: "Programme", sub: "Portfolio", color: T.cyan, health: 92, size: 1.2 },
      { id: "pmo", x: 22, y: 32, label: "PMO", sub: "Governance", color: T.cyan, health: 88, size: 1 },
      { id: "finance", x: 50, y: 32, label: "Finance", sub: "Budget", color: T.emerald, health: 95, size: 1 },
      { id: "delivery", x: 78, y: 32, label: "Delivery", sub: "Execution", color: T.amber, health: 78, size: 1 },
      { id: "approvals", x: 12, y: 55, label: "Approvals", sub: "4 Pending", color: T.amber, health: 65, size: 0.85 },
      { id: "raid", x: 32, y: 55, label: "RAID", sub: "12 Active", color: T.rose, health: 72, size: 0.85 },
      { id: "variance", x: 50, y: 55, label: "Variance", sub: "1.2M", color: T.amber, health: 58, size: 0.85 },
      { id: "milestones", x: 68, y: 55, label: "Milestones", sub: "3 At Risk", color: T.amber, health: 81, size: 0.85 },
      { id: "resources", x: 88, y: 55, label: "Resources", sub: "At Capacity", color: T.rose, health: 45, size: 0.85 },
      { id: "ai", x: 50, y: 76, label: "AI Core", sub: "Intelligence", color: T.purple, health: 99, size: 1.3, pulse: true },
      { id: "reporting", x: 50, y: 92, label: "Executive", sub: "Unified View", color: T.cyan, health: 100, size: 1.1 },
    ],
    []
  );

  const edges = useMemo(
    () => [
      ["programme", "pmo"],
      ["programme", "finance"],
      ["programme", "delivery"],
      ["pmo", "approvals"],
      ["pmo", "raid"],
      ["finance", "variance"],
      ["delivery", "milestones"],
      ["delivery", "resources"],
      ["approvals", "ai"],
      ["raid", "ai"],
      ["variance", "ai"],
      ["milestones", "ai"],
      ["resources", "ai"],
      ["ai", "reporting"],
      ["finance", "reporting"],
    ],
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    let animationId: number;
    let time = 0;

    const animate = () => {
      time += 0.016;
      const rect = canvas.getBoundingClientRect();
      const { width, height } = rect;
      ctx.clearRect(0, 0, width, height);

      edges.forEach(([from, to], i) => {
        const fn = nodes.find((n) => n.id === from)!;
        const tn = nodes.find((n) => n.id === to)!;
        const x1 = (fn.x / 100) * width,
          y1 = (fn.y / 100) * height;
        const x2 = (tn.x / 100) * width,
          y2 = (tn.y / 100) * height;
        const hi = hoveredNode === from || hoveredNode === to || activeNode === from || activeNode === to;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = hi ? T.cyan : T.border;
        ctx.lineWidth = hi ? 2 : 1;
        ctx.setLineDash(hi ? [] : [5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        const p = (time * 0.5 + i * 0.3) % 1;
        ctx.beginPath();
        ctx.arc(x1 + (x2 - x1) * p, y1 + (y2 - y1) * p, hi ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = to === "ai" ? T.purple : T.cyan;
        ctx.shadowBlur = 10;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      nodes.forEach((node) => {
        const x = (node.x / 100) * width,
          y = (node.y / 100) * height,
          r = 26 * node.size;
        const isH = hoveredNode === node.id,
          isA = activeNode === node.id;
        if ((node as any).pulse) {
          ctx.beginPath();
          ctx.arc(x, y, r + 8 + Math.sin(time * 2) * 4, 0, Math.PI * 2);
          ctx.strokeStyle = `${T.purple}40`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (isH || isA) {
          ctx.beginPath();
          ctx.arc(x, y, r + 7, 0, Math.PI * 2);
          ctx.fillStyle = `${node.color}20`;
          ctx.fill();
        }
        if (node.health) {
          ctx.beginPath();
          ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + (node.health / 100) * Math.PI * 2);
          ctx.strokeStyle = node.health > 80 ? T.emerald : node.health > 60 ? T.amber : T.rose;
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = T.bgElevated;
        ctx.fill();
        ctx.strokeStyle = isH || isA ? node.color : T.border;
        ctx.lineWidth = 2;
        ctx.stroke();
        if (node.health && (isH || isA)) {
          ctx.font = `600 10px ${F.mono}`;
          ctx.fillStyle = node.health > 80 ? T.emerald : node.health > 60 ? T.amber : T.rose;
          ctx.textAlign = "center";
          ctx.fillText(`${node.health}%`, x, y - r - 8);
        }
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, [nodes, edges, hoveredNode, activeNode]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", cursor: "crosshair" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100,
            y = ((e.clientY - rect.top) / rect.height) * 100;
          setHoveredNode(nodes.find((n) => Math.sqrt((x - n.x) ** 2 + (y - n.y) ** 2) < 7)?.id || null);
        }}
        onMouseLeave={() => setHoveredNode(null)}
        onClick={() => {
          if (hoveredNode) {
            setActiveNode(activeNode === hoveredNode ? null : hoveredNode);
            trackEvent("graph_node_click", { node_id: hoveredNode });
          }
        }}
      />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {nodes.map((node) => (
          <div
            key={node.id}
            style={{
              position: "absolute",
              left: `${node.x}%`,
              top: `${node.y}%`,
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              pointerEvents: "none",
              marginTop: 32 * node.size,
            }}
          >
            <div
              style={{
                fontFamily: F.display,
                fontSize: 11,
                fontWeight: 600,
                color: hoveredNode === node.id || activeNode === node.id ? T.text : T.textMuted,
                transition: "color 0.2s",
              }}
            >
              {node.label}
            </div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 8,
                color: T.textSubtle,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {node.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Watch demo"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(980px, 100%)",
          background: T.bgElevated,
          border: `1px solid ${T.borderHover}`,
          borderRadius: 24,
          overflow: "hidden",
          boxShadow: "0 30px 100px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px",
            borderBottom: `1px solid ${T.border}`,
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Aliena product demo</div>
            <div style={{ fontSize: 13, color: T.textMuted }}>Live walkthrough of the governance platform.</div>
          </div>
          <button
            aria-label="Close demo"
            onClick={onClose}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: `1px solid ${T.border}`,
              background: T.surface,
              color: T.text,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <div
            style={{
              aspectRatio: "16 / 9",
              borderRadius: 20,
              border: `1px solid ${T.border}`,
              background: `linear-gradient(135deg, ${T.bgCard}, ${T.surface})`,
              display: "grid",
              placeItems: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `radial-gradient(circle at 50% 35%, ${T.cyan}14, transparent 55%)`,
              }}
            />
            <div style={{ position: "relative", zIndex: 1, textAlign: "center", maxWidth: 560, padding: 24 }}>
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: "50%",
                  margin: "0 auto 18px",
                  display: "grid",
                  placeItems: "center",
                  background: `linear-gradient(135deg, ${T.cyan}, ${T.cyanDark})`,
                  color: T.bg,
                  boxShadow: `0 0 40px ${T.cyanGlow}`,
                }}
              >
                <Play size={32} fill={T.bg} />
              </div>
              <h3 style={{ fontFamily: F.display, fontSize: 28, fontWeight: 700, marginBottom: 10 }}>
                See Aliena in action
              </h3>
              <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: 15, marginBottom: 20 }}>
                Book a live walkthrough to see portfolio health scoring, RAID intelligence, approval flows, and AI
                briefings in your context.
              </p>
              <a
                href={withUtm("mailto:support@aliena.co.uk?subject=Book%20an%20Aliena%20demo", "demo_modal")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "14px 22px",
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${T.cyan}, ${T.cyanDark})`,
                  color: T.bg,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
                onClick={() => trackEvent("demo_modal_book_click")}
              >
                Book a live demo <ArrowRight size={18} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Navigation({
  onOpenDemo,
}: {
  onOpenDemo: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  const navLinks = [
    { label: "Platform", href: "#platform" },
    { label: "Intelligence", href: "#intelligence" },
    { label: "Security", href: "#security" },
    { label: "Pricing", href: "#pricing" },
  ];

  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        transition: "all 0.3s",
        background: scrolled ? "rgba(10, 12, 15, 0.9)" : "rgba(10, 12, 15, 0.2)",
        backdropFilter: "blur(20px)",
        borderBottom: scrolled ? `1px solid ${T.border}` : "1px solid transparent",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "14px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
        <AnchorLink href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
          <Logo size="md" />
        </AnchorLink>
        <div className="desktop-nav" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {navLinks.map((link) => (
            <AnchorLink
              key={link.label}
              href={link.href}
              style={{
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 500,
                color: T.textMuted,
                borderRadius: 8,
                transition: "all 0.2s",
                textDecoration: "none",
              }}
            >
              {link.label}
            </AnchorLink>
          ))}
          <div style={{ width: 1, height: 20, background: T.border, margin: "0 8px" }} />
          <AnchorLink
            href="/login"
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              color: T.textMuted,
              textDecoration: "none",
            }}
          >
            Sign in
          </AnchorLink>
          <a
            href={withUtm("mailto:support@aliena.co.uk?subject=Book%20an%20Aliena%20demo", "nav")}
            style={{
              padding: "10px 20px",
              background: `linear-gradient(135deg, ${T.cyan}, ${T.cyanDark})`,
              color: T.bg,
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: `0 0 20px ${T.cyanGlow}`,
              transition: "all 0.2s",
              textDecoration: "none",
            }}
            onClick={() => trackEvent("demo_click", { placement: "nav" })}
          >
            Book demo <ArrowRight size={16} />
          </a>
        </div>
        <button
          className="mobile-nav-button"
          aria-label="Open menu"
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            display: "none",
            width: 44,
            height: 44,
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            background: T.surface,
            color: T.text,
            cursor: "pointer",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Menu size={18} />
        </button>
      </div>
      {menuOpen && (
        <div className="mobile-nav-panel" style={{ padding: "0 20px 20px", display: "none" }}>
          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: 18,
              background: T.bgElevated,
              padding: 14,
            }}
          >
            {navLinks.map((link) => (
              <AnchorLink
                key={link.label}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "block",
                  padding: "12px 14px",
                  borderRadius: 12,
                  color: T.text,
                  textDecoration: "none",
                }}
              >
                {link.label}
              </AnchorLink>
            ))}
            <AnchorLink
              href="/login"
              onClick={() => setMenuOpen(false)}
              style={{
                display: "block",
                padding: "12px 14px",
                borderRadius: 12,
                color: T.text,
                textDecoration: "none",
              }}
            >
              Sign in
            </AnchorLink>
            <a
              href={withUtm("mailto:support@aliena.co.uk?subject=Book%20an%20Aliena%20demo", "mobile_nav")}
              onClick={() => {
                trackEvent("demo_click", { placement: "mobile_nav" });
                setMenuOpen(false);
              }}
              style={{
                width: "100%",
                padding: "14px 16px",
                marginTop: 10,
                borderRadius: 12,
                background: `linear-gradient(135deg, ${T.cyan}, ${T.cyanDark})`,
                color: T.bg,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                textDecoration: "none",
              }}
            >
              Book demo <ArrowRight size={18} />
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

function HeroSection({
  onOpenDemo,
}: {
  onOpenDemo: () => void;
}) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const h = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);

  return (
    <section
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        paddingTop: 110,
        paddingBottom: 70,
      }}
    >
      <GridBackground />
      <div
        style={{
          position: "fixed",
          left: mousePos.x - 200,
          top: mousePos.y - 200,
          width: 400,
          height: 400,
          background: `radial-gradient(circle, ${T.cyan}10, transparent 70%)`,
          pointerEvents: "none",
          zIndex: 0,
          transition: "left 0.1s, top 0.1s",
        }}
      />

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 32px", width: "100%", position: "relative", zIndex: 1 }}>
        <div
          className="hero-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) minmax(420px, 0.9fr)",
            gap: 48,
            alignItems: "center",
          }}
        >
          {/* Left col */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 26,
                animation: "fadeUp 0.8s both",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  padding: "6px 12px",
                  background: T.cyanSubtle,
                  border: `1px solid ${T.cyan}30`,
                  borderRadius: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: T.cyan,
                    boxShadow: `0 0 10px ${T.cyan}`,
                    animation: "pulse 2s infinite",
                  }}
                />
                <span
                  style={{
                    fontFamily: F.mono,
                    fontSize: 11,
                    color: T.cyan,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  Now in early access
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.textMuted, fontSize: 13 }}>
                <span style={{ color: T.emerald }}>&#9679;</span>
                <span>Live governance active</span>
              </div>
            </div>
            <div style={{ marginBottom: 20, animation: "fadeUp 0.8s 0.05s both" }}>
              <Logo size="lg" />
            </div>
            <h1
              style={{
                fontFamily: F.display,
                fontSize: "clamp(48px, 8vw, 96px)",
                fontWeight: 700,
                lineHeight: 0.95,
                letterSpacing: "-0.04em",
                color: T.text,
                marginBottom: 28,
                maxWidth: 900,
                animation: "fadeUp 0.8s 0.1s both",
              }}
            >
              <span style={{ display: "block" }}>See risks before</span>
              <span
                style={{
                  display: "block",
                  background: `linear-gradient(135deg, ${T.cyan}, ${T.purple})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                projects fail.
              </span>
            </h1>
            <p
              style={{
                fontSize: "clamp(18px, 2vw, 22px)",
                lineHeight: 1.6,
                color: T.textMuted,
                maxWidth: 640,
                marginBottom: 36,
                animation: "fadeUp 0.8s 0.2s both",
              }}
            >
              Aliena unifies approvals, RAID, finance, and delivery into one AI-powered governance platform. Built for
              PMOs who refuse to fly blind.
            </p>
            <div
              style={{
                display: "flex",
                gap: 16,
                marginBottom: 28,
                animation: "fadeUp 0.8s 0.3s both",
                flexWrap: "wrap",
              }}
            >
              <a
                href={withUtm("mailto:support@aliena.co.uk?subject=Book%20an%20Aliena%20demo", "hero")}
                style={{
                  padding: "16px 32px",
                  background: `linear-gradient(135deg, ${T.cyan}, ${T.cyanDark})`,
                  color: T.bg,
                  fontSize: 16,
                  fontWeight: 700,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: `0 0 30px ${T.cyanGlow}`,
                  transition: "all 0.2s",
                  textDecoration: "none",
                }}
                onClick={() => trackEvent("demo_click", { placement: "hero_primary" })}
              >
                Book a demo <ArrowRight size={18} />
              </a>
              <button
                type="button"
                style={{
                  padding: "16px 32px",
                  background: "transparent",
                  color: T.text,
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 12,
                  border: `1px solid ${T.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onClick={() => {
                  trackEvent("cta_click", { placement: "hero_watch_demo" });
                  onOpenDemo();
                }}
              >
                <Play size={18} fill={T.cyan} color={T.cyan} />
                Watch demo
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 12,
                maxWidth: 760,
                animation: "fadeUp 0.8s 0.35s both",
              }}
              className="hero-proof-grid"
            >
              {[
                { icon: ShieldCheck, label: "UK GDPR aligned" },
                { icon: Lock, label: "SOC 2 Type II ready" },
                { icon: Building2, label: "Built for enterprise PMOs" },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    color: T.textSubtle,
                    fontSize: 13,
                    padding: "12px 14px",
                    background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${T.border}`,
                    borderRadius: 14,
                  }}
                >
                  <Icon size={16} color={T.emerald} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right col -- Redesigned artifact showcase */}
          <div style={{ animation: "fadeUp 0.8s 0.28s both" }}>
            <div
              style={{
                position: "relative",
                background: `linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))`,
                border: `1px solid ${T.borderHover}`,
                borderRadius: 28,
                padding: 22,
                boxShadow: "0 40px 120px rgba(0,0,0,0.45)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `radial-gradient(circle at top right, ${T.cyan}12, transparent 38%)`,
                  pointerEvents: "none",
                }}
              />

              {/* Header with Logo */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 18,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <img
                    src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
                    alt=""
                    width={38}
                    height={38}
                    style={{ filter: `drop-shadow(0 0 8px ${T.cyanGlow})` }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Portfolio intelligence</div>
                    <div style={{ fontSize: 12, color: T.textSubtle }}>PRJ-100 Project Comfort</div>
                  </div>
                </div>
                <div
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: `${T.emerald}15`,
                    border: `1px solid ${T.emerald}30`,
                    color: T.emerald,
                    fontSize: 11,
                    fontFamily: F.mono,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  live
                </div>
              </div>

              {/* Health bar */}
              <div style={{ position: "relative", zIndex: 1, marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: 11,
                      color: T.textSubtle,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Portfolio health
                  </span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: T.emerald }}>92%</span>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: T.border, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: "92%",
                      borderRadius: 4,
                      background: `linear-gradient(90deg, ${T.cyan}, ${T.emerald})`,
                      boxShadow: `0 0 12px ${T.cyanGlow}`,
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                  {[
                    { l: "1 Green", c: T.emerald },
                    { l: "0 Amber", c: T.amber },
                    { l: "0 Red", c: T.rose },
                  ].map(({ l, c }) => (
                    <span key={l} style={{ fontSize: 11, fontFamily: F.mono, color: c }}>
                      {l}
                    </span>
                  ))}
                </div>
              </div>

              {/* KPI cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: 12,
                  marginBottom: 16,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <HUDCard title="Active projects" value="1" trend="PRJ-100 on track" status="positive" />
                <HUDCard title="High-severity RAID" value="1" trend="Supply chain risk" status="warning" />
                <HUDCard title="Milestones (30d)" value="5" trend="Next: 15 Apr" status="neutral" />
                <HUDCard title="Budget" value="£102k" trend="62 days budgeted" status="positive" />
              </div>

              {/* Executive briefing card */}
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  background: `linear-gradient(135deg, ${T.purple}12, transparent)`,
                  border: `1px solid ${T.purple}30`,
                  borderRadius: 20,
                  padding: 16,
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Sparkles size={15} color={T.purple} />
                  <span style={{ fontWeight: 700, color: T.text, fontSize: 14 }}>Executive briefing</span>
                  <span
                    style={{
                      marginLeft: "auto",
                      padding: "3px 8px",
                      borderRadius: 999,
                      background: `${T.amber}18`,
                      border: `1px solid ${T.amber}30`,
                      color: T.amber,
                      fontSize: 10,
                      fontFamily: F.mono,
                      textTransform: "uppercase",
                    }}
                  >
                    Monitor
                  </span>
                </div>
                <p style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.7, marginBottom: 12 }}>
                  Portfolio performing well overall. One high-severity RAID item open on PRJ-100 (supply chain risk)
                  requires attention. Delivery signals are on track.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    { l: "Health: 92%", c: T.emerald },
                    { l: "RAID: PRJ-100", c: T.amber },
                    { l: "Budget: on track", c: T.cyan },
                  ].map(({ l, c }) => (
                    <span
                      key={l}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        background: `${c}12`,
                        border: `1px solid ${c}30`,
                        color: c,
                      }}
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </div>

              {/* RAID item */}
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  background: T.bgCard,
                  border: `1px solid ${T.border}`,
                  borderRadius: 18,
                  padding: 16,
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <AlertTriangle size={14} color={T.amber} />
                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: 10,
                      color: T.textSubtle,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Open RAID
                  </span>
                  <span style={{ marginLeft: "auto", fontFamily: F.mono, fontSize: 10, color: T.textSubtle }}>
                    PRJ-100
                  </span>
                </div>
                <div style={{ borderLeft: `3px solid ${T.amber}`, paddingLeft: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 6 }}>
                    Potential Project Delay Due to Supply Chain Issues
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontSize: 11,
                        background: `${T.amber}18`,
                        color: T.amber,
                        fontWeight: 600,
                      }}
                    >
                      High
                    </span>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontSize: 11,
                        background: T.border,
                        color: T.textMuted,
                      }}
                    >
                      Open
                    </span>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontSize: 11,
                        background: T.border,
                        color: T.textMuted,
                      }}
                    >
                      Risk
                    </span>
                  </div>
                </div>
              </div>

              {/* Milestones */}
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  background: T.bgCard,
                  border: `1px solid ${T.border}`,
                  borderRadius: 18,
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Target size={14} color={T.cyan} />
                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: 10,
                      color: T.textSubtle,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Upcoming milestones
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: T.textSubtle }}>5 in 30 days</span>
                </div>
                {[
                  { name: "Kick-off complete", date: "15 Apr", rag: T.emerald },
                  { name: "Design sign-off", date: "22 Apr", rag: T.cyan },
                  { name: "Prototype ready", date: "30 Apr", rag: T.amber },
                ].map((m, i) => (
                  <div
                    key={m.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom: i < 2 ? `1px solid ${T.border}` : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: m.rag,
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${m.rag}`,
                      }}
                    />
                    <span style={{ flex: 1, fontSize: 13, color: T.textMuted }}>{m.name}</span>
                    <span style={{ fontSize: 12, fontFamily: F.mono, color: T.textSubtle }}>{m.date}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 26,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          color: T.textSubtle,
          fontSize: 11,
          fontFamily: F.mono,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          animation: "fadeUp 1s 0.6s both",
        }}
      >
        <span>Scroll to explore</span>
        <ChevronDown size={20} />
      </div>
    </section>
  );
}

function DashboardPreview() {
  return (
    <section id="intelligence" style={{ padding: "120px 0", position: "relative" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 32px" }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: T.purpleGlow,
              border: `1px solid ${T.purple}40`,
              borderRadius: 20,
              marginBottom: 16,
            }}
          >
            <Sparkles size={14} color={T.purple} />
            <span style={{ fontFamily: F.mono, fontSize: 11, color: T.purple, letterSpacing: "0.1em" }}>
              Live Intelligence Preview
            </span>
          </div>
          <h2
            style={{
              fontFamily: F.display,
              fontSize: "clamp(32px, 4vw, 48px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              marginBottom: 16,
            }}
          >
            Command your portfolio from <span style={{ color: T.cyan }}>one view</span>
          </h2>
          <p style={{ color: T.textMuted, fontSize: 18, maxWidth: 600, margin: "0 auto" }}>
            Real-time governance intelligence that surfaces what matters before it escalates.
          </p>
        </div>
        <div
          style={{
            background: T.bgElevated,
            border: `1px solid ${T.border}`,
            borderRadius: 24,
            overflow: "hidden",
            boxShadow: "0 40px 100px rgba(0,0,0,0.5)",
          }}
        >
          <div
            style={{
              padding: "16px 20px",
              background: T.surface,
              borderBottom: `1px solid ${T.border}`,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: T.rose }} />
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: T.amber }} />
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: T.emerald }} />
            </div>
            <div
              style={{
                flex: 1,
                maxWidth: 400,
                margin: "0 auto",
                padding: "6px 12px",
                background: T.bgCard,
                borderRadius: 8,
                fontSize: 12,
                color: T.textSubtle,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Lock size={12} /> app.aliena.co.uk/portfolio/executive-view
            </div>
          </div>
          <div style={{ padding: 24, display: "grid", gap: 24 }}>
            <div className="metrics-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {[
                { label: "Active Projects", value: "17", trend: "+3 this quarter", status: "positive" as const },
                { label: "Approval SLA", value: "4.2d", trend: "2 pending escalation", status: "warning" as const },
                { label: "Budget Variance", value: "1.2M", trend: "Under forecast", status: "positive" as const },
                { label: "AI Insights", value: "27", trend: "3 critical", status: "neutral" as const },
              ].map((m, i) => (
                <HUDCard key={m.label} {...m} delay={i * 0.1} />
              ))}
            </div>
            <div className="preview-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, height: 500 }}>
              <div
                style={{
                  background: T.bgCard,
                  border: `1px solid ${T.border}`,
                  borderRadius: 16,
                  padding: 20,
                  position: "relative",
                }}
              >
                <div style={{ position: "absolute", top: 20, left: 20, display: "flex", alignItems: "center", gap: 8 }}>
                  <Network size={16} color={T.cyan} />
                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: 11,
                      color: T.textSubtle,
                      letterSpacing: "0.05em",
                    }}
                  >
                    GOVERNANCE TOPOLOGY
                  </span>
                </div>
                <GovernanceGraph />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div
                  style={{
                    background: T.bgCard,
                    border: `1px solid ${T.border}`,
                    borderRadius: 16,
                    padding: 20,
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      fontFamily: F.mono,
                      fontSize: 10,
                      color: T.textSubtle,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      marginBottom: 16,
                    }}
                  >
                    Critical Alerts
                  </div>
                  {[
                    { type: "risk", msg: "Resource over-allocation in Programme Alpha", time: "2m ago" },
                    { type: "approval", msg: "Financial plan awaiting board sign-off", time: "1h ago" },
                    { type: "milestone", msg: "Q3 deliverable at risk", time: "3h ago" },
                  ].map((a, i) => (
                    <div
                      key={i}
                      style={{
                        padding: 12,
                        background: T.surface,
                        borderRadius: 8,
                        marginBottom: 8,
                        borderLeft: `2px solid ${a.type === "risk" ? T.rose : a.type === "approval" ? T.amber : T.cyan}`,
                      }}
                    >
                      <div style={{ fontSize: 13, color: T.text, marginBottom: 4 }}>{a.msg}</div>
                      <div style={{ fontSize: 11, color: T.textSubtle }}>{a.time}</div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    background: `linear-gradient(135deg, ${T.purple}10, transparent)`,
                    border: `1px solid ${T.purple}30`,
                    borderRadius: 16,
                    padding: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <Brain size={18} color={T.purple} />
                    <span style={{ fontWeight: 600, color: T.text }}>AI Synthesis</span>
                  </div>
                  <p style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6 }}>
                    "Two approvals and resource constraints suggest portfolio confidence may decline by 15% next week."
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureGrid() {
  const features = [
    {
      icon: Shield,
      title: "Governance Control",
      desc: "Structured approvals with full audit trails and delegated authority matrices.",
      color: T.cyan,
    },
    {
      icon: Zap,
      title: "Live Risk Detection",
      desc: "AI-powered signals that surface delivery pressure before it becomes failure.",
      color: T.amber,
    },
    {
      icon: BarChart3,
      title: "Financial Command",
      desc: "Budget, forecast, and actuals unified with early variance detection.",
      color: T.emerald,
    },
    {
      icon: Users,
      title: "Resource Intelligence",
      desc: "Capacity heatmaps and allocation optimization across programmes.",
      color: T.purple,
    },
    {
      icon: Brain,
      title: "AI Governance",
      desc: "Natural-language insights and executive summaries generated automatically.",
      color: T.purple,
    },
    {
      icon: Lock,
      title: "Enterprise Security",
      desc: "Row-level security, audit trails, and UK-hosted infrastructure.",
      color: T.cyan,
    },
  ];

  return (
    <section id="platform" style={{ padding: "120px 0" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 32px" }}>
        <div style={{ textAlign: "center", marginBottom: 80 }}>
          <h2
            style={{
              fontFamily: F.display,
              fontSize: "clamp(32px, 4vw, 48px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              marginBottom: 16,
            }}
          >
            Five pillars. <span style={{ color: T.cyan }}>One platform.</span>
          </h2>
          <p style={{ color: T.textMuted, fontSize: 18, maxWidth: 600, margin: "0 auto" }}>
            Everything you need to govern complex delivery at scale.
          </p>
        </div>
        <div className="feature-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
          {features.map((f) => (
            <div
              key={f.title}
              style={{
                background: T.bgElevated,
                border: `1px solid ${T.border}`,
                borderRadius: 20,
                padding: 32,
                transition: "all 0.3s",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = f.color;
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.boxShadow = `0 20px 40px ${f.color}10`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: `${f.color}15`,
                  border: `1px solid ${f.color}30`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <f.icon size={24} color={f.color} />
              </div>
              <h3 style={{ fontFamily: F.display, fontSize: 20, fontWeight: 600, marginBottom: 12, color: T.text }}>
                {f.title}
              </h3>
              <p style={{ color: T.textMuted, fontSize: 15, lineHeight: 1.7 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ComparisonSection() {
  return (
    <section style={{ padding: "120px 0", background: T.bgElevated }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 32px" }}>
        <div style={{ textAlign: "center", marginBottom: 80 }}>
          <h2
            style={{
              fontFamily: F.display,
              fontSize: "clamp(32px, 4vw, 48px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              marginBottom: 16,
            }}
          >
            Traditional tools record.
            <br />
            <span style={{ color: T.cyan }}>Aliena interprets.</span>
          </h2>
        </div>
        <div
          className="comparison-grid"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, maxWidth: 1000, margin: "0 auto" }}
        >
          <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 24, padding: 32 }}>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: T.textSubtle,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 24,
              }}
            >
              Traditional PM Tools
            </div>
            {[
              "Static reports assembled after the fact",
              "Disconnected approvals and governance",
              "RAID logs requiring manual interpretation",
              "Executive visibility arrives too late",
              "No early warning before issues escalate",
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom: i < 4 ? `1px solid ${T.border}` : "none",
                  color: T.textMuted,
                }}
              >
                <X size={16} color={T.rose} />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              background: `linear-gradient(135deg, ${T.cyan}08, transparent)`,
              border: `1px solid ${T.cyan}40`,
              borderRadius: 24,
              padding: 32,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                padding: "8px 16px",
                background: T.cyan,
                color: T.bg,
                fontSize: 11,
                fontWeight: 700,
                borderBottomLeftRadius: 12,
              }}
            >
              ALIENA AI
            </div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: T.cyan,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 24,
              }}
            >
              AI-Powered Governance
            </div>
            {[
              "Live delivery intelligence with AI summaries",
              "Traceable approval flows with full audit trails",
              "Risk signals surfaced automatically",
              "One control layer for all stakeholders",
              "Change control tracked before it moves",
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom: i < 4 ? `1px solid ${T.border}` : "none",
                  color: T.text,
                }}
              >
                <CheckCircle2 size={16} color={T.emerald} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SecuritySection() {
  return (
    <section id="security" style={{ padding: "120px 0" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 32px" }}>
        <div style={{ textAlign: "center", marginBottom: 70 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: `${T.cyan}10`,
              border: `1px solid ${T.cyan}30`,
              borderRadius: 999,
              marginBottom: 14,
            }}
          >
            <Shield size={14} color={T.cyan} />
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: T.cyan,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Security
            </span>
          </div>
          <h2
            style={{
              fontFamily: F.display,
              fontSize: "clamp(32px, 4vw, 48px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              marginBottom: 16,
            }}
          >
            Enterprise-grade trust by <span style={{ color: T.cyan }}>design</span>
          </h2>
          <p style={{ color: T.textMuted, fontSize: 18, maxWidth: 700, margin: "0 auto" }}>
            Built for secure governance workflows with access control, auditability, and operational visibility.
          </p>
        </div>
        <div className="security-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
          {[
            {
              icon: Lock,
              title: "Access control",
              desc: "Role-based permissions and row-level controls help ensure people only see what they should.",
            },
            {
              icon: FileCheck,
              title: "Audit trails",
              desc: "Changes, approvals, and decision flows are traceable across governance artifacts.",
            },
            {
              icon: ShieldCheck,
              title: "Operational assurance",
              desc: "Designed for PMO environments that need structure, evidence, and accountability.",
            },
          ].map((item) => (
            <div
              key={item.title}
              style={{
                background: T.bgElevated,
                border: `1px solid ${T.border}`,
                borderRadius: 20,
                padding: 28,
              }}
            >
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 14,
                  background: `${T.cyan}15`,
                  border: `1px solid ${T.cyan}30`,
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 18,
                }}
              >
                <item.icon size={22} color={T.cyan} />
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{item.title}</h3>
              <p style={{ fontSize: 15, color: T.textMuted, lineHeight: 1.7 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" style={{ padding: "120px 0", background: T.bgElevated }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: `${T.amber}12`,
              border: `1px solid ${T.amber}30`,
              borderRadius: 999,
              marginBottom: 14,
            }}
          >
            <Clock3 size={14} color={T.amber} />
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: T.amber,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Early access pricing
            </span>
          </div>
          <h2
            style={{
              fontFamily: F.display,
              fontSize: "clamp(32px, 4vw, 48px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              marginBottom: 16,
            }}
          >
            Start with a pilot, then scale with confidence.
          </h2>
          <p style={{ color: T.textMuted, fontSize: 18, maxWidth: 720, margin: "0 auto" }}>
            Get started with a focused pilot on one programme. Expand when you see the value.
          </p>
        </div>
        <div
          className="pricing-grid"
          style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 24, alignItems: "stretch" }}
        >
          <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 24, padding: 30 }}>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: T.textSubtle,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              For early conversations
            </div>
            <h3 style={{ fontSize: 28, fontWeight: 700, marginBottom: 10 }}>Pilot engagement</h3>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 44, fontWeight: 800, color: T.cyan }}>Custom</span>
              <span style={{ color: T.textSubtle }}>scoped pilot</span>
            </div>
            <p style={{ color: T.textMuted, lineHeight: 1.7, marginBottom: 22 }}>
              Ideal for PMOs who want to validate Aliena on one programme before a broader rollout.
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              {[
                "Focused setup for one pilot use case",
                "Executive walkthrough and onboarding",
                "Working governance and reporting flow",
                "Success criteria agreed up front",
              ].map((item) => (
                <div key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", color: T.textMuted }}>
                  <Check size={16} color={T.emerald} style={{ marginTop: 3, flexShrink: 0 }} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              background: `linear-gradient(135deg, ${T.cyan}10, rgba(255,255,255,0.03))`,
              border: `1px solid ${T.cyan}30`,
              borderRadius: 24,
              padding: 30,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                padding: "8px 12px",
                borderRadius: 999,
                background: `${T.cyan}18`,
                border: `1px solid ${T.cyan}35`,
                color: T.cyan,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Recommended
            </div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: T.cyan,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              Enterprise PMO fit
            </div>
            <h3 style={{ fontSize: 28, fontWeight: 800, marginBottom: 10 }}>Book a pricing conversation</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, marginBottom: 24 }}>
              Get a commercial proposal aligned to your programme scope and team size.
            </p>
            <div style={{ display: "grid", gap: 14, marginBottom: 26 }}>
              {[
                "Pilot-first commercial approach",
                "Scaled rollout for PMO and delivery leadership",
                "Optional AI governance workflows and executive views",
                "Support for security and deployment discussions",
              ].map((item) => (
                <div key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", color: T.text }}>
                  <CheckCircle2 size={17} color={T.emerald} style={{ marginTop: 3, flexShrink: 0 }} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <a
              href={withUtm("mailto:support@aliena.co.uk?subject=Pricing%20conversation%20for%20Aliena", "pricing")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "16px 24px",
                borderRadius: 12,
                background: `linear-gradient(135deg, ${T.cyan}, ${T.cyanDark})`,
                color: T.bg,
                fontWeight: 800,
                textDecoration: "none",
                boxShadow: `0 0 32px ${T.cyanGlow}`,
              }}
              onClick={() => trackEvent("cta_click", { placement: "pricing" })}
            >
              Talk pricing <ArrowRight size={18} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection({
  onOpenDemo,
}: {
  onOpenDemo: () => void;
}) {
  return (
    <section style={{ padding: "160px 0", position: "relative", overflow: "hidden" }}>
      <div
        style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, ${T.cyan}08, transparent 70%)` }}
      />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 32px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            background: T.cyanSubtle,
            border: `1px solid ${T.cyan}30`,
            borderRadius: 20,
            marginBottom: 24,
          }}
        >
          <Sparkles size={16} color={T.cyan} />
          <span style={{ fontFamily: F.mono, fontSize: 12, color: T.cyan }}>Ready to transform your PMO?</span>
        </div>
        <h2
          style={{
            fontFamily: F.display,
            fontSize: "clamp(40px, 6vw, 64px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            marginBottom: 24,
            lineHeight: 1.1,
          }}
        >
          Bring <span style={{ color: T.cyan }}>governance intelligence</span> to your portfolio.
        </h2>
        <p style={{ color: T.textMuted, fontSize: 18, marginBottom: 16, maxWidth: 680, marginInline: "auto" }}>
          Join early access and be among the first to experience AI-powered programme governance.
        </p>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 999,
            border: `1px solid ${T.amber}30`,
            background: `${T.amber}10`,
            color: T.amber,
            marginBottom: 36,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <Clock3 size={14} />
          Early access pilot slots are limited
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
          <a
            href={withUtm("mailto:support@aliena.co.uk?subject=Book%20an%20Aliena%20demo", "final_cta")}
            style={{
              display: "inline-flex",
              padding: "18px 36px",
              background: `linear-gradient(135deg, ${T.cyan}, ${T.cyanDark})`,
              color: T.bg,
              fontSize: 16,
              fontWeight: 800,
              borderRadius: 12,
              alignItems: "center",
              gap: 8,
              boxShadow: `0 0 40px ${T.cyanGlow}`,
              transition: "all 0.2s",
              textDecoration: "none",
            }}
            onClick={() => trackEvent("demo_click", { placement: "final_cta" })}
          >
            Book your demo <ArrowRight size={18} />
          </a>
          <button
            type="button"
            onClick={() => {
              trackEvent("cta_click", { placement: "final_watch_demo" });
              onOpenDemo();
            }}
            style={{
              display: "inline-flex",
              padding: "18px 28px",
              background: "transparent",
              color: T.text,
              fontSize: 16,
              fontWeight: 700,
              borderRadius: 12,
              alignItems: "center",
              gap: 8,
              border: `1px solid ${T.border}`,
              cursor: "pointer",
            }}
          >
            <Play size={18} fill={T.cyan} color={T.cyan} />
            Watch demo
          </button>
        </div>
      </div>
    </section>
  );
}

function Footer({
  onOpenDemo,
}: {
  onOpenDemo: () => void;
}) {
  const productLinks = [
    { label: "Platform", href: "#platform" },
    { label: "Intelligence", href: "#intelligence" },
    { label: "Security", href: "#security" },
    { label: "Pricing", href: "#pricing" },
  ];

  const resourceLinks = [
    { label: "Documentation", href: "#platform" },
    { label: "API Reference", href: "mailto:support@aliena.co.uk?subject=Aliena%20API%20reference%20request" },
    { label: "Contact", href: "mailto:support@aliena.co.uk?subject=Enquiry%20about%20Aliena" },
  ];

  const legalLinks = [
    { label: "Privacy", href: "#" },
    { label: "Terms", href: "#" },
    { label: "Cookies", href: "#" },
  ];

  return (
    <footer style={{ borderTop: `1px solid ${T.border}`, padding: "80px 0 40px", background: T.bg }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 32px" }}>
        <div className="footer-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 60, marginBottom: 60 }}>
          <div>
            <Logo size="md" />
            <p style={{ marginTop: 20, color: T.textMuted, fontSize: 14, lineHeight: 1.7, maxWidth: 320 }}>
              AI-powered governance platform for complex programme delivery. Built in the UK for enterprise PMOs.
            </p>
            <a
              href={withUtm("mailto:support@aliena.co.uk", "footer_brand")}
              style={{
                marginTop: 18,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                color: T.cyan,
                textDecoration: "none",
                fontWeight: 700,
              }}
              onClick={() => trackEvent("demo_click", { placement: "footer_brand" })}
            >
              <Mail size={16} />
              support@aliena.co.uk
            </a>
          </div>
          <div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: T.textSubtle,
                letterSpacing: "0.1em",
                marginBottom: 20,
              }}
            >
              PRODUCT
            </div>
            {productLinks.map((item) => (
              <AnchorLink
                key={item.label}
                href={item.href}
                style={{ display: "block", color: T.textMuted, fontSize: 14, padding: "8px 0", textDecoration: "none" }}
              >
                {item.label}
              </AnchorLink>
            ))}
            <button
              onClick={() => {
                trackEvent("cta_click", { placement: "footer_watch_demo" });
                onOpenDemo();
              }}
              style={{
                display: "block",
                color: T.textMuted,
                fontSize: 14,
                padding: "8px 0",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Watch demo
            </button>
          </div>
          <div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: T.textSubtle,
                letterSpacing: "0.1em",
                marginBottom: 20,
              }}
            >
              RESOURCES
            </div>
            {resourceLinks.map((item) =>
              item.href.startsWith("#") ? (
                <AnchorLink
                  key={item.label}
                  href={item.href}
                  style={{ display: "block", color: T.textMuted, fontSize: 14, padding: "8px 0", textDecoration: "none" }}
                >
                  {item.label}
                </AnchorLink>
              ) : (
                <a
                  key={item.label}
                  href={withUtm(item.href, "footer_resources")}
                  style={{ display: "block", color: T.textMuted, fontSize: 14, padding: "8px 0", textDecoration: "none" }}
                >
                  {item.label}
                </a>
              )
            )}
          </div>
          <div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: T.textSubtle,
                letterSpacing: "0.1em",
                marginBottom: 20,
              }}
            >
              LEGAL
            </div>
            {legalLinks.map((item) => (
              <a key={item.label} href={item.href} style={{ display: "block", color: T.textMuted, fontSize: 14, padding: "8px 0", textDecoration: "none" }}>
                {item.label}
              </a>
            ))}
          </div>
        </div>
        <div
          style={{
            borderTop: `1px solid ${T.border}`,
            paddingTop: 40,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 20,
          }}
        >
          <span style={{ color: T.textSubtle, fontSize: 13 }}>&copy; 2026 Aliena AI. Built in the UK.</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.textSubtle, fontSize: 13 }}>
            <div
              style={{ width: 8, height: 8, borderRadius: "50%", background: T.emerald, boxShadow: `0 0 10px ${T.emerald}` }}
            />
            All systems operational
          </div>
        </div>
      </div>
    </footer>
  );
}

function CommandBar({
  onOpenDemo,
}: {
  onOpenDemo: () => void;
}) {
  return (
    <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
      <button
        type="button"
        onClick={() => {
          trackEvent("cta_click", { placement: "command_bar" });
          onOpenDemo();
        }}
        style={{
          background: "rgba(17, 19, 24, 0.9)",
          backdropFilter: "blur(20px)",
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          color: T.text,
          cursor: "pointer",
        }}
      >
        <img
          src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
          alt=""
          width={28}
          height={28}
          style={{ filter: `drop-shadow(0 0 6px ${T.cyanGlow})` }}
        />
        <div style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Aliena AI</span>
          <span style={{ fontSize: 11, color: T.textMuted }}>Book a live walkthrough...</span>
        </div>
        <div
          style={{
            padding: "4px 8px",
            background: T.surface,
            borderRadius: 6,
            fontFamily: F.mono,
            fontSize: 11,
            color: T.textSubtle,
            border: `1px solid ${T.border}`,
          }}
        >
          &#8984;K
        </div>
      </button>
    </div>
  );
}

export default function LandingPage() {
  const [demoOpen, setDemoOpen] = useState(false);
  const openDemo = useCallback(() => {
    setDemoOpen(true);
    trackEvent("watch_demo_open");
  }, []);
  const closeDemo = useCallback(() => {
    setDemoOpen(false);
    trackEvent("watch_demo_close");
  }, []);
  useEffect(() => {
    trackEvent("landing_page_view");
  }, []);

  return (
    <main style={{ background: T.bg, color: T.text, fontFamily: F.display, minHeight: "100vh", overflowX: "hidden" }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(30px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        @keyframes float { 0%,100% { transform:translate(0,0); } 25% { transform:translate(10px,-10px); } 50% { transform:translate(20px,0); } 75% { transform:translate(10px,10px); } }
        * { box-sizing:border-box; }
        html { scroll-behavior:smooth; }
        body { margin:0; }
        ::selection { background:${T.cyan}40; color:${T.text}; }
        @media (max-width:1180px) {
          .hero-grid,.preview-grid,.pricing-grid,.comparison-grid,.footer-grid { grid-template-columns:1fr !important; }
          .metrics-grid { grid-template-columns:repeat(2, 1fr) !important; }
          .feature-grid,.resources-grid,.security-grid { grid-template-columns:repeat(2, 1fr) !important; }
        }
        @media (max-width:920px) {
          .desktop-nav { display:none !important; }
          .mobile-nav-button { display:flex !important; }
          .mobile-nav-panel { display:block !important; }
          .hero-proof-grid,.metrics-grid,.feature-grid,.security-grid { grid-template-columns:1fr !important; }
        }
        @media (max-width:720px) {
          .preview-grid { height:auto !important; }
        }
      `}</style>
      <Navigation onOpenDemo={openDemo} />
      <HeroSection onOpenDemo={openDemo} />
      <DashboardPreview />
      <FeatureGrid />
      <ComparisonSection />
      <SecuritySection />
      <PricingSection />
      <CTASection onOpenDemo={openDemo} />
      <Footer onOpenDemo={openDemo} />
      <CommandBar onOpenDemo={openDemo} />
      <DemoModal open={demoOpen} onClose={closeDemo} />
    </main>
  );
}