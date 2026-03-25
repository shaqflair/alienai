"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
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

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [isInvite, setIsInvite] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function handleHashSession() {
      const hash = window.location.hash;
      if (hash && hash.includes("access_token")) {
        const params = new URLSearchParams(hash.replace("#", ""));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token") ?? "";
        const type = params.get("type");
        if (accessToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) { setError("Invalid or expired link. Please request a new one."); return; }
          if (type === "invite") setIsInvite(true);
          window.history.replaceState(null, "", window.location.pathname);
          setSessionReady(true);
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      if (data?.session) { setSessionReady(true); }
      else { setError("No valid session. Please use the link from your email or request a new one."); }
    }
    handleHashSession();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => { router.replace("/projects"); router.refresh(); }, 1500);
    } catch (e: any) {
      setError(e?.message ?? "Failed to set password");
    } finally {
      setLoading(false);
    }
  }

  const passwordsMatch = password === confirm;
  const canSubmit = !loading && password.length >= 8 && passwordsMatch && sessionReady;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap');
        .rp-root*,.rp-root *::before,.rp-root *::after{box-sizing:border-box}
        .rp-root{font-family:'Rajdhani',sans-serif;min-height:100vh;overflow:hidden;background:#000810;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;position:relative;z-index:1}
        .rp-nebula{position:fixed;inset:0;z-index:0;pointer-events:none}
        .rp-nebula::before{content:'';position:absolute;width:1000px;height:1000px;top:-300px;left:-200px;background:radial-gradient(ellipse,rgba(0,50,130,0.28) 0%,transparent 65%);animation:aneb1 22s ease-in-out infinite alternate}
        .rp-nebula::after{content:'';position:absolute;width:800px;height:800px;bottom:-200px;right:-150px;background:radial-gradient(ellipse,rgba(0,70,170,0.18) 0%,transparent 65%);animation:aneb2 28s ease-in-out infinite alternate}
        @keyframes aneb1{from{transform:translate(0,0) scale(1)}to{transform:translate(70px,50px) scale(1.12)}}
        @keyframes aneb2{from{transform:translate(0,0)}to{transform:translate(-50px,-40px) scale(1.1)}}
        .rp-scan{position:fixed;inset:0;z-index:2;pointer-events:none;background:repeating-linear-gradient(to bottom,transparent 0px,transparent 2px,rgba(0,0,0,0.04) 2px,rgba(0,0,0,0.04) 4px)}
        .rp-hud{position:fixed;z-index:6;pointer-events:none;font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:0.12em;color:rgba(135,230,255,0.82);line-height:1.75;text-shadow:0 0 8px rgba(0,184,219,0.45),0 0 18px rgba(0,140,220,0.18);background:rgba(0,8,24,0.38);border:1px solid rgba(0,184,219,0.10);backdrop-filter:blur(6px);padding:10px 12px;border-radius:4px}
        .rp-hud-tl{top:14px;left:14px}.rp-hud-tr{top:14px;right:14px;text-align:right}
        .rp-card{width:100%;max-width:420px;background:rgba(4,16,40,0.9);border:1px solid rgba(0,184,219,0.22);border-radius:3px;padding:40px 38px 32px;backdrop-filter:blur(30px);box-shadow:0 0 60px rgba(0,60,150,0.38),0 0 120px rgba(0,30,90,0.26),inset 0 1px 0 rgba(0,184,219,0.10);position:relative;overflow:hidden;animation:acardIn 0.9s 0.15s cubic-bezier(0.16,1,0.3,1) both}
        .rp-card::before{content:'';position:absolute;top:0;left:-100%;width:40%;height:100%;background:linear-gradient(90deg,transparent,rgba(0,184,219,0.03),transparent);animation:ashimmer 7s ease-in-out infinite}
        @keyframes ashimmer{0%,100%{left:-100%}50%{left:150%}}
        @keyframes acardIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        .rp-corner{position:absolute;width:14px;height:14px;border-color:rgba(0,184,219,0.8);border-style:solid;box-shadow:0 0 10px rgba(0,184,219,0.22)}
        .rp-c-tl{top:-1px;left:-1px;border-width:2px 0 0 2px}.rp-c-tr{top:-1px;right:-1px;border-width:2px 2px 0 0}.rp-c-bl{bottom:-1px;left:-1px;border-width:0 0 2px 2px}.rp-c-br{bottom:-1px;right:-1px;border-width:0 2px 2px 0}
        .rp-brand{text-align:center;margin-bottom:24px}
        .rp-brand-name{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:900;letter-spacing:0.3em;color:#f7fdff;text-shadow:0 0 20px rgba(0,184,219,0.9),0 0 40px rgba(0,184,219,0.32)}
        .rp-brand-sub{font-family:'Share Tech Mono',monospace;font-size:9px;letter-spacing:0.24em;color:rgba(130,225,255,0.82);margin-top:6px;text-transform:uppercase;text-shadow:0 0 10px rgba(0,184,219,0.22)}
        .rp-divider{display:flex;align-items:center;gap:10px;margin-bottom:20px}
        .rp-divider::before,.rp-divider::after{content:'';flex:1;height:1px;background:linear-gradient(to right,transparent,rgba(0,184,219,0.22),transparent)}
        .rp-divider span{font-family:'Share Tech Mono',monospace;font-size:8px;letter-spacing:0.18em;color:rgba(190,225,245,0.55);white-space:nowrap}
        .rp-field{margin-bottom:13px}
        .rp-label{display:block;font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:0.14em;color:rgba(115,225,255,0.88);margin-bottom:7px;text-transform:uppercase;text-shadow:0 0 8px rgba(0,184,219,0.22)}
        .rp-input{width:100%;background:rgba(0,18,48,0.84);border:1px solid rgba(0,184,219,0.18);border-radius:2px;padding:11px 14px;font-family:'Rajdhani',sans-serif;font-size:15px;font-weight:600;color:#f5fbff;outline:none;letter-spacing:0.04em;transition:border-color 0.2s,box-shadow 0.2s;box-sizing:border-box}
        .rp-input::placeholder{color:rgba(175,220,240,0.4)}
        .rp-input:focus{border-color:rgba(0,184,219,0.5);background:rgba(0,25,65,0.88);box-shadow:0 0 0 3px rgba(0,184,219,0.08)}
        .rp-btn{width:100%;margin-top:18px;padding:13px;background:linear-gradient(135deg,rgba(0,184,219,0.13),rgba(0,90,200,0.18));border:1px solid rgba(0,184,219,0.6);border-radius:2px;color:#fff;font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.22em;cursor:pointer;text-transform:uppercase;transition:all 0.25s;display:flex;align-items:center;justify-content:center;gap:8px;text-shadow:0 0 10px rgba(0,184,219,0.15)}
        .rp-btn:hover:not(:disabled){box-shadow:0 0 22px rgba(0,184,219,0.45),0 0 42px rgba(0,80,200,0.22);transform:translateY(-1px);border-color:rgba(0,220,255,0.74)}
        .rp-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none}
        .rp-msg-err{padding:10px 12px;border-radius:2px;font-size:13px;font-family:'Rajdhani',sans-serif;font-weight:600;letter-spacing:0.03em;margin-bottom:12px;border:1px solid;background:rgba(180,20,20,0.12);border-color:rgba(220,50,50,0.34);color:#fecaca}
        .rp-msg-ok{padding:10px 12px;border-radius:2px;font-size:13px;font-family:'Rajdhani',sans-serif;font-weight:600;letter-spacing:0.03em;margin-bottom:12px;border:1px solid;background:rgba(0,120,80,0.12);border-color:rgba(0,200,130,0.25);color:rgba(130,235,180,0.96)}
        .rp-msg-info{padding:10px 12px;border-radius:2px;font-size:13px;font-family:'Rajdhani',sans-serif;font-weight:600;letter-spacing:0.03em;margin-bottom:12px;border:1px solid;background:rgba(0,80,180,0.12);border-color:rgba(0,184,219,0.28);color:rgba(185,235,255,0.96)}
        .rp-match{font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:0.1em;margin-top:5px}
        .rp-back{margin-top:16px;text-align:center;font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.04em}
        .rp-back a{color:rgba(120,230,255,0.85);text-decoration:none;transition:all 0.2s}
        .rp-back a:hover{color:rgba(220,248,255,0.96);text-shadow:0 0 8px rgba(0,184,219,0.55)}
        .rp-spin{display:inline-block;width:10px;height:10px;border:1.5px solid rgba(0,184,219,0.3);border-top-color:rgba(0,184,219,0.95);border-radius:50%;animation:aspin 0.7s linear infinite}
        @keyframes aspin{to{transform:rotate(360deg)}}
        .rp-ticker{position:fixed;bottom:0;left:0;right:0;z-index:20;background:rgba(0,5,16,0.94);border-top:1px solid rgba(0,184,219,0.12);padding:7px 20px;display:flex;align-items:center;gap:10px;overflow:hidden;backdrop-filter:blur(8px)}
        .rp-tdot{width:6px;height:6px;border-radius:50%;background:rgba(0,184,219,0.9);box-shadow:0 0 8px rgba(0,184,219,0.7);flex-shrink:0;animation:atdblink 2s infinite}
        @keyframes atdblink{0%,100%{opacity:1}50%{opacity:0.25}}
        .rp-ttext{font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:0.13em;color:rgba(145,230,255,0.72);white-space:nowrap;animation:atscroll 38s linear infinite;text-shadow:0 0 10px rgba(0,184,219,0.16)}
        @keyframes atscroll{from{transform:translateX(100vw)}to{transform:translateX(-230%)}}
        @keyframes afadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <CosmosCanvas />
      <div className="rp-nebula" />
      <div className="rp-scan" />

      <div className="rp-hud rp-hud-tl">
        &Lambda; L I &Xi; N &Lambda; &nbsp;OS v4.2.1<br />
        SYS.SECURE // ENCRYPTED<br />
        <HudClock />
      </div>
      <div className="rp-hud rp-hud-tr">
        NODE: EU-WEST-2<br />UPTIME: 99.97%<br />STATUS: NOMINAL
      </div>

      <div className="rp-root">
        <div className="rp-card">
          <div className="rp-corner rp-c-tl" />
          <div className="rp-corner rp-c-tr" />
          <div className="rp-corner rp-c-bl" />
          <div className="rp-corner rp-c-br" />

          <div className="rp-brand">
            <div className="rp-brand-name">&Lambda;&thinsp;L&thinsp;I&thinsp;&Xi;&thinsp;N&thinsp;&Lambda;</div>
            <div className="rp-brand-sub">Project Intelligence Platform</div>
          </div>

          <div className="rp-divider">
            <span>{isInvite ? "WELCOME — SET YOUR PASSWORD" : "SET NEW PASSWORD"}</span>
          </div>

          {success ? (
            <div className="rp-msg-ok">✓ Password set. Taking you in…</div>
          ) : !sessionReady && !error ? (
            <div className="rp-msg-info">
              <span className="rp-spin" style={{ marginRight: 8 }} />
              Verifying your link…
            </div>
          ) : error && !sessionReady ? (
            <div>
              <div className="rp-msg-err">{error}</div>
              <a href="/forgot-password" style={{ display:"block", textAlign:"center", padding:"10px", borderRadius:2, fontSize:12, fontWeight:600, fontFamily:"'Share Tech Mono',monospace", letterSpacing:"0.12em", textTransform:"uppercase", background:"rgba(0,184,219,0.08)", border:"1px solid rgba(0,184,219,0.2)", color:"rgba(120,230,255,0.85)", textDecoration:"none", marginBottom:8 }}>
                Request new reset link →
              </a>
              <div className="rp-back"><a href="/login">← Back to login</a></div>
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <div className="rp-field">
                <label className="rp-label">New Password</label>
                <input
                  className="rp-input" type="password" required
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="rp-field">
                <label className="rp-label">Confirm Password</label>
                <input
                  className="rp-input" type="password" required
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                {confirm.length > 0 && (
                  <div className="rp-match" style={{ color: passwordsMatch ? "rgba(130,235,180,0.96)" : "#fecaca" }}>
                    {passwordsMatch ? "✓ PASSWORDS MATCH" : "✗ PASSWORDS DO NOT MATCH"}
                  </div>
                )}
              </div>

              {error && <div className="rp-msg-err">{error}</div>}

              <button className="rp-btn" type="submit" disabled={!canSubmit}>
                {loading ? <><span className="rp-spin" /> PROCESSING</> : isInvite ? "Set Password & Enter" : "Update Password"}
              </button>

              <div className="rp-back" style={{ marginTop: 12 }}>
                <a href="/login">← Back to login</a>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="rp-ticker">
        <div className="rp-tdot" />
        <div className="rp-ttext">
          &Lambda; L I &Xi; N &Lambda; &nbsp;INTELLIGENCE PLATFORM // SECURE CHANNEL ESTABLISHED // ALL SYSTEMS OPERATIONAL // ACCESS BY INVITATION ONLY // PROJECT MONITORING ACTIVE //&nbsp;&nbsp;
        </div>
      </div>
    </>
  );
}