"use client";

import React, { useState } from "react";

export default function ProjectLogoUploader({
  projectId,
  disabled,
  onUploaded,
}: {
  projectId: string;
  disabled?: boolean;
  onUploaded?: (publicUrl: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);

      const res = await fetch(`/projects/${projectId}/logo/upload`, {
        method: "POST",
        body: fd,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Upload failed");

      const url = String(json?.publicUrl ?? "").trim();
      if (!url) throw new Error("No URL returned");

      onUploaded?.(url);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">
        Upload a logo (PNG/JPG/SVG/WebP, max 2MB). Stored in Supabase Storage bucket <span className="font-mono">project-logos</span>.
      </div>

      <input
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        disabled={disabled || busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.currentTarget.value = "";
        }}
      />

      {busy ? <div className="text-xs text-blue-600">Uploading…</div> : null}
      {err ? <div className="text-xs text-red-600">{err}</div> : null}
    </div>
  );
}
