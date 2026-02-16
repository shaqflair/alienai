"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type AttachmentItem = {
  id: string;
  filename: string;
  content_type?: string;
  size_bytes?: number;
  created_at?: string | null;
  path?: string;
  url?: string;
  signedUrl?: string;
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function fmtBytes(n?: number) {
  const v = Number(n ?? 0) || 0;
  if (v < 1024) return `${v} B`;
  const kb = v / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function fmtWhen(iso?: string | null) {
  const s = safeStr(iso).trim();
  if (!s) return "";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function shortId(x?: string, n = 6) {
  const s = safeStr(x).trim();
  return s ? s.replace(/-/g, "").slice(0, n) : "";
}

function normalizeCrPublicId(x: string) {
  const s = safeStr(x).trim();
  if (!s) return "";
  // API may return "cr-15" — standardise to "CR-15"
  if (/^cr-\d+$/i.test(s)) return `CR-${s.split("-")[1]}`;
  // allow already "CR-15"
  if (/^CR-\d+$/i.test(s)) return s.toUpperCase();
  // fallback: uppercase anything else
  return s.toUpperCase();
}

function crDisplayLabel(publicId: string, changeId: string) {
  const pub = normalizeCrPublicId(publicId);
  if (pub) return pub;
  const sid = shortId(changeId, 6).toUpperCase();
  return sid ? `CR-${sid}` : "CR-—";
}

export default function AttachmentsDrawer({
  open,
  onClose,
  projectId, // you now pass human project code like PRJ-100011
  changeId,  // can be uuid OR public id (your API supports both)
  artifactId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  changeId: string;
  artifactId?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ✅ show a stable CR label using API-provided publicId (CR-15)
  const [changePublicId, setChangePublicId] = useState<string>("");

  const canLoad = Boolean(open && safeStr(changeId).trim());

  const load = useCallback(async () => {
    const cid = safeStr(changeId).trim();
    if (!cid) return;

    setLoading(true);
    setErr("");

    try {
      const res = await fetch(`/api/change/${encodeURIComponent(cid)}/attachments`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || (json as any)?.ok === false) {
        throw new Error(safeStr((json as any)?.error) || "Failed to load attachments");
      }

      setItems(Array.isArray((json as any)?.items) ? (json as any).items : []);

      // ✅ your attachments route returns publicId
      const pub = safeStr((json as any)?.publicId || (json as any)?.public_id).trim();
      setChangePublicId(pub);
    } catch (e: any) {
      setErr(safeStr(e?.message) || "Failed to load attachments");
      setItems([]);
      setChangePublicId("");
    } finally {
      setLoading(false);
    }
  }, [changeId]);

  useEffect(() => {
    if (canLoad) load();
  }, [canLoad, load]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const cid = safeStr(changeId).trim();

      // IMPORTANT: read from currentTarget before awaits
      const input = e.currentTarget;
      const files = Array.from(input?.files ?? []);
      // reset immediately to avoid "Cannot set properties of null (setting 'value')"
      if (input) input.value = "";

      if (!cid) {
        setErr("Missing changeId.");
        return;
      }
      if (!files.length) return;

      setUploadBusy(true);
      setErr("");

      try {
        for (const file of files) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("filename", file.name);
          fd.append("content_type", file.type || "application/octet-stream");
          if (artifactId) fd.append("artifactId", artifactId);

          const res = await fetch(`/api/change/${encodeURIComponent(cid)}/attachments`, {
            method: "POST",
            body: fd,
          });
          const json = await res.json().catch(() => ({}));

          if (!res.ok || (json as any)?.ok === false) {
            throw new Error(safeStr((json as any)?.error) || "Upload failed");
          }

          // ✅ POST also returns publicId (keep it updated)
          const pub = safeStr((json as any)?.publicId || (json as any)?.public_id).trim();
          if (pub) setChangePublicId(pub);
        }

        await load();
      } catch (e2: any) {
        setErr(safeStr(e2?.message) || "Upload failed");
      } finally {
        setUploadBusy(false);
      }
    },
    [artifactId, changeId, load]
  );

  const removeAttachment = useCallback(
    async (att: AttachmentItem) => {
      const cid = safeStr(changeId).trim();
      if (!cid) return;

      setErr("");
      setDeletingId(att.id || att.path || null);

      try {
        const qs = new URLSearchParams();
        if (safeStr(att.path).trim()) qs.set("path", safeStr(att.path).trim());
        else qs.set("attachmentId", safeStr(att.id).trim());

        const res = await fetch(
          `/api/change/${encodeURIComponent(cid)}/attachments?${qs.toString()}`,
          { method: "DELETE" }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || (json as any)?.ok === false) {
          throw new Error(safeStr((json as any)?.error) || "Delete failed");
        }

        await load();
      } catch (e: any) {
        setErr(safeStr(e?.message) || "Delete failed");
      } finally {
        setDeletingId(null);
      }
    },
    [changeId, load]
  );

  const count = items.length;

  const displayCr = useMemo(() => {
    return crDisplayLabel(changePublicId, changeId);
  }, [changePublicId, changeId]);

  const body = useMemo(() => {
    if (loading) return <div className="text-sm text-gray-500">Loading…</div>;

    if (err) {
      return (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
          {err}
        </div>
      );
    }

    if (!count) return <div className="text-sm text-gray-500">No attachments yet.</div>;

    return (
      <div className="space-y-2">
        {items.map((a) => {
          const url = safeStr(a.url) || safeStr(a.signedUrl);
          const when = fmtWhen(a.created_at);
          const isDeleting = deletingId === (a.id || a.path);

          return (
            <div
              key={a.id || a.path || `${a.filename}-${a.created_at}`}
              className="flex items-start justify-between gap-3 p-3 bg-white border border-gray-200 rounded-lg"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {a.filename || "Attachment"}
                </div>
                <div className="text-xs text-gray-500">
                  {fmtBytes(a.size_bytes)}
                  {a.content_type ? ` • ${a.content_type}` : ""}
                  {when ? ` • ${when}` : ""}
                </div>
                {safeStr(a.path).trim() ? (
                  <div className="text-[11px] text-gray-400 mt-1 truncate" title={safeStr(a.path)}>
                    {safeStr(a.path)}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
                  >
                    Open
                  </a>
                ) : null}

                <button
                  type="button"
                  onClick={() => removeAttachment(a)}
                  disabled={isDeleting || uploadBusy}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50"
                  title="Remove attachment"
                >
                  {isDeleting ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [items, loading, err, count, deletingId, removeAttachment, uploadBusy]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm"
      onMouseDown={(e) => {
        // click outside drawer closes
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md h-full bg-slate-50 shadow-2xl flex flex-col animate-in slide-in-from-right">
        <div className="p-4 border-b bg-white flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-gray-900 truncate">Attachments ({count})</h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                {displayCr}
              </span>
            </div>

            <div className="text-xs text-gray-500 truncate">
              {safeStr(projectId).trim() ? `Project: ${projectId}` : ""}
              {safeStr(projectId).trim() ? " • " : ""}
              Change: {displayCr}
            </div>
          </div>

          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">{body}</div>

        <div className="p-4 border-t bg-white">
          <label className="block">
            <span className="sr-only">Choose files</span>
            <input
              type="file"
              multiple
              disabled={uploadBusy}
              onChange={handleUpload}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
            />
          </label>
          {uploadBusy ? (
            <p className="mt-2 text-xs text-indigo-600 animate-pulse">Uploading files…</p>
          ) : (
            <p className="mt-2 text-[11px] text-gray-500">
              Tip: you can remove files with the “Remove” button after upload.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
