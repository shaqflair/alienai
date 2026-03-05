"use client";

export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div className="flex flex-col items-center gap-6">

        <div className="relative">
          <div className="absolute inset-0 blur-2xl bg-cyan-500 opacity-50 rounded-full"></div>

          <img
            src="/aliena-eye.png"
            className="relative w-24 h-24 animate-pulse"
            alt="Aliena AI"
          />
        </div>

        <div className="tracking-[0.6em] text-white text-lg font-semibold">
          Λ L I Ξ N Λ
        </div>

        <div className="text-gray-400 text-sm">
          Initialising Governance Intelligence...
        </div>

      </div>
    </div>
  );
}