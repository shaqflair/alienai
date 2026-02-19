// src/app/projects/_components/ProjectsHeader.tsx
import "server-only";

import Link from "next/link";
import type { FlashTone } from "../_lib/projects-utils";

type Banner = { tone: "success" | "warn" | "error"; msg: string } | null;

function bannerCls(tone: Banner extends infer T ? any : never) {
  // tone is one of: success | warn | error
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "error") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function flashCls(tone: FlashTone) {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "error") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-slate-200 bg-white text-slate-700";
}

export default function ProjectsHeader({
  banner,
  flash,
  dismissHref,
}: {
  banner: Banner;
  flash: { tone: FlashTone; text: string } | null;
  dismissHref: string;
}) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 h-10 w-10 rounded-full bg-[#00B8DB]/10 border border-[#00B8DB]/30 flex items-center justify-center shadow-[0_10px_30px_rgba(0,184,219,0.15)]">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            className="text-[#00B8DB]"
            aria-hidden="true"
          >
            <path
              d="M4 7h16M4 12h16M4 17h10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div className="space-y-1">
          <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500">
            Your portfolio entry point — search, filter, and jump into governance.
          </p>

          {banner ? (
            <div className={["mt-3 rounded-lg border px-4 py-2 text-sm", bannerCls(banner.tone)].join(" ")}>
              {banner.msg}
            </div>
          ) : null}

          {flash ? (
            <div className={["mt-3 rounded-lg border px-4 py-2 text-sm", flashCls(flash.tone)].join(" ")}>
              {flash.text}{" "}
              <Link
                href={dismissHref}
                className="ml-2 underline underline-offset-2 opacity-80 hover:opacity-100"
              >
                Dismiss
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0">
        <Link
          href="/artifacts"
          className="inline-flex items-center rounded-lg bg-[#00B8DB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00a5c4] transition shadow-lg shadow-[#00B8DB]/25"
        >
          Global artifacts
        </Link>
      </div>
    </header>
  );
}
