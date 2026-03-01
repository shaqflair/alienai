"use client";
// FILE: src/components/nav/AppNavLinks.tsx
//
// Kept for backward-compat — used in any top bars that still exist.
// The sidebar (Sidebar.tsx) is now the primary nav.
// This component is intentionally minimal — the sidebar handles routing.

import Link from "next/link";
import { usePathname } from "next/navigation";

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

const RESERVED_PROJECT_IDS = new Set([
  "artifacts","changes","change","approvals","members",
  "lessons","raid","schedule","wbs","settings",
]);

function getActiveProjectRef(pathname: string): string | null {
  const m = /^\/projects\/([^\/?#]+)(?:[\/?#]|$)/.exec(pathname || "");
  if (!m) return null;
  let id = m[1] || "";
  try { id = decodeURIComponent(id); } catch {}
  id = id.trim();
  if (!id || RESERVED_PROJECT_IDS.has(id.toLowerCase())) return null;
  return id;
}

function NavLink({
  href, label, tone,
}: {
  href: string; label: string;
  tone: "indigo" | "emerald" | "amber" | "cyan";
}) {
  const pathname = usePathname();
  const active   = pathname === href || (href !== "/" && pathname.startsWith(href));

  const toneActive =
    tone === "indigo"
      ? "data-[active=true]:bg-indigo-500/15 data-[active=true]:text-indigo-100 data-[active=true]:ring-indigo-400/30"
      : tone === "emerald"
      ? "data-[active=true]:bg-emerald-500/15 data-[active=true]:text-emerald-100 data-[active=true]:ring-emerald-400/30"
      : tone === "amber"
      ? "data-[active=true]:bg-amber-500/15 data-[active=true]:text-amber-100 data-[active=true]:ring-amber-400/30"
      : "data-[active=true]:bg-cyan-500/15 data-[active=true]:text-cyan-100 data-[active=true]:ring-cyan-400/30";

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
  const pathname   = usePathname();
  const projectRef = getActiveProjectRef(pathname);

  const artifactsHref = projectRef ? `/projects/${projectRef}/artifacts` : "/artifacts";
  const membersHref   = projectRef ? `/projects/${projectRef}/members`   : "/members";

  return (
    <nav className="flex items-center gap-2">
      <NavLink href="/"         label="Dashboard" tone="indigo"  />
      <NavLink href="/projects" label="Projects"  tone="emerald" />
      <NavLink href="/heatmap"  label="Heatmap"   tone="cyan"    />
      <NavLink href={artifactsHref} label="Artifacts" tone="amber" />
      <NavLink href={membersHref}   label="Members"   tone="cyan"  />
    </nav>
  );
}

