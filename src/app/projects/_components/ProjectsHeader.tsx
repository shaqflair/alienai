import "server-only";

import Link from "next/link";
import { bannerClass, flashCls, type FlashTone } from "../_lib/projects-utils";

/**
 * ProjectsHeader
 * * Displays the page title and handles high-level feedback messages 
 * using the utility classes defined in projects-utils.
 */
export default function ProjectsHeader({
  banner,
  flash,
  dismissHref,
}: {
  banner: { tone: "success" | "warn" | "error"; msg: string } | null;
  flash: { tone: FlashTone; text: string } | null;
  dismissHref: string;
}) {
  return (
    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-3">
          {/* Brand Logo / Icon */}
          <div className="h-10 w-10 rounded-2xl border border-slate-800 bg-[#0b1220] grid place-items-center shadow-[0_0_30px_rgba(0,212,255,0.08)]">
            <span className="text-cyan-300 font-black">?</span>
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">Projects</h1>
            <p className="mt-1 text-sm text-slate-400">
              Your portfolio entry point — search, switch views, and jump into governance.
            </p>
          </div>
        </div>

        {/* Organization / Invitation Banners */}
        {banner ? (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-sm transition-all ${bannerClass(banner.tone)}`}>
            <span>{banner.msg}</span>
          </div>
        ) : null}

        {/* Action Feedback (Flash Messages) */}
        {flash ? (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-sm transition-all ${flashCls(flash.tone)}`}>
            <div className="flex items-start justify-between gap-4">
              <span>{flash.text}</span>
              <Link
                href={dismissHref}
                className="text-xs font-semibold text-slate-200/90 hover:text-white underline underline-offset-4 decoration-current/30 hover:decoration-current"
                title="Dismiss"
              >
                Dismiss
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {/* Global Actions */}
      <div className="flex items-center gap-2">
        <Link
          href="/artifacts"
          className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-[#0b1220] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-900/40 transition-colors shadow-sm"
          title="Go to global artifacts"
        >
          Global artifacts
        </Link>
      </div>
    </header>
  );
}
