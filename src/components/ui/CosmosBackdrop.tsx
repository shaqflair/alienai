"use client";

import { useEffect, useRef } from "react";

export default function CosmosBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let t = 0,
      raf = 0;

    type Star = { x: number; y: number; r: number; a: number; speed: number; phase: number; blue: boolean };
    type Shooter = { x: number; y: number; vx: number; vy: number; len: number; life: number };

    let stars: Star[] = [];
    let shooters: Shooter[] = [];
    let w = 0;
    let h = 0;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      stars = Array.from({ length: 320 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.5 + 0.2,
        a: Math.random() * 0.8 + 0.2,
        speed: Math.random() * 0.4 + 0.1,
        phase: Math.random() * Math.PI * 2,
        blue: Math.random() > 0.75,
      }));
    }

    resize();
    window.addEventListener("resize", resize);

    function draw() {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);

      const bg = ctx.createRadialGradient(w * 0.45, h * 0.4, 0, w * 0.5, h * 0.5, w * 0.9);
      bg.addColorStop(0, "rgba(0,12,35,1)");
      bg.addColorStop(0.5, "rgba(0,6,18,1)");
      bg.addColorStop(1, "rgba(0,2,8,1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // stars
      stars.forEach((s) => {
        const alpha = (Math.sin(t * s.speed + s.phase) * 0.35 + 0.65) * s.a;

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.blue ? `rgba(0,180,220,${alpha})` : `rgba(200,225,255,${alpha * 0.9})`;
        ctx.fill();

        if (s.r > 1.2) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 3.5, 0, Math.PI * 2);
          ctx.fillStyle = s.blue
            ? `rgba(0,180,220,${alpha * 0.07})`
            : `rgba(200,225,255,${alpha * 0.04})`;
          ctx.fill();
        }
      });

      // shooting stars
      if (Math.random() > 0.985) {
        shooters.push({
          x: Math.random() * w * 0.7,
          y: Math.random() * h * 0.35,
          vx: 7 + Math.random() * 5,
          vy: 2 + Math.random() * 3,
          len: 90 + Math.random() * 60,
          life: 1,
        });
      }

      shooters = shooters.filter((s) => s.life > 0);
      shooters.forEach((s) => {
        const g = ctx.createLinearGradient(s.x, s.y, s.x - s.len, s.y - s.len * 0.38);
        g.addColorStop(0, `rgba(0,220,255,${s.life * 0.85})`);
        g.addColorStop(1, "rgba(0,80,180,0)");

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.len, s.y - s.len * 0.38);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5 * s.life;
        ctx.stroke();

        s.x += s.vx;
        s.y += s.vy;
        s.life -= 0.022;
      });

      raf = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <canvas
        ref={ref}
        style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 1000,
            height: 1000,
            top: -300,
            left: -200,
            background: "radial-gradient(ellipse, rgba(0,50,130,0.28) 0%, transparent 65%)",
            animation: "aneb1 22s ease-in-out infinite alternate",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 800,
            height: 800,
            bottom: -200,
            right: -150,
            background: "radial-gradient(ellipse, rgba(0,70,170,0.18) 0%, transparent 65%)",
            animation: "aneb2 28s ease-in-out infinite alternate",
          }}
        />
      </div>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2,
          pointerEvents: "none",
          background:
            "repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.055) 2px, rgba(0,0,0,0.055) 4px)",
        }}
      />
      <style>{`
        @keyframes aneb1 { from{transform:translate(0,0) scale(1)} to{transform:translate(70px,50px) scale(1.12)} }
        @keyframes aneb2 { from{transform:translate(0,0)} to{transform:translate(-50px,-40px) scale(1.1)} }
      `}</style>
    </>
  );
}
