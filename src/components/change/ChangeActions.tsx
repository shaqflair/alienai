"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function approvalState(impact: any): string {
  const a = impact?.__approval;
  const s = safeStr(a?.state).toLowerCase();
  return s || "none";
}

type Panel = "" | "attach" | "comment" | "timeline";

export default function ChangeActions({
  projectId,
  changeId,
  status,
  impact,
  isApprover: isApproverProp,
  onDone,
}: {
  projectId: string;
  changeId: string;
  status: string;
  impact: any;
  isApprover?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const lane = String(status || "").trim().toLowerCase();
  const appr = approvalState(impact);

  const [isApprover, setIsApprover] = useState<boolean>(Boolean(isApproverProp));
  const [metaLoaded, setMetaLoaded] = useState<boolean>(Boolean(isApproverProp));
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [err, setErr] = useState<string>("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (metaLoaded) return;
    let alive = true;
    fetch(`/api/change?projectId=${encodeURIComponent(projectId)}&meta=1`)
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive) return;
        setIsApprover(Boolean((j as any)?.isApprover));
        setMetaLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setMetaLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [metaLoaded, projectId]);

  const canSubmit = useMemo(() => lane === "analysis", [lane]);
  const canApproveReject = useMemo(() => lane === "review" && isApprover, [lane, isApprover]);

  function setPanelParam(next: Panel) {
    const qp = new URLSearchParams(sp?.toString() || "");
    if (!next) qp.delete("panel");
    else qp.set("panel", next);
    const url = qp.toString() ? `${pathname}?${qp.toString()}` : pathname;
    router.replace(url);
  }

  async function doAction(action: "submit_for_approval" | "approve" | "reject") {
    setErr("");

    const payload: any = { projectId, changeId, action };
    if (action === "reject") payload.reason = rejectReason;

    const res = await fetch("/api/change", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !(json as any)?.ok) {
      setErr(safeStr((json as any)?.error) || "Action failed");
      return;
    }

    onDone?.();
    window.location.reload(); // simplest + reliable
  }

  function download() {
    setErr("");
    const pid = safeStr(projectId).trim();
    const cid = safeStr(changeId).trim();
    if (!pid || !cid) return setErr("Missing projectId/changeId.");

    // If your download route differs, change it here only.
    const url = `/api/change/download?projectId=${encodeURIComponent(pid)}&changeId=${encodeURIComponent(cid)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="crHeaderActions" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {err ? <div className="crErr">{err}</div> : null}

      {/* Utility buttons */}
      <button className="crBtn crBtnGhost" type="button" onClick={() => setPanelParam("timeline")} disabled={!changeId}>
        Timeline
      </button>

      <button className="crBtn crBtnGhost" type="button" onClick={() => setPanelParam("attach")} disabled={!changeId}>
        Attachments
      </button>

      <button className="crBtn crBtnGhost" type="button" onClick={download} disabled={!changeId}>
        Download
      </button>

      {/* Analysis -> Review */}
      {canSubmit ? (
        <button
          className="crPrimaryBtn"
          disabled={pending}
          onClick={() => startTransition(() => doAction("submit_for_approval"))}
          title="Submit from Analysis to Review for approval"
        >
          {pending ? "Submitting…" : "Submit for approval"}
        </button>
      ) : null}

      {/* Review -> Approve/Reject (approver only) */}
      {lane === "review" && !isApprover ? (
        <div className="crTinyMeta" title="Only approvers can approve/reject">
          Pending approval
        </div>
      ) : null}

      {canApproveReject ? (
        <>
          <button
            className="crPrimaryBtn"
            disabled={pending}
            onClick={() => startTransition(() => doAction("approve"))}
            title="Approve and move to In Progress"
          >
            {pending ? "Approving…" : "Approve"}
          </button>

          <button
            className="crBtn"
            disabled={pending}
            onClick={() => setShowReject((v) => !v)}
            title="Reject to Analysis"
          >
            Reject
          </button>

          {showReject ? (
            <div className="crRejectBox" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="crInput"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Rejection reason (required)"
              />
              <button
                className="crBtn"
                disabled={pending || !rejectReason.trim()}
                onClick={() => startTransition(() => doAction("reject"))}
              >
                {pending ? "Rejecting…" : "Confirm reject"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {/* little state indicator */}
      {lane === "review" ? <div className="crTinyMeta">Approval: {appr === "none" ? "pending" : appr}</div> : null}
    </div>
  );
}
