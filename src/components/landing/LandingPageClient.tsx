"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Brain,
  Building2,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileCheck,
  Lock,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  Zap,
  Play,
  X,
  Menu,
  ChevronDown,
  Globe,
  Clock,
  ShieldCheck,
  Award,
  Target,
  Layers,
  ArrowUpRight,
  Minus,
  Plus,
  Search,
  Bell,
  Settings,
  MoreHorizontal,
  Filter,
  Download,
  Calendar,
  MessageSquare,
  PieChart,
  Hexagon,
  Triangle,
  Circle,
  Square,
  Pentagon,
  Octagon,
  Star,
  Diamond,
  TriangleRight,
  LayoutGrid,
  Workflow,
  GitBranch,
  Network,
  Radio,
  Signal,
  Wifi,
  ZapIcon,
  Lightning,
  CpuIcon,
  Scan,
  Eye,
  Fingerprint,
  Key,
  Unlock,
  ScanFace,
  ScanLine,
  QrCode,
  Barcode,
  FingerprintIcon,
  ScanEye,
  FileSearch,
  FileText,
  FileSpreadsheet,
  FileJson,
  FileCode,
  FileType,
  FileStack,
  FolderKanban,
  FolderGit2,
  FolderOpen,
  FolderTree,
  FolderCog,
  FolderCheck,
  FolderLock,
  FolderHeart,
  FolderPlus,
  FolderMinus,
  FolderX,
  FolderSearch,
  FolderSync,
  FolderArchive,
  FolderRoot,
  FolderKanbanIcon,
  FolderKanbanSquare,
  FolderKanbanSquareIcon,
} from "lucide-react";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
    plausible?: (event: string, options?: { props?: Record<string, unknown> }) => void;
  }
}

// --- Design Tokens -----------------------------------------------------------

const T = {
  // Primary palette - Deep space with electric cyan
  cyan: "#00D4FF",
  cyanDark: "#00A8CC",
  cyanGlow: "rgba(0, 212, 255, 0.4)",
  cyanSubtle: "rgba(0, 212, 255, 0.08)",
  
  // Secondary accents
  purple: "#8B5CF6",
  purpleGlow: "rgba(139, 92, 246, 0.4)",
  emerald: "#10B981",
  emeraldGlow: "rgba(16, 185, 129, 0.4)",
  amber: "#F59E0B",
  rose: "#F43F5E",
  
  // Neutrals - Warm darks instead of cold blacks
  bg: "#0A0C0F",
  bgElevated: "#111318",
  bgCard: "#15171D",
  surface: "#1A1D24",
  surfaceHover: "#22262E",
  
  // Text hierarchy
  text: "#FAFBFC",
  textMuted: "#9CA3AF",
  textSubtle: "#6B7280",
  textGhost: "#4B5563",
  
  // Borders & effects
  border: "rgba(255, 255, 255, 0.06)",
  borderHover: "rgba(0, 212, 255, 0.2)",
  glow: "0 0 40px rgba(0, 212, 255, 0.15)",
  glowStrong: "0 0 60px rgba(0, 212, 255, 0.25)",
};

const F = {
  display: "var(--font-geist-sans), system-ui, sans-serif",
  mono: "var(--font-geist-mono), 'SF Mono', monospace",
};

// --- Utilities ---------------------------------------------------------------

type TrackPayload = Record<string, string | number | boolean | null | undefined>;

function trackEvent(name: string, payload: TrackPayload = {}) {
  if (typeof window === "undefined") return;
  try {
    window.gtag?.("event", name, payload);
    window.dataLayer?.push({ event: name, ...payload });
    window.plausible?.(name, { props: payload });
    window.dispatchEvent(
      new CustomEvent("aliena:track", {
        detail: { name, payload, ts: Date.now() },
      })
    );
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

// --- Components -------------------------------------------------------------

/* Logo */
function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" | "xl" }) {
  const s = {
    sm: { icon: 24, text: 16, gap: 8 },
    md: { icon: 32, text: 20, gap: 10 },
    lg: { icon: 44, text: 28, gap: 12 },
    xl: { icon: 56, text: 36, gap: 14 },
  }[size];

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: s.gap }}>
      <div
        style={{
          width: s.icon,
          height: s.icon,
          borderRadius: 10,
          background: `linear-gradient(135deg, ${T.cyan}20, ${T.purple}20)`,
          border: `1px solid ${T.cyan}30`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(circle at 30% 30%, ${T.cyan}40, transparent 70%)`,
          }}
        />
        <ScanEye size={s.icon * 0.55} color={T.cyan} style={{ position: "relative", zIndex: 1 }} />
      </div>
      <span
        style={{
          fontFamily: F.display,
          letterSpacing: "0.12em",
          fontWeight: 600,
          fontSize: s.text,
          color: T.text,
          display: "inline-flex",
          alignItems: "baseline",
        }}
      >
        <span style={{ color: T.cyan, fontWeight: 700 }}>?</span>
        <span>L</span>
        <span style={{ color: T.cyan }}>I</span>
        <span>?</span>
        <span>N</span>
        <span style={{ color: T.cyan }}>?</span>
      </span>
    </span>
  );
}

/* Animated Background Grid */
function GridBackground() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {/* Base grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(to right, ${T.border} 1px, transparent 1px),
            linear-gradient(to bottom, ${T.border} 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
        }}
      />
      
      {/* Animated gradient orbs */}
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
      
      {/* Scan lines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/* HUD-style Data Card */
function HUDCard({ 
  children, 
  title, 
  value, 
  trend, 
  status = "neutral",
  delay = 0,
}: { 
  children?: React.ReactNode;
  title: string;
  value: string;
  trend?: string;
  status?: "positive" | "negative" | "warning" | "neutral";
  delay?: number;
}) {
  const statusColors = {
    positive: T.emerald,
    negative: T.rose,
    warning: T.amber,
    neutral: T.cyan,
  };

  return (
    <div
      className="hud-card"
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
      {/* Corner accents */}
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
      
      <div style={{ fontFamily: F.display, fontSize: 32, fontWeight: 700, color: T.text, letterSpacing: "-0.02em", marginBottom: 4 }}>
        {value}
      </div>
      
      {trend && (
        <div style={{ fontFamily: F.mono, fontSize: 11, color: status === "positive" ? T.emerald : status === "negative" ? T.rose : T.textMuted }}>
          {trend}
        </div>
      )}
      
      {children}
    </div>
  );
}

/* Interactive Governance Graph */
function GovernanceGraph() {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const nodes = useMemo(() => [
    { id: "programme", x: 50, y: 15, label: "Programme", sub: "Portfolio", icon: Building2, color: T.cyan, health: 92, size: 1.2 },
    { id: "pmo", x: 25, y: 35, label: "PMO Hub", sub: "Governance", icon: Users, color: T.cyan, health: 88, size: 1 },
    { id: "finance", x: 50, y: 35, label: "Finance", sub: "Budget", icon: Wallet, color: T.emerald, health: 95, size: 1 },
    { id: "delivery", x: 75, y: 35, label: "Delivery", sub: "Execution", icon: TrendingUp, color: T.amber, health: 78, size: 1 },
    { id: "approvals", x: 15, y: 55, label: "Approvals", sub: "4 Pending", icon: FileCheck, color: T.amber, health: 65, size: 0.9 },
    { id: "raid", x: 35, y: 55, label: "RAID", sub: "12 Active", icon: AlertTriangle, color: T.rose, health: 72, size: 0.9 },
    { id: "variance", x: 50, y: 55, label: "Variance", sub: "£1.2M", icon: Activity, color: T.amber, health: 58, size: 0.9 },
    { id: "milestones", x: 65, y: 55, label: "Milestones", sub: "3 At Risk", icon: Target, color: T.amber, health: 81, size: 0.9 },
    { id: "resources", x: 85, y: 55, label: "Resources", sub: "Overallocated", icon: Users, color: T.rose, health: 45, size: 0.9 },
    { id: "ai", x: 50, y: 75, label: "AI Core", sub: "Intelligence", icon: Brain, color: T.purple, health: 99, size: 1.3, pulse: true },
    { id: "reporting", x: 50, y: 90, label: "Executive", sub: "Unified View", icon: BarChart3, color: T.cyan, health: 100, size: 1.1 },
  ], []);

  const edges = useMemo(() => [
    ["programme", "pmo"], ["programme", "finance"], ["programme", "delivery"],
    ["pmo", "approvals"], ["pmo", "raid"], ["finance", "variance"],
    ["delivery", "milestones"], ["delivery", "resources"],
    ["approvals", "ai"], ["raid", "ai"], ["variance", "ai"],
    ["milestones", "ai"], ["resources", "ai"],
    ["ai", "reporting"], ["finance", "reporting"],
  ], []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      ctx.scale(2, 2);
    };
    
    resize();
    window.addEventListener("resize", resize);

    let animationId: number;
    let time = 0;

    const animate = () => {
      time += 0.016;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      // Draw edges with data flow animation
      edges.forEach(([from, to], i) => {
        const fromNode = nodes.find(n => n.id === from)!;
        const toNode = nodes.find(n => n.id === to)!;
        
        const x1 = (fromNode.x / 100) * width;
        const y1 = (fromNode.y / 100) * height;
        const x2 = (toNode.x / 100) * width;
        const y2 = (toNode.y / 100) * height;

        const isHighlighted = hoveredNode === from || hoveredNode === to || activeNode === from || activeNode === to;
        
        // Connection line
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = isHighlighted ? T.cyan : T.border;
        ctx.lineWidth = isHighlighted ? 2 : 1;
        ctx.setLineDash(isHighlighted ? [] : [5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Animated data packet
        const progress = (time * 0.5 + i * 0.3) % 1;
        const px = x1 + (x2 - x1) * progress;
        const py = y1 + (y2 - y1) * progress;
        
        ctx.beginPath();
        ctx.arc(px, py, isHighlighted ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = to === "ai" ? T.purple : T.cyan;
        ctx.shadowBlur = 10;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Draw nodes
      nodes.forEach(node => {
        const x = (node.x / 100) * width;
        const y = (node.y / 100) * height;
        const isHovered = hoveredNode === node.id;
        const isActive = activeNode === node.id;
        const radius = 28 * node.size;

        // Pulse effect for AI node
        if (node.pulse) {
          const pulseRadius = radius + 10 + Math.sin(time * 2) * 5;
          ctx.beginPath();
          ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `${T.purple}40`;
          ctx.lineWidth = 2;
          ctx.stroke();
          
          const pulseRadius2 = radius + 20 + Math.sin(time * 2 + 1) * 8;
          ctx.beginPath();
          ctx.arc(x, y, pulseRadius2, 0, Math.PI * 2);
          ctx.strokeStyle = `${T.purple}20`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Outer glow
        if (isHovered || isActive) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
          ctx.fillStyle = `${node.color}20`;
          ctx.fill();
          
          ctx.beginPath();
          ctx.arc(x, y, radius + 12, 0, Math.PI * 2);
          ctx.strokeStyle = `${node.color}40`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Health ring
        if (node.health) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 4, -Math.PI / 2, -Math.PI / 2 + (node.health / 100) * Math.PI * 2);
          ctx.strokeStyle = node.health > 80 ? T.emerald : node.health > 60 ? T.amber : T.rose;
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.stroke();
        }

        // Node body
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = T.bgElevated;
        ctx.fill();
        ctx.strokeStyle = isHovered || isActive ? node.color : T.border;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Health percentage
        if (node.health && (isHovered || isActive)) {
          ctx.font = `600 11px ${F.mono}`;
          ctx.fillStyle = node.health > 80 ? T.emerald : node.health > 60 ? T.amber : T.rose;
          ctx.textAlign = "center";
          ctx.fillText(`${node.health}%`, x, y - radius - 10);
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
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          
          const hovered = nodes.find(n => {
            const nx = n.x;
            const ny = n.y;
            const dist = Math.sqrt((x - nx) ** 2 + (y - ny) ** 2);
            return dist < 8;
          });
          
          setHoveredNode(hovered?.id || null);
        }}
        onClick={() => {
          if (hoveredNode) {
            setActiveNode(activeNode === hoveredNode ? null : hoveredNode);
            trackEvent("graph_node_click", { node_id: hoveredNode });
          }
        }}
      />
      
      {/* Node labels overlay */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {nodes.map(node => {
          const isActive = activeNode === node.id;
          const isHovered = hoveredNode === node.id;
          
          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                left: `${node.x}%`,
                top: `${node.y}%`,
                transform: "translate(-50%, -50%)",
                textAlign: "center",
                pointerEvents: "none",
                marginTop: 35 * node.size,
              }}
            >
              <div
                style={{
                  fontFamily: F.display,
                  fontSize: 12,
                  fontWeight: 600,
                  color: isActive || isHovered ? T.text : T.textMuted,
                  transition: "color 0.2s",
                }}
              >
                {node.label}
              </div>
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 9,
                  color: T.textSubtle,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {node.sub}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Floating Command Bar */
function CommandBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  return (
    <div
      style={{
        position: "fixed",
        bottom: 32,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
      }}
    >
      <div
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
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: T.cyanSubtle,
            border: `1px solid ${T.cyan}30`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Sparkles size={16} color={T.cyan} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Aliena AI</span>
          <span style={{ fontSize: 11, color: T.textMuted }}>Ask anything about your portfolio...</span>
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
          ?K
        </div>
      </div>
    </div>
  );
}

/* Navigation */
function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
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
        background: scrolled ? "rgba(10, 12, 15, 0.9)" : "transparent",
        backdropFilter: scrolled ? "blur(20px)" : "none",
        borderBottom: scrolled ? `1px solid ${T.border}` : "1px solid transparent",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <a href="/" style={{ display: "flex", alignItems: "center" }}>
          <Logo size="md" />
        </a>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              style={{
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 500,
                color: T.textMuted,
                borderRadius: 8,
                transition: "all 0.2s",
                display: { xs: "none", md: "flex" },
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = T.text;
                e.currentTarget.style.background = T.surface;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = T.textMuted;
                e.currentTarget.style.background = "transparent";
              }}
            >
              {link.label}
            </a>
          ))}
          
          <div style={{ width: 1, height: 20, background: T.border, margin: "0 8px" }} />
          
          <a
            href="/login"
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              color: T.textMuted,
            }}
          >
            Sign in
          </a>
          
          <a
            href={withUtm("mailto:support@aliena.co.uk", "nav")}
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
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = T.glowStrong;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = `0 0 20px ${T.cyanGlow}`;
            }}
          >
            Book demo <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </nav>
  );
}

/* Hero Section - Text Only with Bold Typography */
function HeroSection() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
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
        paddingTop: 80,
      }}
    >
      <GridBackground />

      {/* Dynamic cursor glow */}
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
        {/* Kicker */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 32,
            animation: "fadeUp 0.8s both",
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
            <span style={{ fontFamily: F.mono, fontSize: 11, color: T.cyan, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Now in early access
            </span>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.textMuted, fontSize: 13 }}>
            <span style={{ color: T.emerald }}>?</span>
            <span>Live governance active</span>
          </div>
        </div>

        {/* Main headline - Text only, bold typography */}
        <h1
          style={{
            fontFamily: F.display,
            fontSize: "clamp(48px, 8vw, 96px)",
            fontWeight: 700,
            lineHeight: 0.95,
            letterSpacing: "-0.04em",
            color: T.text,
            marginBottom: 32,
            maxWidth: 1100,
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

        {/* Subheadline */}
        <p
          style={{
            fontSize: "clamp(18px, 2vw, 22px)",
            lineHeight: 1.6,
            color: T.textMuted,
            maxWidth: 600,
            marginBottom: 40,
            animation: "fadeUp 0.8s 0.2s both",
          }}
        >
          Aliena unifies approvals, RAID, finance, and delivery into one AI-powered 
          governance platform. Built for PMOs who refuse to fly blind.
        </p>

        {/* CTAs */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 64,
            animation: "fadeUp 0.8s 0.3s both",
            flexWrap: "wrap",
          }}
        >
          <a
            href={withUtm("mailto:support@aliena.co.uk", "hero")}
            style={{
              padding: "16px 32px",
              background: `linear-gradient(135deg, ${T.cyan}, ${T.cyanDark})`,
              color: T.bg,
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: `0 0 30px ${T.cyanGlow}`,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = T.glowStrong;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = `0 0 30px ${T.cyanGlow}`;
            }}
          >
            Book a demo <ArrowRight size={18} />
          </a>
          
          <button
            style={{
              padding: "16px 32px",
              background: "transparent",
              color: T.text,
              fontSize: 16,
              fontWeight: 500,
              borderRadius: 12,
              border: `1px solid ${T.border}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = T.cyan;
              e.currentTarget.style.background = T.cyanSubtle;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = T.border;
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Play size={18} fill={T.cyan} color={T.cyan} />
            Watch demo
          </button>
        </div>

        {/* Trust indicators */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 32,
            animation: "fadeUp 0.8s 0.4s both",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.textSubtle, fontSize: 13 }}>
            <ShieldCheck size={16} color={T.emerald} />
            <span>UK GDPR Compliant</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.textSubtle, fontSize: 13 }}>
            <Lock size={16} color={T.emerald} />
            <span>SOC 2 Type II Ready</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.textSubtle, fontSize: 13 }}>
            <Building2 size={16} color={T.emerald} />
            <span>Built for Enterprise PMOs</span>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
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
          animation: "fadeUp 1s 0.6s both, bounce 2s infinite",
        }}
      >
        <span>Scroll to explore</span>
        <ChevronDown size={20} />
      </div>
    </section>
  );
}

/* Live Dashboard Preview */
function DashboardPreview() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <section style={{ padding: "120px 0", position: "relative" }}>
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
              Live Platform Preview
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

        {/* Browser-like container */}
        <div
          style={{
            background: T.bgElevated,
            border: `1px solid ${T.border}`,
            borderRadius: 24,
            overflow: "hidden",
            boxShadow: "0 40px 100px rgba(0,0,0,0.5)",
          }}
        >
          {/* Browser chrome */}
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
              <Lock size={12} />
              app.aliena.co.uk/portfolio/executive-view
            </div>
          </div>

          {/* Dashboard content */}
          <div style={{ padding: 24, display: "grid", gap: 24 }}>
            {/* Top metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {[
                { label: "Active Projects", value: "17", trend: "+3 this quarter", status: "positive" as const },
                { label: "Approval SLA", value: "4.2d", trend: "2 pending escalation", status: "warning" as const },
                { label: "Budget Variance", value: "£1.2M", trend: "Under forecast", status: "positive" as const },
                { label: "AI Insights", value: "27", trend: "3 critical", status: "neutral" as const },
              ].map((metric, i) => (
                <HUDCard key={metric.label} {...metric} delay={i * 0.1} />
              ))}
            </div>

            {/* Main visualization area */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, height: 500 }}>
              {/* Governance Graph */}
              <div
                style={{
                  background: T.bgCard,
                  border: `1px solid ${T.border}`,
                  borderRadius: 16,
                  padding: 20,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 20,
                    left: 20,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Network size={16} color={T.cyan} />
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: T.textSubtle, letterSpacing: "0.05em" }}>
                    GOVERNANCE TOPOLOGY
                  </span>
                </div>
                <GovernanceGraph />
              </div>

              {/* Side panel */}
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
                  ].map((alert, i) => (
                    <div
                      key={i}
                      style={{
                        padding: 12,
                        background: T.surface,
                        borderRadius: 8,
                        marginBottom: 8,
                        borderLeft: `2px solid ${alert.type === "risk" ? T.rose : alert.type === "approval" ? T.amber : T.cyan}`,
                      }}
                    >
                      <div style={{ fontSize: 13, color: T.text, marginBottom: 4 }}>{alert.msg}</div>
                      <div style={{ fontSize: 11, color: T.textSubtle }}>{alert.time}</div>
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

/* Feature Grid */
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
          {features.map((feature, i) => (
            <div
              key={feature.title}
              style={{
                background: T.bgElevated,
                border: `1px solid ${T.border}`,
                borderRadius: 20,
                padding: 32,
                transition: "all 0.3s",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = feature.color;
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.boxShadow = `0 20px 40px ${feature.color}10`;
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
                  background: `${feature.color}15`,
                  border: `1px solid ${feature.color}30`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <feature.icon size={24} color={feature.color} />
              </div>
              <h3
                style={{
                  fontFamily: F.display,
                  fontSize: 20,
                  fontWeight: 600,
                  marginBottom: 12,
                  color: T.text,
                }}
              >
                {feature.title}
              </h3>
              <p style={{ color: T.textMuted, fontSize: 15, lineHeight: 1.7 }}>
                {feature.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Comparison Section */
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, maxWidth: 1000, margin: "0 auto" }}>
          {/* Traditional */}
          <div
            style={{
              background: T.bgCard,
              border: `1px solid ${T.border}`,
              borderRadius: 24,
              padding: 32,
            }}
          >
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

          {/* Aliena */}
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
                fontWeight: 600,
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

/* CTA Section */
function CTASection() {
  return (
    <section style={{ padding: "160px 0", position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at center, ${T.cyan}08, transparent 70%)`,
        }}
      />
      
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 32px", textAlign: "center", position: "relative", zIndex: 1 }}>
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
        
        <p style={{ color: T.textMuted, fontSize: 18, marginBottom: 40, maxWidth: 600, marginInline: "auto" }}>
          Join early access and be among the first to experience AI-powered programme governance.
        </p>
        
        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          <a
            href={withUtm("mailto:support@aliena.co.uk", "final_cta")}
            style={{
              padding: "18px 36px",
              background: `linear-gradient(135deg, ${T.cyan}, ${T.cyanDark})`,
              color: T.bg,
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: `0 0 40px ${T.cyanGlow}`,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = T.glowStrong;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = `0 0 40px ${T.cyanGlow}`;
            }}
          >
            Book your demo <ArrowRight size={18} />
          </a>
        </div>
      </div>
    </section>
  );
}

/* Footer */
function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${T.border}`, padding: "80px 0 40px", background: T.bg }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 60, marginBottom: 60 }}>
          <div>
            <Logo size="md" />
            <p style={{ marginTop: 20, color: T.textMuted, fontSize: 14, lineHeight: 1.7, maxWidth: 300 }}>
              AI-powered governance platform for complex programme delivery. Built in the UK for enterprise PMOs.
            </p>
            <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
              {["LinkedIn", "Twitter", "GitHub"].map((social) => (
                <a
                  key={social}
                  href="#"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: T.textMuted,
                    fontSize: 12,
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = T.cyan;
                    e.currentTarget.style.color = T.cyan;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = T.border;
                    e.currentTarget.style.color = T.textMuted;
                  }}
                >
                  {social[0]}
                </a>
              ))}
            </div>
          </div>
          
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: T.textSubtle, letterSpacing: "0.1em", marginBottom: 20 }}>
              PRODUCT
            </div>
            {["Platform", "Intelligence", "Security", "Pricing", "Changelog"].map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase()}`}
                style={{
                  display: "block",
                  color: T.textMuted,
                  fontSize: 14,
                  padding: "8px 0",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = T.text)}
                onMouseLeave={(e) => (e.currentTarget.style.color = T.textMuted)}
              >
                {item}
              </a>
            ))}
          </div>
          
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: T.textSubtle, letterSpacing: "0.1em", marginBottom: 20 }}>
              RESOURCES
            </div>
            {["Documentation", "API Reference", "Guides", "Blog", "Status"].map((item) => (
              <a
                key={item}
                href="#"
                style={{
                  display: "block",
                  color: T.textMuted,
                  fontSize: 14,
                  padding: "8px 0",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = T.text)}
                onMouseLeave={(e) => (e.currentTarget.style.color = T.textMuted)}
              >
                {item}
              </a>
            ))}
          </div>
          
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: T.textSubtle, letterSpacing: "0.1em", marginBottom: 20 }}>
              LEGAL
            </div>
            {["Privacy", "Terms", "Security", "Cookies"].map((item) => (
              <a
                key={item}
                href="#"
                style={{
                  display: "block",
                  color: T.textMuted,
                  fontSize: 14,
                  padding: "8px 0",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = T.text)}
                onMouseLeave={(e) => (e.currentTarget.style.color = T.textMuted)}
              >
                {item}
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
          <span style={{ color: T.textSubtle, fontSize: 13 }}>
            © 2026 Aliena AI. Built in the UK.
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.textSubtle, fontSize: 13 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: T.emerald,
                boxShadow: `0 0 10px ${T.emerald}`,
              }}
            />
            All systems operational
          </div>
        </div>
      </div>
    </footer>
  );
}

/* Main Page Component */
export default function LandingPage() {
  useEffect(() => {
    trackEvent("landing_page_view");
  }, []);

  return (
    <main
      style={{
        background: T.bg,
        color: T.text,
        fontFamily: F.display,
        minHeight: "100vh",
        overflowX: "hidden",
      }}
    >
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes float {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(10px, -10px); }
          50% { transform: translate(20px, 0); }
          75% { transform: translate(10px, 10px); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        * {
          box-sizing: border-box;
        }
        html {
          scroll-behavior: smooth;
        }
        ::selection {
          background: ${T.cyan}40;
          color: ${T.text};
        }
      `}</style>

      <Navigation />
      <HeroSection />
      <DashboardPreview />
      <FeatureGrid />
      <ComparisonSection />
      <CTASection />
      <Footer />
      <CommandBar />
    </main>
  );
}