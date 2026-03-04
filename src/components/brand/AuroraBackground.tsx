"use client";

import React, { useEffect, useRef } from "react";

type Props = {
  /** intensity 0..1 */
  intensity?: number;
  /** set false to disable particles (keep aurora) */
  particles?: boolean;
};

function prefersReducedMotion() {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

export default function AuroraBackground({ intensity = 0.85, particles = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!particles) return;
    if (prefersReducedMotion()) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      w = Math.floor(window.innerWidth);
      h = Math.floor(window.innerHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    // particles
    const N = Math.floor(Math.min(140, Math.max(60, (w * h) / 18000)));
    const pts = Array.from({ length: N }).map(() => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 1.6,
      vx: (-0.15 + Math.random() * 0.3) * 0.8,
      vy: (0.1 + Math.random() * 0.35) * 0.7,
      a: 0.15 + Math.random() * 0.55,
      tw: 0.002 + Math.random() * 0.006,
      phase: Math.random() * Math.PI * 2,
    }));

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      // soft vignette to keep it premium
      const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 80, w * 0.5, h * 0.45, Math.max(w, h) * 0.75);
      g.addColorStop(0, "rgba(0,184,219,0.06)");
      g.addColorStop(0.5, "rgba(88,101,242,0.035)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y > h + 10) p.y = -10;

        const twinkle = 0.65 + 0.35 * Math.sin(p.phase + t * p.tw);
        const alpha = p.a * twinkle * 0.9;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [particles]);

  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
      style={{ opacity: intensity }}
    >
      {/* Aurora layers */}
      <div className="absolute inset-0">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="aurora aurora-c" />
      </div>

      {/* Particles */}
      {particles ? <canvas ref={canvasRef} className="absolute inset-0" /> : null}
    </div>
  );
}