"use client";

import React, { useState } from "react";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function formatWhen(x: string | null) {
  if (!x) return "";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    // UK-friendly
    return d.toLocaleString("en-GB");
  } catch {
    return String(x);
  }
}

function statusLabel(status: string) {
  const s = safeStr(status).trim().toLowerCase();
  if (s === "draft") return "Draft";
  if (s === "submitted") return "Submitted";
  if (s === "approved") return "Approved";
  if (s === "changes_requested") return "Changes requested";
  if (s === "rejected") return "Rejected";
  return status || "—";
}

export default function ApprovalBar({
  id,
  status,
  isOwner,
  approvalDate,
  approverId,
  onAfter,
}: {
  id: string;
  status: string; // governance status: draft/submitted/approved/changes_requested/rejected
  isOwner: boolean;
  approvalDate: string | null;
  approverId: string | null;
  onAfter: () => void; // reload after action
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const s = safeStr(status).trim().toLowerCase();
  const isClosed = s === "approved" || s === "rejected";
  const canDecide = isOwner && s === "submitted"; // only allow decisions when submitted

  async function act(kind: "approve" | "reject") {
    setError(null);
    setBusy(kind);

    try {
      const endpoint =
        kind === "approve"
          ? `/api/change/${encodeURIComponent(id)}/approve`
          : `/api/change/${encodeURIComponent(id)}/reject`;

      const res = await fetch(endpoint, { method: "POST" });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error(safeStr((json as any)?.error) || "Action failed");
      }

      onAfter();
    } catch (e: any) {
      setError(safeStr(e?.message) || "Unexpected error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="crSection" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span className="crChipStrong">{statusLabel(status)}</span>

          {isClosed && approvalDate ? (
            <span className="crMuted" style={{ margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s === "approved" ? "Approved" : "Rejected"} on {formatWhen(approvalDate)}
              {approverId ? ` · ${approverId.slice(0, 8)}…` : ""}
            </span>
          ) : (
            <span className="crMuted" style={{ margin: 0 }}>
              {canDecide ? "You can approve or reject this change request." : "View only."}
            </span>
          )}
        </div>

        {isOwner ? (
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="crPrimaryBtn"
              onClick={() => act("approve")}
              disabled={!!busy || !canDecide}
              title={canDecide ? "Approve change request" : "Only available when Submitted"}
            >
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>

            <button
              type="button"
              className="crGhostBtn"
              onClick={() => act("reject")}
              disabled={!!busy || !canDecide}
              title={canDecide ? "Reject change request" : "Only available when Submitted"}
            >
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        ) : (
          <span className="crMuted" style={{ margin: 0 }}>
            View only
          </span>
        )}
      </div>

      {error ? (
        <div style={{ marginTop: 10 }}>
          <div className="crMuted" style={{ color: "rgba(255,140,140,0.95)", margin: 0 }}>
            {error}
          </div>
        </div>
      ) : null}
    </div>
  );
}
