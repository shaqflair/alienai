"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Utility function to join class names conditionally.
 */
function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/**
 * Individual Sub-Navigation Item
 */
function Item({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  // Checks if the current path matches the link or is a sub-route of the link
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={cx(
        "px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 uppercase tracking-wider",
        active 
          ? "bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)] border border-white/10" 
          : "text-slate-400 hover:text-white hover:bg-white/5"
      )}
    >
      {label}
    </Link>
  );
}

/**
 * ProjectSubNav Component
 * Handles navigation between different modules of a single project.
 */
export default function ProjectSubNav({ projectId }: { projectId: string }) {
  const base = `/projects/${projectId}`;

  return (
    <nav className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-2xl p-2 md:p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Item href={base} label="Overview" />
        <Item href={`${base}/raid`} label="RAID" />
        <Item href={`${base}/change`} label="Changes" />
        <Item href={`${base}/lessons`} label="Lessons" />
        <Item href={`${base}/members`} label="Members" />
        <Item href={`${base}/approvals`} label="Approvals" />
      </div>
    </nav>
  );
}
