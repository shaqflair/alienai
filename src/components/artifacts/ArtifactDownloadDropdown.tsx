"use client";

import React, { useMemo, useState } from "react";

type DownloadItem = {
  label: string;
  href: string;
  kind?: "pdf" | "docx" | "pptx" | "json" | "other";
  disabled?: boolean;
};

export default function ArtifactDownloadDropdown({
  projectHumanId,
  artifactId,
  className = "",
  basePath,
  items,
}: {
  // IMPORTANT: this should be the same id you use in URLs: /projects/[id]
  projectHumanId: string;
  artifactId: string;
  className?: string;

  /**
   * If your exports live under a consistent route:
   * e.g. /projects/[id]/artifacts/[artifactId]/export
   * pass basePath=`/projects/${projectHumanId}/artifacts/${artifactId}/export`
   */
  basePath?: string;

  /**
   * Optionally override items (for different artifact types).
   * If omitted, defaults to pdf/docx/pptx/json under basePath.
   */
  items?: DownloadItem[];
}) {
  const [open, setOpen] = useState(false);

  const defaultBase = basePath || `/projects/${projectHumanId}/artifacts/${artifactId}/export`;

  const menuItems: DownloadItem[] = useMemo(() => {
    if (items?.length) return items;

    return [
      { label: "PDF", href: `${defaultBase}/pdf`, kind: "pdf" },
      { label: "Word (.docx)", href: `${defaultBase}/docx`, kind: "docx" },
      { label: "PowerPoint (.pptx)", href: `${defaultBase}/pptx`, kind: "pptx" },
      { label: "JSON", href: `${defaultBase}/json`, kind: "json" },
    ];
  }, [items, defaultBase]);

  function icon(kind?: DownloadItem["kind"]) {
    const cls = "inline-block w-4 text-gray-600";
    if (kind === "pdf") return <span className={cls}>📄</span>;
    if (kind === "docx") return <span className={cls}>📝</span>;
    if (kind === "pptx") return <span className={cls}>📊</span>;
    if (kind === "json") return <span className={cls}>🧾</span>;
    return <span className={cls}>⬇️</span>;
  }

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-gray-50"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>Download</span>
        <span className="text-gray-600">▾</span>
      </button>

      {open && (
        <>
          {/* click-away (ensure it sits BEHIND the menu) */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-56 rounded-xl border bg-white p-1 shadow-lg"
          >
            {menuItems.map((it, idx) => {
              const disabled = !!it.disabled;

              return (
                <a
                  key={`${it.href}-${idx}`}
                  href={it.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    if (disabled) {
                      e.preventDefault();
                      return;
                    }
                    setOpen(false);
                  }}
                  className={[
                    "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                    disabled
                      ? "cursor-not-allowed text-gray-400"
                      : "hover:bg-gray-50 text-gray-900",
                  ].join(" ")}
                  role="menuitem"
                  aria-disabled={disabled}
                >
                  <span className="flex items-center gap-2">
                    {icon(it.kind)}
                    {it.label}
                  </span>
                  <span className="text-gray-400">↗</span>
                </a>
              );
            })}

            <div className="mt-1 border-t px-3 py-2 text-xs text-gray-500">
              Opens in a new tab
            </div>
          </div>
        </>
      )}
    </div>
  );
}
