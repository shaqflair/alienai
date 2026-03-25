"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/utils/supabase/client";

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
      w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight;
      stars = Array.from({ length: 320 }, () => ({ x: Math.random()*w, y: Math.random()*h, r: Math.random()*1.5+0.2, a: Math.random()*0.8+0.2, speed: Math.random()*0.4+0.1, phase: Math.random()*Math.PI*2, blue: Math.random()>0.75 }));
    }
    resize(); window.addEventListener("resize", resize);
    function draw() {
      t += 0.016; ctx.clearRect(0,0,w,h);
      const bg = ctx.createRadialGradient(w*0.45,h*0.4,0,w*0.5,h*0.5,w*0.9);
      bg.addColorStop(0,"rgba(0,12,35,1)"); bg.addColorStop(0.5,"rgba(0,6,18,1)"); bg.addColorStop(1,"rgba(0,2,8,1)");
      ctx.fillStyle=bg; ctx.fillRect(0,0,w,h);
      stars.forEach(s => {
        const alpha=(Math.sin(t*s.speed+s.phase)*0.35+0.65)*s.a;
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
        ctx.fillStyle=s.blue?`rgba(0,180,220,${alpha})`:`rgba(200,225,255,${alpha*0.9})`; ctx.fill();
        if(s.r>1.2){ctx.beginPath();ctx.arc(s.x,s.y,s.r*3.5,0,Math.PI*2);ctx.fillStyle=s.blue?`rgba(0,180,220,${alpha*0.07})`:`rgba(200,225,255,${alpha*0.04})`;ctx.fill();}
      });
      if(Math.random()>0.985) shooters.push({x:Math.random()*w*0.7,y:Math.random()*h*0.35,vx:7+Math.random()*5,vy:2+Math.random()*3,len:90+Math.random()*60,life:1});
      shooters=shooters.filter(s=>s.life>0);
      shooters.forEach(s=>{
        const g=ctx.createLinearGradient(s.x,s.y,s.x-s.len,s.y-s.len*0.38);
        g.addColorStop(0,`rgba(0,220,255,${s.life*0.85})`); g.addColorStop(1,"rgba(0,80,180,0)");
        ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.x-s.len,s.y-s.len*0.38);
        ctx.strokeStyle=g;ctx.lineWidth=1.5*s.life;ctx.stroke();
        s.x+=s.vx;s.y+=s.vy;s.life-=0.022;
      });
      raf=requestAnimationFrame(draw);
    }
    draw();
    return () => { window.removeEventListener("resize",resize); cancelAnimationFrame(raf); };
  }, []);
  return <canvas ref={ref} style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none" }} />;
}

function HudClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toUTCString().replace("GMT","UTC").toUpperCase());
    tick(); const id = setInterval(tick,1000); return () => clearInterval(id);
  }, []);
  return <>{time}</>;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL || window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${baseUrl}/auth/reset`,
      });
      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to send reset email. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap');
        .fp-root*,.fp-root *::before,.fp-root *::after{box-sizing:border-box}
        .fp-root{font-family:'Rajdhani',sans-serif;min-height:100vh;overflow:hidden;background:#000810;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;position:relative;z-index:1}
        .fp-nebula{position:fixed;inset:0;z-index:0;pointer-events:none}
        .fp-nebula::before{content:'';position:absolute;width:1000px;height:1000px;top:-300px;left:-200px;background:radial-gradient(ellipse,rgba(0,50,130,0.28) 0%,transparent 65%);animation:aneb1 22s ease-in-out infinite alternate}
        .fp-nebula::after{content:'';position:absolute;width:800px;height:800px;bottom:-200px;right:-150px;background:radial-gradient(ellipse,rgba(0,70,170,0.18) 0%,transparent 65%);animation:aneb2 28s ease-in-out infinite alternate}
        @keyframes aneb1{from{transform:translate(0,0) scale(1)}to{transform:translate(70px,50px) scale(1.12)}}
        @keyframes aneb2{from{transform:translate(0,0)}to{transform:translate(-50px,-40px) scale(1.1)}}
        .fp-scan{position:fixed;inset:0;z-index:2;pointer-events:none;background:repeating-linear-gradient(to bottom,transparent 0px,transparent 2px,rgba(0,0,0,0.04) 2px,rgba(0,0,0,0.04) 4px)}
        .fp-hud{position:fixed;z-index:6;pointer-events:none;font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:0.12em;color:rgba(135,230,255,0.82);line-height:1.75;text-shadow:0 0 8px rgba(0,184,219,0.45),0 0 18px rgba(0,140,220,0.18);background:rgba(0,8,24,0.38);border:1px solid rgba(0,184,219,0.10);backdrop-filter:blur(6px);padding:10px 12px;border-radius:4px}
        .fp-hud-tl{top:14px;left:14px}.fp-hud-tr{top:14px;right:14px;text-align:right}
        .fp-card{width:100%;max-width:420px;background:rgba(4,16,40,0.9);border:1px solid rgba(0,184,219,0.22);border-radius:3px;padding:40px 38px 32px;backdrop-filter:blur(30px);box-shadow:0 0 60px rgba(0,60,150,0.38),0 0 120px rgba(0,30,90,0.26),inset 0 1px 0 rgba(0,184,219,0.10);position:relative;overflow:hidden;animation:acardIn 0.9s 0.15s cubic-bezier(0.16,1,0.3,1) both}
        .fp-card::before{content:'';position:absolute;top:0;left:-100%;width:40%;height:100%;background:linear-gradient(90deg,transparent,rgba(0,184,219,0.03),transparent);animation:ashimmer 7s ease-in-out infinite}
        @keyframes ashimmer{0%,100%{left:-100%}50%{left:150%}}
        @keyframes acardIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        .fp-corner{position:absolute;width:14px;height:14px;border-color:rgba(0,184,219,0.8);border-style:solid;box-shadow:0 0 10px rgba(0,184,219,0.22)}
        .fp-c-tl{top:-1px;left:-1px;border-width:2px 0 0 2px}.fp-c-tr{top:-1px;right:-1px;border-width:2px 2px 0 0}.fp-c-bl{bottom:-1px;left:-1px;border-width:0 0 2px 2px}.fp-c-br{bottom:-1px;right:-1px;border-width:0 2px 2px 0}
        .fp-brand{text-align:center;margin-bottom:24px}
        .fp-brand-name{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:900;letter-spacing:0.3em;color:#f7fdff;text-shadow:0 0 20px rgba(0,184,219,0.9),0 0 40px rgba(0,184,219,0.32)}
        .fp-brand-sub{font-family:'Share Tech Mono',monospace;font-size:9px;letter-spacing:0.24em;color:rgba(130,225,255,0.82);margin-top:6px;text-transform:uppercase;text-shadow:0 0 10px rgba(0,184,219,0.22)}
        .fp-divider{display:flex;align-items:center;gap:10px;margin-bottom:20px}
        .fp-divider::before,.fp-divider::after{content:'';flex:1;height:1px;background:linear-gradient(to right,transparent,rgba(0,184,219,0.22),transparent)}
        .fp-divider span{font-family:'Share Tech Mono',monospace;font-size:8px;letter-spacing:0.18em;color:rgba(190,225,245,0.55);white-space:nowrap}
        .fp-label{display:block;font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:0.14em;color:rgba(115,225,255,0.88);margin-bottom:7px;text-transform:uppercase;text-shadow:0 0 8px rgba(0,184,219,0.22)}
        .fp-input{width:100%;background:rgba(0,18,48,0.84);border:1px solid rgba(0,184,219,0.18);border-radius:2px;padding:11px 14px;font-family:'Rajdhani',sans-serif;font-size:15px;font-weight:600;color:#f5fbff;outline:none;letter-spacing:0.04em;transition:border-color 0.2s,box-shadow 0.2s;box-sizing:border-box}
        .fp-input::placeholder{color:rgba(175,220,240,0.4)}
        .fp-input:focus{border-color:rgba(0,184,219,0.5);background:rgba(0,25,65,0.88);box-shadow:0 0 0 3px rgba(0,184,219,0.08)}
        .fp-btn{width:100%;margin-top:18px;padding:13px;background:linear-gradient(135deg,rgba(0,184,219,0.13),rgba(0,90,200,0.18));border:1px solid rgba(0,184,219,0.6);border-radius:2px;color:#fff;font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.22em;cursor:pointer;text-transform:uppercase;transition:all 0.25s;display:flex;align-items:center;justify-content:center;gap:8px;text-shadow:0 0 10px rgba(0,184,219,0.15)}
        .fp-btn:hover:not(:disabled){box-shadow:0 0 22px rgba(0,184,219,0.45),0 0 42px rgba(0,80,200,0.22);transform:translateY(-1px);border-color:rgba(0,220,255,0.74)}
        .fp-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none}
        .fp-msg-err{padding:10px 12px;border-radius:2px;font-size:13px;font-family:'Rajdhani',sans-serif;font-weight:600;letter-spacing:0.03em;margin-bottom:12px;border:1px solid;background:rgba(180,20,20,0.12);border-color:rgba(220,50,50,0.34);color:#fecaca}
        .fp-msg-ok{padding:10px 12px;border-radius:2px;font-size:13px;font-family:'Rajdhani',sans-serif;font-weight:600;letter-spacing:0.03em;border:1px solid;background:rgba(0,120,80,0.12);border-color:rgba(0,200,130,0.25);color:rgba(130,235,180,0.96);line-height:1.7}
        .fp-back{margin-top:16px;text-align:center;font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.04em}
        .fp-back a{color:rgba(120,230,255,0.85);text-decoration:none;transition:all 0.2s}
        .fp-back a:hover{color:rgba(220,248,255,0.96);text-shadow:0 0 8px rgba(0,184,219,0.55)}
        .fp-spin{display:inline-block;width:10px;height:10px;border:1.5px solid rgba(0,184,219,0.3);border-top-color:rgba(0,184,219,0.95);border-radius:50%;animation:aspin 0.7s linear infinite}
        @keyframes aspin{to{transform:rotate(360deg)}}
        .fp-ticker{position:fixed;bottom:0;left:0;right:0;z-index:20;background:rgba(0,5,16,0.94);border-top:1px solid rgba(0,184,219,0.12);padding:7px 20px;display:flex;align-items:center;gap:10px;overflow:hidden;backdrop-filter:blur(8px)}
        .fp-tdot{width:6px;height:6px;border-radius:50%;background:rgba(0,184,219,0.9);box-shadow:0 0 8px rgba(0,184,219,0.7);flex-shrink:0;animation:atdblink 2s infinite}
        @keyframes atdblink{0%,100%{opacity:1}50%{opacity:0.25}}
        .fp-ttext{font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:0.13em;color:rgba(145,230,255,0.72);white-space:nowrap;animation:atscroll 38s linear infinite;text-shadow:0 0 10px rgba(0,184,219,0.16)}
        @keyframes atscroll{from{transform:translateX(100vw)}to{transform:translateX(-230%)}}
        @keyframes afadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <CosmosCanvas />
      <div className="fp-nebula" />
      <div className="fp-scan" />

      <div className="fp-hud fp-hud-tl">
        &Lambda; L I &Xi; N &Lambda; &nbsp;OS v4.2.1<br />
        SYS.SECURE // ENCRYPTED<br />
        <HudClock />
      </div>
      <div className="fp-hud fp-hud-tr">
        NODE: EU-WEST-2<br />UPTIME: 99.97%<br />STATUS: NOMINAL
      </div>

      <div className="fp-root">
        <div className="fp-card">
          <div className="fp-corner fp-c-tl" />
          <div className="fp-corner fp-c-tr" />
          <div className="fp-corner fp-c-bl" />
          <div className="fp-corner fp-c-br" />

          <div className="fp-brand">
            <div className="fp-brand-name">&Lambda;&thinsp;L&thinsp;I&thinsp;&Xi;&thinsp;N&thinsp;&Lambda;</div>
            <div className="fp-brand-sub">Project Intelligence Platform</div>
          </div>

          <div className="fp-divider"><span>RESET PASSWORD</span></div>

          {sent ? (
            <div>
              <div className="fp-msg-ok">
                ✓ Reset link sent to <strong>{email}</strong>.<br />
                Check your inbox and spam folder. The link expires in 1 hour.
              </div>
              <button
                className="fp-btn"
                style={{ marginTop: 12 }}
                onClick={() => { setSent(false); setEmail(""); }}
              >
                Try different email
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <div style={{ marginBottom: 13 }}>
                <label className="fp-label">Email Address</label>
                <input
                  className="fp-input"
                  type="email" required
                  placeholder="operator@domain.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {error && <div className="fp-msg-err">{error}</div>}

              <button className="fp-btn" type="submit" disabled={loading || !email.includes("@")}>
                {loading ? <><span className="fp-spin" /> SENDING</> : "Send Reset Link"}
              </button>
            </form>
          )}

          <div className="fp-back">
            <a href="/login">← Back to login</a>
          </div>
        </div>
      </div>

      <div className="fp-ticker">
        <div className="fp-tdot" />
        <div className="fp-ttext">
          &Lambda; L I &Xi; N &Lambda; &nbsp;INTELLIGENCE PLATFORM // SECURE CHANNEL ESTABLISHED // ALL SYSTEMS OPERATIONAL // ACCESS BY INVITATION ONLY // PROJECT MONITORING ACTIVE //&nbsp;&nbsp;
        </div>
      </div>
    </>
  );
}