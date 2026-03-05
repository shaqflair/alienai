// src/components/AuthForm.tsx
"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

type Mode = "signin" | "signup" | "magic";

function getOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

const LOGO_SRC = "data:image/png;base64,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";

function CosmosCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let t = 0, raf = 0;

    type Star = { x:number; y:number; r:number; a:number; speed:number; phase:number; blue:boolean };
    type Shooter = { x:number; y:number; vx:number; vy:number; len:number; life:number };
    let stars: Star[] = [], shooters: Shooter[] = [], w = 0, h = 0;

    function resize() {
      w = canvas.width  = window.innerWidth;
      h = canvas.height = window.innerHeight;
      stars = Array.from({ length: 320 }, () => ({
        x: Math.random()*w, y: Math.random()*h,
        r: Math.random()*1.5+0.2,
        a: Math.random()*0.8+0.2,
        speed: Math.random()*0.4+0.1,
        phase: Math.random()*Math.PI*2,
        blue: Math.random() > 0.75,
      }));
    }
    resize();
    window.addEventListener("resize", resize);

    function draw() {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createRadialGradient(w*0.45,h*0.4,0,w*0.5,h*0.5,w*0.9);
      bg.addColorStop(0,"rgba(0,12,35,1)");
      bg.addColorStop(0.5,"rgba(0,6,18,1)");
      bg.addColorStop(1,"rgba(0,2,8,1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0,0,w,h);

      stars.forEach(s => {
        const alpha = (Math.sin(t*s.speed+s.phase)*0.35+0.65)*s.a;
        ctx.beginPath();
        ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
        ctx.fillStyle = s.blue ? `rgba(0,180,220,${alpha})` : `rgba(200,225,255,${alpha*0.9})`;
        ctx.fill();
        if (s.r > 1.2) {
          ctx.beginPath();
          ctx.arc(s.x,s.y,s.r*3.5,0,Math.PI*2);
          ctx.fillStyle = s.blue ? `rgba(0,180,220,${alpha*0.07})` : `rgba(200,225,255,${alpha*0.04})`;
          ctx.fill();
        }
      });

      if (Math.random()>0.985) shooters.push({x:Math.random()*w*0.7,y:Math.random()*h*0.35,vx:7+Math.random()*5,vy:2+Math.random()*3,len:90+Math.random()*60,life:1});
      shooters = shooters.filter(s=>s.life>0);
      shooters.forEach(s => {
        const g = ctx.createLinearGradient(s.x,s.y,s.x-s.len,s.y-s.len*0.38);
        g.addColorStop(0,`rgba(0,220,255,${s.life*0.85})`);
        g.addColorStop(1,"rgba(0,80,180,0)");
        ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(s.x-s.len,s.y-s.len*0.38);
        ctx.strokeStyle=g; ctx.lineWidth=1.5*s.life; ctx.stroke();
        s.x+=s.vx; s.y+=s.vy; s.life-=0.022;
      });

      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(raf); };
  }, []);
  return <canvas ref={ref} style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none" }} />;
}

function HudClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toUTCString().replace("GMT","UTC").toUpperCase());
    tick(); const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <>{time}</>;
}

export default function AuthForm({ next }: { next?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const nextUrl = next ?? sp.get("next") ?? "/projects";
  const resetDone = sp.get("reset") === "done";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const showPassword = mode !== "magic";

  const showResend = useMemo(() => {
    const e = (err ?? "").toLowerCase();
    return mode === "signin" && !!pendingEmail && (e.includes("confirm") || e.includes("verified") || e.includes("verification") || e.includes("not confirmed"));
  }, [err, mode, pendingEmail]);

  async function resendVerification() {
    const target = pendingEmail ?? email;
    if (!target) return;
    setErr(null); setInfo(null); setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({ type: "signup", email: target, options: { emailRedirectTo: `${getOrigin()}/auth/callback` } });
      if (error) throw error;
      setInfo("Verification email resent. Check your inbox (and spam).");
    } catch (e: any) { setErr(e?.message ?? "Failed to resend"); } finally { setLoading(false); }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setInfo(null); setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${getOrigin()}/auth/callback?next=${encodeURIComponent(nextUrl)}` } });
        if (error) throw error;
        setPendingEmail(email); setInfo("Magic link sent. Check your email to continue."); return;
      }
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${getOrigin()}/auth/callback` } });
        if (error) throw error;
        if (!data.session) { setPendingEmail(email); setInfo("Check your email to verify your account, then sign in."); return; }
        router.replace(nextUrl); router.refresh(); return;
      }
      const res = await supabase.auth.signInWithPassword({ email, password });
      if (res.error) {
        const msg = String(res.error.message ?? "").toLowerCase();
        if (msg.includes("confirm") || msg.includes("verified") || msg.includes("not confirmed")) {
          setPendingEmail(email); setInfo("Your email is not verified yet. Check your inbox or resend verification.");
        }
        throw res.error;
      }
      router.replace(nextUrl); router.refresh();
    } catch (e: any) { setErr(e?.message ?? "Failed to authenticate"); } finally { setLoading(false); }
  }

  const modeLabel = mode === "signin" ? "INITIATE SESSION" : mode === "signup" ? "CREATE ACCOUNT" : "SEND MAGIC LINK";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=Rajdhani:wght@400;500;600&family=Share+Tech+Mono&display=swap');
        .auth-root *, .auth-root *::before, .auth-root *::after { box-sizing: border-box; }
        .auth-root {
          font-family: 'Rajdhani', sans-serif;
          min-height: 100vh; overflow: hidden;
          background: #000810;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 24px; position: relative; z-index: 1;
        }
        .auth-nebula {
          position: fixed; inset: 0; z-index: 0; pointer-events: none;
        }
        .auth-nebula::before {
          content: ''; position: absolute; width: 1000px; height: 1000px;
          top: -300px; left: -200px;
          background: radial-gradient(ellipse, rgba(0,50,130,0.28) 0%, transparent 65%);
          animation: aneb1 22s ease-in-out infinite alternate;
        }
        .auth-nebula::after {
          content: ''; position: absolute; width: 800px; height: 800px;
          bottom: -200px; right: -150px;
          background: radial-gradient(ellipse, rgba(0,70,170,0.18) 0%, transparent 65%);
          animation: aneb2 28s ease-in-out infinite alternate;
        }
        @keyframes aneb1 { from{transform:translate(0,0) scale(1)} to{transform:translate(70px,50px) scale(1.12)} }
        @keyframes aneb2 { from{transform:translate(0,0)} to{transform:translate(-50px,-40px) scale(1.1)} }
        .auth-scan {
          position: fixed; inset: 0; z-index: 2; pointer-events: none;
          background: repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.055) 2px, rgba(0,0,0,0.055) 4px);
        }
        .auth-hud {
          position: fixed; z-index: 5; pointer-events: none;
          font-family: 'Share Tech Mono', monospace;
          font-size: 9px; letter-spacing: 0.13em;
          color: rgba(0,184,219,0.2); line-height: 2;
        }
        .auth-hud-tl { top:18px; left:22px; }
        .auth-hud-tr { top:18px; right:22px; text-align:right; }
        .auth-hud-bl { bottom:34px; left:22px; }
        .auth-logo-wrap {
          position: relative; z-index: 20;
          margin-bottom: 8px;
          display: flex; flex-direction: column; align-items: center;
          animation: afloatIn 1s cubic-bezier(0.16,1,0.3,1) both;
        }
        .auth-logo-img {
          width: 52px; height: 35px; object-fit: contain;
          filter: drop-shadow(0 0 4px rgba(0,150,200,0.25)) drop-shadow(0 0 12px rgba(0,80,160,0.15)) blur(0.4px) opacity(0.55);
          animation: afloat 4s ease-in-out infinite, apulse 3s ease-in-out infinite;
        }
        @keyframes afloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
        @keyframes apulse {
          0%,100%{ filter: drop-shadow(0 0 3px rgba(0,150,200,0.2)) drop-shadow(0 0 8px rgba(0,80,160,0.1)) blur(0.4px) opacity(0.5); }
          50%    { filter: drop-shadow(0 0 6px rgba(0,200,240,0.35)) drop-shadow(0 0 16px rgba(0,100,200,0.18)) blur(0.4px) opacity(0.65); }
        }
        @keyframes afloatIn { from{opacity:0;transform:translateY(-20px) scale(0.9)} to{opacity:1;transform:translateY(0) scale(1)} }
        .auth-card {
          width: 100%; max-width: 420px;
          background: rgba(3,14,35,0.82);
          border: 1px solid rgba(0,184,219,0.18);
          border-radius: 3px;
          padding: 40px 38px 32px;
          backdrop-filter: blur(28px);
          -webkit-backdrop-filter: blur(28px);
          box-shadow: 0 0 50px rgba(0,60,150,0.35), 0 0 100px rgba(0,30,90,0.25), inset 0 1px 0 rgba(0,184,219,0.08);
          animation: acardIn 0.9s 0.15s cubic-bezier(0.16,1,0.3,1) both;
          position: relative; overflow: hidden;
        }
        .auth-card::before {
          content: ''; position: absolute; top:0; left:-100%; width:40%; height:100%;
          background: linear-gradient(90deg, transparent, rgba(0,184,219,0.03), transparent);
          animation: ashimmer 7s ease-in-out infinite;
        }
        @keyframes ashimmer { 0%,100%{left:-100%} 50%{left:150%} }
        @keyframes acardIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .auth-corner { position:absolute; width:14px; height:14px; border-color:rgba(0,184,219,0.7); border-style:solid; }
        .auth-c-tl{top:-1px;left:-1px;border-width:2px 0 0 2px}
        .auth-c-tr{top:-1px;right:-1px;border-width:2px 2px 0 0}
        .auth-c-bl{bottom:-1px;left:-1px;border-width:0 0 2px 2px}
        .auth-c-br{bottom:-1px;right:-1px;border-width:0 2px 2px 0}
        .auth-brand {
          text-align: center; margin-bottom: 24px;
          animation: afadeUp 0.8s 0.3s cubic-bezier(0.16,1,0.3,1) both;
        }
        .auth-brand-name {
          font-family: 'Orbitron', sans-serif;
          font-size: 22px; font-weight: 900; letter-spacing: 0.3em; color: #fff;
          text-shadow: 0 0 16px rgba(0,184,219,0.8), 0 0 32px rgba(0,184,219,0.3);
        }
        .auth-brand-sub {
          font-family: 'Share Tech Mono', monospace;
          font-size: 8.5px; letter-spacing: 0.26em; color: rgba(0,184,219,0.6);
          margin-top: 4px; text-transform: uppercase;
        }
        .auth-mode-bar {
          display: flex; gap: 0; margin-bottom: 22px; border: 1px solid rgba(0,184,219,0.15); border-radius: 2px; overflow: hidden;
          animation: afadeUp 0.8s 0.35s cubic-bezier(0.16,1,0.3,1) both;
        }
        .auth-mode-btn {
          flex: 1; padding: 7px 4px;
          font-family: 'Share Tech Mono', monospace; font-size: 8px; letter-spacing: 0.12em;
          text-transform: uppercase; color: rgba(0,184,219,0.45);
          background: transparent; border: none; cursor: pointer;
          transition: all 0.2s; text-align: center;
        }
        .auth-mode-btn:not(:last-child) { border-right: 1px solid rgba(0,184,219,0.12); }
        .auth-mode-btn:hover { color: rgba(0,184,219,0.8); background: rgba(0,184,219,0.04); }
        .auth-mode-btn.active { color: #fff; background: rgba(0,184,219,0.12); box-shadow: inset 0 0 10px rgba(0,184,219,0.08); }
        .auth-divider {
          display: flex; align-items: center; gap: 10px; margin-bottom: 20px;
          animation: afadeUp 0.8s 0.38s cubic-bezier(0.16,1,0.3,1) both;
        }
        .auth-divider::before,.auth-divider::after { content:''; flex:1; height:1px; background:linear-gradient(to right,transparent,rgba(0,184,219,0.18),transparent); }
        .auth-divider span { font-family:'Share Tech Mono',monospace; font-size:8px; letter-spacing:0.18em; color:rgba(160,200,230,0.4); white-space:nowrap; }
        .auth-field { margin-bottom: 13px; }
        .auth-field:nth-child(1){animation:afadeUp 0.8s 0.42s cubic-bezier(0.16,1,0.3,1) both}
        .auth-field:nth-child(2){animation:afadeUp 0.8s 0.47s cubic-bezier(0.16,1,0.3,1) both}
        .auth-label {
          display: block; font-family: 'Share Tech Mono', monospace;
          font-size: 9px; letter-spacing: 0.15em; color: rgba(0,184,219,0.7);
          margin-bottom: 6px; text-transform: uppercase;
        }
        .auth-input {
          width: 100%; background: rgba(0,15,45,0.7); border: 1px solid rgba(0,184,219,0.12);
          border-radius: 2px; padding: 11px 14px;
          font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 500;
          color: #fff; outline: none; letter-spacing: 0.04em;
          transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
        }
        .auth-input::placeholder { color: rgba(150,200,230,0.18); }
        .auth-input:focus { border-color: rgba(0,184,219,0.45); background: rgba(0,25,65,0.8); box-shadow: 0 0 0 3px rgba(0,184,219,0.07); }
        .auth-msg {
          padding: 9px 12px; border-radius: 2px; font-size: 12px;
          font-family: 'Rajdhani', sans-serif; letter-spacing: 0.04em;
          margin-bottom: 12px; border: 1px solid;
        }
        .auth-msg-err { background: rgba(180,20,20,0.1); border-color: rgba(220,50,50,0.3); color: #fca5a5; }
        .auth-msg-info { background: rgba(0,80,180,0.12); border-color: rgba(0,184,219,0.25); color: rgba(150,220,255,0.9); }
        .auth-msg-ok { background: rgba(0,120,80,0.12); border-color: rgba(0,200,130,0.25); color: rgba(100,220,160,0.9); }
        .auth-btn-primary {
          width: 100%; margin-top: 18px; padding: 13px;
          background: linear-gradient(135deg, rgba(0,184,219,0.1), rgba(0,90,200,0.16));
          border: 1px solid rgba(0,184,219,0.55); border-radius: 2px; color: #fff;
          font-family: 'Orbitron', sans-serif; font-size: 11px; font-weight: 600;
          letter-spacing: 0.22em; cursor: pointer; text-transform: uppercase;
          position: relative; overflow: hidden;
          transition: all 0.25s;
          animation: afadeUp 0.8s 0.52s cubic-bezier(0.16,1,0.3,1) both;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .auth-btn-primary:hover { box-shadow: 0 0 20px rgba(0,184,219,0.45), 0 0 40px rgba(0,80,200,0.2); transform: translateY(-1px); border-color: rgba(0,220,255,0.7); }
        .auth-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .auth-btn-primary::after { content:''; position:absolute; top:0;left:-120%;width:50%;height:100%; background:linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent); transition:left 0.5s; }
        .auth-btn-primary:hover::after { left:170%; }
        .auth-btn-ghost {
          width: 100%; padding: 9px 12px; margin-top: 8px;
          background: transparent; border: 1px solid rgba(0,184,219,0.1);
          border-radius: 2px; color: rgba(160,210,230,0.55);
          font-family: 'Share Tech Mono', monospace; font-size: 9px; letter-spacing: 0.14em;
          cursor: pointer; text-transform: uppercase; transition: all 0.2s;
        }
        .auth-btn-ghost:hover { border-color: rgba(0,184,219,0.3); color: rgba(0,184,219,0.8); background: rgba(0,184,219,0.04); }
        .auth-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
        .auth-links {
          margin-top: 16px; text-align: center;
          font-size: 12px; color: rgba(150,190,220,0.4);
          animation: afadeUp 0.8s 0.58s cubic-bezier(0.16,1,0.3,1) both;
          font-family: 'Rajdhani', sans-serif; letter-spacing: 0.04em;
        }
        .auth-links a { color: rgba(0,184,219,0.65); text-decoration: none; transition: all 0.2s; }
        .auth-links a:hover { color: rgba(0,220,255,0.9); text-shadow: 0 0 8px rgba(0,184,219,0.5); }
        .auth-ticker {
          position: fixed; bottom:0; left:0; right:0; z-index:20;
          background: rgba(0,4,14,0.92); border-top: 1px solid rgba(0,184,219,0.07);
          padding: 5px 20px; display: flex; align-items: center; gap: 10px; overflow: hidden;
        }
        .auth-tdot { width:5px; height:5px; border-radius:50%; background:rgba(0,184,219,0.7); box-shadow:0 0 5px rgba(0,184,219,0.5); flex-shrink:0; animation:atdblink 2s infinite; }
        @keyframes atdblink{0%,100%{opacity:1}50%{opacity:0.2}}
        .auth-ttext { font-family:'Share Tech Mono',monospace; font-size:9px; letter-spacing:0.13em; color:rgba(0,184,219,0.35); white-space:nowrap; animation:atscroll 38s linear infinite; }
        @keyframes atscroll{from{transform:translateX(100vw)}to{transform:translateX(-230%)}}
        @keyframes afadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .auth-spin { display:inline-block; width:10px; height:10px; border:1.5px solid rgba(0,184,219,0.3); border-top-color:rgba(0,184,219,0.9); border-radius:50%; animation:aspin 0.7s linear infinite; }
        @keyframes aspin{to{transform:rotate(360deg)}}
      `}</style>

      <CosmosCanvas />
      <div className="auth-nebula" />
      <div className="auth-scan" />

      {/* HUD overlays */}
      <div className="auth-hud auth-hud-tl">
        Λ L I Ξ N Λ &nbsp;OS v4.2.1<br />
        SYS.SECURE // ENCRYPTED<br />
        <HudClock />
      </div>
      <div className="auth-hud auth-hud-tr">
        NODE: EU-WEST-2<br />
        UPTIME: 99.97%<br />
        STATUS: NOMINAL
      </div>
      <div className="auth-hud auth-hud-bl">
        CONN: TLS 1.3 // AES-256<br />
        AUTH: MULTI-FACTOR READY
      </div>

      <div className="auth-root">
        {/* Distant logo */}
        <div className="auth-logo-wrap">
          <div style={{ position:"relative", display:"inline-block" }}>
            <div style={{ position:"absolute", inset:"-12px", borderRadius:"50%", background:"radial-gradient(ellipse, rgba(0,120,200,0.08) 0%, rgba(0,60,140,0.04) 50%, transparent 70%)" }} />
            <img className="auth-logo-img" src={LOGO_SRC} alt="Aliena" />
          </div>
        </div>

        {/* Card */}
        <div className="auth-card">
          <div className="auth-corner auth-c-tl" /><div className="auth-corner auth-c-tr" />
          <div className="auth-corner auth-c-bl" /><div className="auth-corner auth-c-br" />

          <div className="auth-brand">
            <div className="auth-brand-name">Λ&thinsp;L&thinsp;I&thinsp;Ξ&thinsp;N&thinsp;Λ</div>
            <div className="auth-brand-sub">Project Intelligence Platform</div>
          </div>

          {/* Mode switcher */}
          <div className="auth-mode-bar">
            {(["signin","signup","magic"] as Mode[]).map(m => (
              <button key={m} className={`auth-mode-btn${mode===m?" active":""}`}
                onClick={() => { setMode(m); setErr(null); setInfo(null); }}>
                {m==="signin"?"Sign In":m==="signup"?"Register":"Magic Link"}
              </button>
            ))}
          </div>

          <div className="auth-divider"><span>AUTHENTICATE TO PROCEED</span></div>

          {resetDone && <div className="auth-msg auth-msg-ok">Password reset complete. Please sign in.</div>}
          {info && <div className="auth-msg auth-msg-info">{info}</div>}
          {err  && <div className="auth-msg auth-msg-err">{err}</div>}

          <form onSubmit={onSubmit}>
            <div className="auth-field">
              <label className="auth-label">Access Credential</label>
              <input className="auth-input" type="email" placeholder="operator@domain.com"
                autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} />
            </div>

            {showPassword && (
              <div className="auth-field">
                <label className="auth-label">Authorization Key</label>
                <input className="auth-input" type="password" placeholder="••••••••••••"
                  autoComplete={mode==="signin"?"current-password":"new-password"}
                  required value={password} onChange={e=>setPassword(e.target.value)} />
              </div>
            )}

            <button className="auth-btn-primary" type="submit" disabled={loading}>
              {loading ? <><span className="auth-spin" /> PROCESSING</> : modeLabel}
            </button>

            {showResend && (
              <button type="button" className="auth-btn-ghost" disabled={loading} onClick={resendVerification}>
                Resend Verification Email
              </button>
            )}
          </form>

          {mode === "signin" && (
            <div className="auth-links">
              <Link href="/forgot-password">Forgot password?</Link>
            </div>
          )}
        </div>
      </div>

      {/* Ticker */}
      <div className="auth-ticker">
        <div className="auth-tdot" />
        <div className="auth-ttext">Λ L I Ξ N Λ &nbsp;INTELLIGENCE PLATFORM // SECURE CHANNEL ESTABLISHED // ALL SYSTEMS OPERATIONAL // PROJECT MONITORING ACTIVE // AI INFERENCE ENGINE ONLINE // PORTFOLIO ANALYTICS READY // AWAITING OPERATOR AUTHENTICATION //&nbsp;&nbsp;</div>
      </div>
    </>
  );
}