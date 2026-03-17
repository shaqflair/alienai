"use client";

type Props = {
  readOnly: boolean;
  approvalLocked?: boolean;
  lockOwnerName?: string | null;
  expiresAt?: string | null;
  currentVersionNo?: number;
  currentDraftRev?: number;
};

export default function ArtifactCollaborationBanner({
  readOnly,
  approvalLocked = false,
  lockOwnerName,
  expiresAt,
  currentVersionNo = 0,
  currentDraftRev = 0,
}: Props) {
  if (!readOnly && !approvalLocked) {
    return (
      <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-emerald-300">Editing enabled</span>
          <span className="text-white/40">•</span>
          <span>Draft rev {currentDraftRev}</span>
          <span className="text-white/40">•</span>
          <span>Version {currentVersionNo}</span>
        </div>
      </div>
    );
  }

  if (approvalLocked) {
    return (
      <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        <div className="font-medium">Read-only while under approval</div>
        <div className="mt-1 text-amber-100/80">
          Editing is blocked because this artifact is currently in an approval-safe state.
          A version snapshot should be taken on submit and on final approval.
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
      <div className="font-medium">Read-only: locked by another user</div>
      <div className="mt-1 text-rose-100/80">
        {lockOwnerName || "Another editor"} currently owns the edit lock
        {expiresAt ? ` until roughly ${new Date(expiresAt).toLocaleTimeString()}` : ""}.
        You can take over automatically once the lock expires.
      </div>
      <div className="mt-2 text-rose-100/70">
        Draft rev {currentDraftRev} • Version {currentVersionNo}
      </div>
    </div>
  );
}