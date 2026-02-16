"use client";
import React, { useMemo, useState } from "react";

type Action = "approve" | "reject" | "defer";

export default function ApprovalBubbles({
  enabled,
  onAction,
}: {
  enabled: boolean;
  onAction: (action: Action, comment?: string) => void | Promise<void>;
}) {
  const [showCommentFor, setShowCommentFor] = useState<Action | null>(null);
  const [comment, setComment] = useState("");

  const placeholder = useMemo(() => {
    if (showCommentFor === "approve") return "Optional comment (e.g., Approved with minor note)…";
    if (showCommentFor === "reject") return "Required comment (why rejected)…";
    if (showCommentFor === "defer") return "Required comment (what are we waiting for?)…";
    return "";
  }, [showCommentFor]);

  if (!enabled) return null;

  async function fire(action: Action) {
    // 1-click path for approve
    if (action === "approve") {
      setShowCommentFor(null);
      setComment("");
      await onAction("approve");
      return;
    }
    // require comment for reject/defer
    setShowCommentFor(action);
  }

  async function submit() {
    const action = showCommentFor;
    if (!action) return;
    const c = comment.trim();
    if (!c) return; // enforce required
    setShowCommentFor(null);
    setComment("");
    await onAction(action, c);
  }

  return (
    <div className="aiApproveDock" aria-label="Approval actions">
      <button className="aiBubbleBtn" onClick={() => fire("approve")} title="Approve">
        ✓
        <span className="aiBubbleTip">Approve</span>
      </button>
      <button className="aiBubbleBtn" onClick={() => fire("reject")} title="Reject">
        ✗
        <span className="aiBubbleTip">Reject</span>
      </button>
      <button className="aiBubbleBtn" onClick={() => fire("defer")} title="Defer">
        ?
        <span className="aiBubbleTip">Defer</span>
      </button>

      {showCommentFor && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 44,
            width: 280,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(12,12,18,0.92)",
            padding: 10,
            boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ color: "rgba(255,255,255,0.84)", fontSize: 12, marginBottom: 8 }}>
            {showCommentFor === "reject" ? "Reject reason" : "Defer note"} <span style={{ color: "rgba(255,255,255,0.55)" }}>(required)</span>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={placeholder}
            rows={3}
            style={{
              width: "100%",
              resize: "none",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.88)",
              padding: 10,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button
              className="aiBubbleBtn"
              style={{ width: "auto", padding: "0 12px", height: 32 }}
              onClick={() => setShowCommentFor(null)}
            >
              Cancel
            </button>
            <button
              className="aiBubbleBtn"
              style={{ width: "auto", padding: "0 12px", height: 32, borderColor: "rgba(var(--ai-cyan),0.20)" }}
              onClick={submit}
            >
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
