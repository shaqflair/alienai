"use client";

import React, { useMemo, useState } from "react";

export default function CopyCompareLinkButton({
  aId,
  bId,
  label = "Copy link",
}: {
  aId?: string | null;
  bId?: string | null;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const href = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);

    if (aId) url.searchParams.set("a", String(aId));
    if (bId) url.searchParams.set("b", String(bId));

    return url.toString();
  }, [aId, bId]);

  async function onCopy() {
    setErr(null);
    const text = href || (typeof window !== "undefined" ? window.location.href : "");
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e: any) {
      setErr("Clipboard blocked by browser. Select & copy from the address bar.");
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCopy}
        className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
        title="Copy a shareable comparison link"
      >
        {copied ? "Copied ✅" : label}
      </button>

      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </div>
  );
}