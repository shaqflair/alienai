"use client";

import React from "react";

const ALIENA_LOGO =
  "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png";

export default function Loading() {
  return (
    <div className="min-h-screen w-full bg-[#0a0d14] text-slate-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-5">
        <div className="relative">
          {/* glow */}
          <div className="absolute -inset-6 rounded-full blur-2xl opacity-60 bg-cyan-400" />
          <img
            src={ALIENA_LOGO}
            alt="Aliena"
            className="relative h-20 w-20 rounded-2xl object-contain"
          />
        </div>

        <div className="text-center">
          <div className="tracking-[0.6em] text-slate-200 font-semibold">
            Λ L I Ξ N Λ
          </div>
          <div className="mt-2 text-sm text-slate-400">
            Loading governance intelligence…
          </div>
        </div>

        <div className="mt-2 h-1.5 w-52 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full w-1/2 bg-cyan-400/80 animate-pulse" />
        </div>
      </div>
    </div>
  );
}