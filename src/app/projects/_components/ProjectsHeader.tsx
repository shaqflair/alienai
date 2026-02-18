// src/app/projects/_components/ProjectsHeader.tsx
import "server-only";

import Link from "next/link";
import { bannerClass, flashCls, type FlashTone } from "../_lib/projects-utils";

type Banner = { tone: "success" | "warn" | "error"; msg: string } | null;

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
        {/* ✅ Replace “?” with a proper icon badge */}
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
            Your portfolio entry point — search, switch views, and jump into governance.
          </p>

          {/* Banner (invite outcomes) */}
          {banner ? (
            <div className={`mt-3 rounded-lg border px-4 py-2 text-sm ${bannerClass(banner.tone)}`}>
              {banner.msg}
            </div>
          ) : null}

          {/* Flash (actions feedback) */}
          {flash ? (
            <div className={`mt-3 rounded-lg border px-4 py-2 text-sm ${flashCls(flash.tone)}`}>
              {flash.text}{" "}
              <Link href={dismissHref} className="ml-2 underline underline-offset-2 opacity-80 hover:opacity-100">
                Dismiss
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {/* Right side action */}
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
