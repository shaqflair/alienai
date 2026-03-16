import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { GovernanceGraph } from './GovernanceGraph';
import { ArrowRight, Sparkles } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

export function GovernanceIntelligenceSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Headline Animation on Scroll
      gsap.fromTo('.gi-headline',
        { y: 50, opacity: 0 },
        { 
          y: 0, 
          opacity: 1, 
          scrollTrigger: { 
            trigger: sectionRef.current, 
            start: 'top 80%', 
            end: 'top 50%', 
            scrub: 0.4 
          } 
        }
      );
      
      // Graph Scaling Animation on Scroll
      gsap.fromTo('.gi-graph',
        { scale: 0.9, opacity: 0 },
        { 
          scale: 1, 
          opacity: 1, 
          scrollTrigger: { 
            trigger: sectionRef.current, 
            start: 'top 70%', 
            end: 'top 40%', 
            scrub: 0.4 
          } 
        }
      );
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative w-full min-h-screen py-20 bg-[#020408] overflow-hidden">
      {/* Starfield Background */}
      <div className="absolute inset-0">
        {[...Array(50)].map((_, i) => (
          <div key={i} className="absolute w-0.5 h-0.5 bg-white rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              opacity: Math.random() * 0.5 + 0.2,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`,
            }}
          />
        ))}
      </div>
      
      {/* Radial Glow and Gradients */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#00B8DB]/5 via-transparent to-[#00B8DB]/5" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[#00B8DB]/5 blur-[150px]" />

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        {/* Header Content */}
        <div className="gi-headline mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Sparkles size={16} className="text-[#A855F7]" />
            <span className="text-xs font-mono text-[#A855F7] tracking-wider uppercase">Governance Intelligence</span>
          </div>
          <h2 className="font-display text-3xl lg:text-5xl font-bold mb-4 text-white">
            The <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00B8DB] to-[#A855F7]">Ontology</span> of Delivery
          </h2>
          <p className="text-[#A7B0BE] max-w-2xl mx-auto">
            See how Aliena connects programmes, PMO, finance, and delivery into a unified intelligence layer.
          </p>
        </div>

        {/* Graph Container with Glassmorphism */}
        <div className="gi-graph relative bg-[#0B0F14]/60 backdrop-blur-xl border border-white/10 rounded-3xl p-6 h-[650px] shadow-2xl">
          {/* Cybernetic Decorative Corners */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-[#00B8DB]/30 rounded-tl-3xl" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-[#00B8DB]/30 rounded-tr-3xl" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-[#00B8DB]/30 rounded-bl-3xl" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-[#00B8DB]/30 rounded-br-3xl" />
          
          {/* Container Metadata HUD */}
          <div className="absolute top-6 left-6 right-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />
              <span className="text-xs font-mono text-[#7B8796] tracking-tighter">LIVE GOVERNANCE ONTOLOGY</span>
            </div>
            <div className="hidden md:flex items-center gap-4 text-[10px] font-mono text-[#7B8796]">
              <span className="bg-white/5 px-2 py-1 rounded">11 NODES ACTIVE</span>
              <span className="bg-white/5 px-2 py-1 rounded">13 REAL-TIME LINKS</span>
              <span className="bg-[#22C55E]/10 text-[#22C55E] px-2 py-1 rounded">84% SYSTEM HEALTH</span>
            </div>
          </div>

          <div className="w-full h-full pt-8">
            <GovernanceGraph />
          </div>
        </div>
      </div>
    </section>
  );
}
