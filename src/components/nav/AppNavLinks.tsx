"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

const RESERVED_PROJECT_IDS = new Set([
  "artifacts",
  "changes",
  "change",
  "approvals",
  "members",
  "lessons",
  "raid",
  "schedule",
  "wbs",
  "settings",
]);

function getActiveProjectRef(pathname: string): string | null {
  // Matches:
  // /projects/<id>
  // /projects/<id>/...
  // and returns "<id>"
  const m = /^\/projects\/([^\/?#]+)(?:[\/?#]|$)/.exec(pathname || "");
  if (!m) return null;

  let id = m[1] || "";
  try {
    id = decodeURIComponent(id);
  } catch {}
  id = id.trim();
  if (!id) return null;

  // guard against accidental "reserved" segments
  if (RESERVED_PROJECT_IDS.has(id.toLowerCase())) return null;

  return id;
}

function NavLink({
  href,
  label,
  tone,
}: {
  href: string;
  label: string;
  tone: "indigo" | "emerald" | "amber" | "cyan";
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href));

  const toneActive =
    tone === "indigo"
      ? "data-[active=true]:bg-indigo-500/15 data-[active=true]:text-indigo-100 data-[active=true]:ring-indigo-400/30 data-[active=true]:shadow-[0_0_0_1px_rgba(99,102,241,0.35)]"
      : tone === "emerald"
      ? "data-[active=true]:bg-emerald-500/15 data-[active=true]:text-emerald-100 data-[active=true]:ring-emerald-400/30 data-[active=true]:shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
      : tone === "amber"
      ? "data-[active=true]:bg-amber-500/15 data-[active=true]:text-amber-100 data-[active=true]:ring-amber-400/30 data-[active=true]:shadow-[0_0_0_1px_rgba(245,158,11,0.35)]"
      : "data-[active=true]:bg-cyan-500/15 data-[active=true]:text-cyan-100 data-[active=true]:ring-cyan-400/30 data-[active=true]:shadow-[0_0_0_1px_rgba(0,212,255,0.35)]";

  return (
    <Link
      href={href}
      data-active={active ? "true" : "false"}
      className={cx(
        "px-3 py-2 rounded-xl text-sm font-medium transition ring-1 ring-transparent",
        "text-slate-300 hover:text-white hover:bg-white/5",
        "data-[active=true]:ring-1",
        toneActive
      )}
    >
      {label}
    </Link>
  );
}

export default function AppNavLinks() {
  const pathname = usePathname();
  const projectRef = getActiveProjectRef(pathname);

  // ✅ If you ARE in a project, scope links to that project.
  // ✅ If you are NOT in a project, go to global routes (never /projects/artifacts).
  const artifactsHref = projectRef ? `/projects/${projectRef}/artifacts` : "/artifacts";
  const membersHref = projectRef ? `/projects/${projectRef}/members` : "/members";

  return (
    <nav className="flex items-center gap-2">
      <NavLink href="/" label="Dashboard" tone="indigo" />
      <NavLink href="/projects" label="Projects" tone="emerald" />
      <NavLink href={artifactsHref} label="Artifacts" tone="amber" />
      <NavLink href={membersHref} label="Members" tone="cyan" />
    </nav>
  );
}
