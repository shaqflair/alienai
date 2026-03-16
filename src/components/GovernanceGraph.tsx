import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { 
  Building2, 
  Users, 
  FileCheck, 
  TrendingUp, 
  AlertTriangle, 
  Wallet,
  Cpu,
  Activity
} from 'lucide-react';

interface Node {
  id: string;
  x: number;
  y: number;
  label: string;
  sublabel?: string;
  icon: React.ElementType;
  color: string;
  connections: string[];
  health?: number;
}

const nodes: Node[] = [
  { id: 'programme', x: 50, y: 15, label: 'Programme', sublabel: 'Portfolio View', icon: Building2, color: '#00B8DB', connections: ['pmo', 'finance', 'delivery'], health: 92 },
  { id: 'pmo', x: 20, y: 35, label: 'PMO Hub', sublabel: 'Governance Control', icon: Users, color: '#4DE3FF', connections: ['approvals', 'raid'], health: 88 },
  { id: 'finance', x: 50, y: 35, label: 'Finance', sublabel: 'Budget & Forecast', icon: Wallet, color: '#22C55E', connections: ['variance', 'reporting'], health: 95 },
  { id: 'delivery', x: 80, y: 35, label: 'Delivery', sublabel: 'Milestones & Resources', icon: TrendingUp, color: '#EAB308', connections: ['milestones', 'resources'], health: 78 },
  { id: 'approvals', x: 10, y: 55, label: 'Approvals', sublabel: '4 Pending', icon: FileCheck, color: '#F97316', connections: ['ai'], health: 65 },
  { id: 'raid', x: 30, y: 55, label: 'RAID', sublabel: '12 Active', icon: AlertTriangle, color: '#EF4444', connections: ['ai'], health: 72 },
  { id: 'variance', x: 45, y: 55, label: 'Variance', sublabel: '£1.2M Flagged', icon: Activity, color: '#F97316', connections: ['ai'], health: 58 },
  { id: 'milestones', x: 65, y: 55, label: 'Milestones', sublabel: '3 At Risk', icon: TrendingUp, color: '#EAB308', connections: ['ai'], health: 81 },
  { id: 'resources', x: 85, y: 55, label: 'Resources', sublabel: 'Overallocated', icon: Users, color: '#EF4444', connections: ['ai'], health: 45 },
  { id: 'ai', x: 50, y: 75, label: 'AI Governance Brain', sublabel: 'Intelligence Layer', icon: Cpu, color: '#A855F7', connections: ['reporting'], health: 99 },
  { id: 'reporting', x: 50, y: 90, label: 'Executive Cockpit', sublabel: 'Unified View', icon: Activity, color: '#00B8DB', connections: [], health: 100 },
];

export function GovernanceGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.graph-node',
        { scale: 0, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.6, stagger: 0.08, ease: 'back.out(1.7)', delay: 0.3 }
      );
      gsap.fromTo('.connection-line',
        { strokeDashoffset: 1000 },
        { strokeDashoffset: 0, duration: 1.5, stagger: 0.05, ease: 'power2.out', delay: 0.5 }
      );
      gsap.to('.ai-pulse', {
        scale: 1.2, opacity: 0, duration: 1.5, repeat: -1, ease: 'power2.out'
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const getNodePosition = (id: string) => {
    const node = nodes.find(n => n.id === id);
    if (!node) return { x: 0, y: 0 };
    return { x: (node.x / 100) * 800, y: (node.y / 100) * 500 };
  };

  const getHealthColor = (health: number) => {
    if (health >= 80) return '#22C55E';
    if (health >= 60) return '#EAB308';
    return '#EF4444';
  };

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[500px]">
      {/* Grid Background */}
      <div className="absolute inset-0 opacity-10">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,184,219,0.3)" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <svg viewBox="0 0 800 500" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00B8DB" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#00B8DB" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#00B8DB" stopOpacity="0.2" />
          </linearGradient>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#00B8DB" opacity="0.6"/>
          </marker>
        </defs>

        {/* Connection Lines */}
        {nodes.map((node) => 
          node.connections.map((connId, i) => {
            const from = getNodePosition(node.id);
            const to = getNodePosition(connId);
            const isHighlighted = hoveredNode === node.id || hoveredNode === connId;
            return (
              <line
                key={`${node.id}-${connId}-${i}`}
                className="connection-line"
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={isHighlighted ? '#00B8DB' : 'url(#lineGradient)'}
                strokeWidth={isHighlighted ? 2 : 1}
                strokeDasharray="5,5"
                opacity={isHighlighted ? 1 : 0.5}
                markerEnd="url(#arrowhead)"
              />
            );
          })
        )}

        {/* Animated Data Packets */}
        {nodes.map((node) => 
          node.connections.map((connId, i) => {
            const from = getNodePosition(node.id);
            const to = getNodePosition(connId);
            return (
              <circle key={`packet-${node.id}-${connId}`} r="3" fill="#4DE3FF" filter="url(#glow-cyan)">
                <animateMotion
                  dur={`${1.5 + Math.random()}s`}
                  repeatCount="indefinite"
                  path={`M${from.x},${from.y} L${to.x},${to.y}`}
                />
              </circle>
            );
          })
        )}

        {/* Nodes */}
        {nodes.map((node) => {
          const x = (node.x / 100) * 800;
          const y = (node.y / 100) * 500;
          const isHovered = hoveredNode === node.id;
          const isAI = node.id === 'ai';
          
          return (
            <g 
              key={node.id}
              className="graph-node cursor-pointer"
              transform={`translate(${x}, ${y})`}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => setSelectedNode(node.id === selectedNode ? null : node.id)}
            >
              {isAI && (
                <>
                  <circle className="ai-pulse" r="45" fill="none" stroke="#A855F7" strokeWidth="2" />
                  <circle className="ai-pulse" r="55" fill="none" stroke="#A855F7" strokeWidth="1" style={{ animationDelay: '0.5s' }} />
                </>
              )}
              {(isHovered || selectedNode === node.id) && (
                <circle r="38" fill="none" stroke={node.color} strokeWidth="2" opacity="0.5" filter="url(#glow-cyan)" />
              )}
              {node.health && (
                <circle 
                  r="32" fill="none" stroke={getHealthColor(node.health)} strokeWidth="3"
                  strokeDasharray={`${(node.health / 100) * 200} 200`} strokeLinecap="round" transform="rotate(-90)" opacity="0.7"
                />
              )}
              <circle r="28" fill="rgba(5,7,10,0.9)" stroke={node.color} strokeWidth="2" />
              <foreignObject x="-10" y="-10" width="20" height="20">
                <div className="flex items-center justify-center w-full h-full">
                  <node.icon size={16} color={node.color} />
                </div>
              </foreignObject>
              <text y="45" textAnchor="middle" fill="#F2F5FA" fontSize="11" fontWeight="600" fontFamily="Space Grotesk">{node.label}</text>
              {node.sublabel && <text y="58" textAnchor="middle" fill="#7B8796" fontSize="9" fontFamily="IBM Plex Mono">{node.sublabel}</text>}
              {node.health && <text y="-35" textAnchor="middle" fill={getHealthColor(node.health)} fontSize="10" fontWeight="600" fontFamily="IBM Plex Mono">{node.health}%</text>}
            </g>
          );
        })}
      </svg>

      {/* Detail Panel */}
      {selectedNode && (
        <div className="absolute top-4 right-4 w-64 bg-[#0B0F14]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4">
          {(() => {
            const node = nodes.find(n => n.id === selectedNode);
            if (!node) return null;
            return (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${node.color}20`, border: `2px solid ${node.color}` }}>
                    <node.icon size={18} color={node.color} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm text-[#F2F5FA]">{node.label}</h4>
                    <p className="text-xs text-[#7B8796] font-mono">{node.sublabel}</p>
                  </div>
                </div>
                {node.health && (
                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#7B8796]">Health Score</span>
                      <span style={{ color: getHealthColor(node.health) }}>{node.health}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${node.health}%`, backgroundColor: getHealthColor(node.health) }} />
                    </div>
                  </div>
                )}
                <div className="text-xs text-[#7B8796]">
                  <p className="mb-2">Connected to:</p>
                  <div className="flex flex-wrap gap-1">
                    {node.connections.map(connId => {
                      const conn = nodes.find(n => n.id === connId);
                      return conn ? (
                        <span key={connId} className="px-2 py-0.5 rounded-full text-[10px]" style={{ backgroundColor: `${conn.color}20`, color: conn.color }}>{conn.label}</span>
                      ) : null;
                    })}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Legend & Indicator */}
      <div className="absolute bottom-4 left-4 bg-[#0B0F14]/90 backdrop-blur-xl border border-white/10 rounded-xl p-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#22C55E]" /><span className="text-[10px] text-[#A7B0BE]">Healthy (80%+)</span></div>
          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#EAB308]" /><span className="text-[10px] text-[#A7B0BE]">Warning</span></div>
          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#EF4444]" /><span className="text-[10px] text-[#A7B0BE]">Critical</span></div>
        </div>
      </div>
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />
        <span className="text-xs font-mono text-[#22C55E]">LIVE DATA FLOW</span>
      </div>
    </div>
  );
}
