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
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-emerald-700">Editing enabled</span>
          <span className="text-slate-300">•</span>
          <span className="text-slate-600">
            Draft rev <span className="font-semibold text-slate-900">{currentDraftRev}</span>
          </span>
          <span className="text-slate-300">•</span>
          <span className="text-slate-600">
            Version <span className="font-semibold text-slate-900">{currentVersionNo}</span>
          </span>
        </div>
      </div>
    );
  }

  if (approvalLocked) {
    return (
      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
        <div className="font-semibold text-amber-800">Read-only while under approval</div>
        <div className="mt-1 text-amber-700">
          Editing is blocked because this artifact is currently in an approval-safe state.
          A version snapshot should be taken on submit and on final approval.
        </div>
        <div className="mt-2 text-amber-700">
          Draft rev <span className="font-semibold text-amber-900">{currentDraftRev}</span>
          <span className="mx-2 text-amber-300">•</span>
          Version <span className="font-semibold text-amber-900">{currentVersionNo}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm">
      <div className="font-semibold text-rose-800">Read-only: locked by another user</div>
      <div className="mt-1 text-rose-700">
        {lockOwnerName || "Another editor"} currently owns the edit lock
        {expiresAt ? ` until roughly ${new Date(expiresAt).toLocaleTimeString()}` : ""}.
        You can take over automatically once the lock expires.
      </div>
      <div className="mt-2 text-rose-700">
        Draft rev <span className="font-semibold text-rose-900">{currentDraftRev}</span>
        <span className="mx-2 text-rose-300">•</span>
        Version <span className="font-semibold text-rose-900">{currentVersionNo}</span>
      </div>
    </div>
  );
}