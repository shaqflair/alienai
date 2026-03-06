"use client";

export default function Loading() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#000810]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-[20rem] w-[20rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/10" />
        <div className="absolute left-1/2 top-1/2 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300/10 animate-[spin_18s_linear_infinite]" />
        <div className="absolute left-1/2 top-1/2 h-[16rem] w-[16rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/10 animate-[spin_12s_linear_infinite_reverse]" />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center gap-6 text-center">
        <div className="relative flex h-32 w-32 items-center justify-center">
          <div className="absolute h-32 w-32 rounded-full bg-cyan-400/12 blur-3xl" />
          <div className="absolute h-24 w-24 rounded-full border border-cyan-300/20 bg-white/[0.03] shadow-[0_0_40px_rgba(34,211,238,0.12)]" />
          <div className="absolute h-28 w-28 rounded-full border border-cyan-300/10 animate-[spin_10s_linear_infinite]" />

          <img
            src="/aliena-eye.png"
            alt="Aliena AI"
            className="relative block h-20 w-20 object-contain animate-[pulse_3s_ease-in-out_infinite]"
            draggable={false}
          />
        </div>

        <div className="select-none text-lg font-semibold tracking-[0.55em] text-white">
          Λ L I Ξ N Λ
        </div>

        <div className="max-w-sm text-sm text-sky-100/70">
          Initialising Governance Intelligence...
        </div>

        <div className="mt-1 flex items-center justify-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan-300/90 animate-[pulse_1.2s_ease-in-out_infinite]" />
          <span className="h-2 w-2 rounded-full bg-cyan-300/70 animate-[pulse_1.2s_ease-in-out_0.2s_infinite]" />
          <span className="h-2 w-2 rounded-full bg-cyan-300/50 animate-[pulse_1.2s_ease-in-out_0.4s_infinite]" />
        </div>
      </div>
    </div>
  );
}