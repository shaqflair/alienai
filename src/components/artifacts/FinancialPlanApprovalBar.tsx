"use client";

import React, { useState, useTransition } from "react";
import { CheckCircle2, XCircle, RotateCcw, Send, Lock, Clock, AlertTriangle } from "lucide-react";

export type ApprovalStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "changes_requested";

type Props = {
  projectId: string;
  artifactId: string;
  approvalStatus: ApprovalStatus;
  isLocked: boolean;
  isAuthorOrEditor: boolean;
  isApprover: boolean;
  submittedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  onSubmit: (projectId: string, artifactId: string) => Promise<any>;
  onApprove: (projectId: string, artifactId: string) => Promise<any>;
  onRequestChanges: (projectId: string, artifactId: string, reason?: string) => Promise<any>;
  onReject: (projectId: string, artifactId: string, reason?: string) => Promise<any>;
};

function safeDate(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { 
        day: "2-digit", 
        month: "short", 
        year: "numeric", 
        hour: "2-digit", 
        minute: "2-digit" 
    });
  } catch { return iso; }
}

export default function FinancialPlanApprovalBar({
  projectId, artifactId, approvalStatus, isLocked,
  isAuthorOrEditor, isApprover,
  submittedAt, approvedAt, rejectedAt, rejectionReason,
  onSubmit, onApprove, onRequestChanges, onReject,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [err, setErr]     = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showReasonBox, setShowReasonBox] = useState<"changes" | "reject" | null>(null);

  const status = (approvalStatus || "draft").toLowerCase() as ApprovalStatus;

  function act(fn: () => Promise<any>) {
    setErr(null);
    startTransition(async () => {
      try { await fn(); }
      catch (e: any) { setErr(String(e?.message || e || "Action failed")); }
    });
  }

  /* -- Status badge -------------------------------------------------------- */
  const badge = {
    draft:             { label: "Draft",             bg: "bg-gray-100",   text: "text-gray-600",   icon: null },
    submitted:         { label: "Awaiting approval", bg: "bg-amber-50",   text: "text-amber-700",  icon: <Clock className="h-3.5 w-3.5" /> },
    approved:          { label: "Approved",          bg: "bg-green-50",   text: "text-green-700",  icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    rejected:          { label: "Rejected",          bg: "bg-red-50",     text: "text-red-700",    icon: <XCircle className="h-3.5 w-3.5" /> },
    changes_requested: { label: "Changes requested", bg: "bg-orange-50",  text: "text-orange-700", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  }[status] ?? { label: status, bg: "bg-gray-100", text: "text-gray-600", icon: null };

  const btnBase = "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>

      {/* Status row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " + badge.bg + " " + badge.text}>
            {badge.icon}
            {badge.label}
          </span>
          {isLocked && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <Lock className="h-3 w-3" /> Locked
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Submit / Resubmit */}
          {(status === "draft" || status === "changes_requested") && isAuthorOrEditor && (
            <button type="button" disabled={pending}
              className={btnBase + " bg-indigo-600 text-white hover:bg-indigo-700"}
              onClick={() => act(() => onSubmit(projectId, artifactId))}>
              <Send className="h-3.5 w-3.5" />
              {status === "changes_requested" ? "Resubmit" : "Submit for approval"}
            </button>
          )}

          {/* Approve */}
          {status === "submitted" && isApprover && (
            <button type="button" disabled={pending}
              className={btnBase + " bg-green-600 text-white hover:bg-green-700"}
              onClick={() => act(() => onApprove(projectId, artifactId))}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve
            </button>
          )}

          {/* Request changes */}
          {status === "submitted" && isApprover && (
            <button type="button" disabled={pending}
              className={btnBase + " bg-amber-500 text-white hover:bg-amber-600"}
              onClick={() => setShowReasonBox(showReasonBox === "changes" ? null : "changes")}>
              <RotateCcw className="h-3.5 w-3.5" /> Request changes
            </button>
          )}

          {/* Reject */}
          {status === "submitted" && isApprover && (
            <button type="button" disabled={pending}
              className={btnBase + " bg-red-600 text-white hover:bg-red-700"}
              onClick={() => setShowReasonBox(showReasonBox === "reject" ? null : "reject")}>
              <XCircle className="h-3.5 w-3.5" /> Reject
            </button>
          )}
        </div>
      </div>

      {/* Reason input box */}
      {showReasonBox && (
        <div className="space-y-2 pt-1 border-t border-gray-100">
          <label className="block text-xs font-medium text-gray-600">
            {showReasonBox === "changes" ? "Reason for requesting changes" : "Rejection reason"} (optional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
            placeholder="Provide context for the author..."
          />
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending}
              className={btnBase + (showReasonBox === "changes" ? " bg-amber-500 text-white hover:bg-amber-600" : " bg-red-600 text-white hover:bg-red-700")}
              onClick={() => {
                const r = reason.trim() || undefined;
                if (showReasonBox === "changes") act(() => onRequestChanges(projectId, artifactId, r));
                else act(() => onReject(projectId, artifactId, r));
                setShowReasonBox(null); setReason("");
              }}>
              Confirm {showReasonBox === "changes" ? "request changes" : "rejection"}
            </button>
            <button type="button" className={btnBase + " border border-gray-200 text-gray-600 hover:bg-gray-50"}
              onClick={() => { setShowReasonBox(null); setReason(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {err && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
      )}

      {/* Timestamps */}
      <div className="flex flex-wrap gap-4 text-[11px] text-gray-400 pt-0.5">
        {submittedAt && <span>Submitted {safeDate(submittedAt)}</span>}
        {approvedAt  && <span className="text-green-600">Approved {safeDate(approvedAt)}</span>}
        {rejectedAt  && <span className="text-red-500">Rejected {safeDate(rejectedAt)}</span>}
        {rejectionReason && <span className="text-orange-600">Reason: {rejectionReason}</span>}
      </div>
    </div>
  );
}
