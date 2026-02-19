"use client";

import React, { useMemo, useState, useTransition } from "react";
import { closeProject, reopenProject, deleteProject, abnormalCloseProject } from "../actions";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export type DeleteGuard = {
  canDelete: boolean;
  totalArtifacts: number;
  submittedCount: number;
  contentCount: number;
  reasons: string[];
};

export default function ProjectsDangerButtonsClient({
  projectId,
  projectTitle,
  guard,
  isClosed,
}: {
  projectId: string;
  projectTitle?: string | null;
  guard?: DeleteGuard | null;
  isClosed?: boolean;
}) {
  const title = safeStr(projectTitle).trim() || "this project";

  const [isPending, startTransition] = useTransition();

  const [showDelete, setShowDelete] = useState(false);
  const [typedDelete, setTypedDelete] = useState("");

  const [showAbnormal, setShowAbnormal] = useState(false);
  const [typedAbnormal, setTypedAbnormal] = useState("");

  const effectiveGuard: DeleteGuard = useMemo(
    () =>
      guard ?? {
        canDelete: true,
        totalArtifacts: 0,
        submittedCount: 0,
        contentCount: 0,
        reasons: [],
      },
    [guard]
  );

  const deleteBlocked = !effectiveGuard.canDelete;

  const canDeleteByType = typedDelete.trim().toUpperCase() === "DELETE";
  const canAbnormalByType = typedAbnormal.trim().toUpperCase() === "ABNORMAL";

  return (
    <>
      <div className="flex justify-end gap-2">
        {/* If closed: show reopen */}
        {isClosed ? (
          <form
            action={reopenProject}
            onSubmit={(e) => {
              if (!confirm(`Reopen "${title}"?\n\nEditing will be enabled again.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="project_id" value={projectId} />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? "Reopening..." : "Reopen"}
            </button>
          </form>
        ) : (
          /* If active: show normal close */
          <form
            action={closeProject}
            onSubmit={(e) => {
              if (!confirm(`Close "${title}"?\n\nYou can reopen it later.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="project_id" value={projectId} />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? "Closing..." : "Close"}
            </button>
          </form>
        )}

        {/* DELETE (only if allowed) */}
        {!deleteBlocked && (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            disabled={isPending}
            className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Delete project"
          >
            Delete
          </button>
        )}

        {/* ABNORMAL CLOSE (only when delete blocked) */}
        {deleteBlocked && !isClosed && (
          <button
            type="button"
            onClick={() => setShowAbnormal(true)}
            disabled={isPending}
            className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Required for protected artifacts"
          >
            Abnormal close
          </button>
        )}
      </div>

      {/* DELETE MODAL */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900">Delete project</h3>

            <p className="mt-2 text-sm text-gray-600">You are about to delete:</p>

            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-semibold text-gray-900">
              {title}
            </div>

            <p className="mt-4 text-sm text-gray-600">
              <span className="font-semibold text-rose-600">This action cannot be undone.</span>
            </p>

            <p className="mt-4 text-sm font-medium text-gray-700">
              Type <span className="font-mono bg-gray-100 px-1">DELETE</span> to confirm:
            </p>

            <input
              autoFocus
              value={typedDelete}
              onChange={(e) => setTypedDelete(e.target.value)}
              placeholder="DELETE"
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 outline-none"
            />

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isPending) return;
                  setShowDelete(false);
                  setTypedDelete("");
                }}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>

              {/* ✅ No action wrapper/closure */}
              <form
                action={deleteProject}
                onSubmit={(e) => {
                  if (!canDeleteByType) e.preventDefault();
                }}
              >
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="confirm" value="DELETE" />

                <button
                  type="submit"
                  disabled={!canDeleteByType || isPending}
                  className={[
                    "rounded-lg px-4 py-2 text-sm font-semibold text-white transition",
                    canDeleteByType ? "bg-rose-600 hover:bg-rose-700" : "bg-gray-300 cursor-not-allowed",
                  ].join(" ")}
                  onClick={() => {
                    if (!canDeleteByType) return;
                    startTransition(() => {});
                  }}
                >
                  {isPending ? "Deleting..." : "Delete project"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ABNORMAL CLOSE MODAL */}
      {showAbnormal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900">Abnormal close</h3>

            <p className="mt-2 text-sm text-gray-600">
              Use this when the project contains protected artifacts and must be closed for audit reasons.
            </p>

            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-semibold text-gray-900">
              {title}
            </div>

            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <div className="font-semibold">Delete is blocked</div>
              <ul className="mt-2 list-disc pl-5 space-y-1">
                {(effectiveGuard.reasons.length ? effectiveGuard.reasons : ["Protected artifacts exist."]).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-sm font-medium text-gray-700">
              Type <span className="font-mono bg-gray-100 px-1">ABNORMAL</span> to confirm:
            </p>

            <input
              autoFocus
              value={typedAbnormal}
              onChange={(e) => setTypedAbnormal(e.target.value)}
              placeholder="ABNORMAL"
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 outline-none"
            />

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isPending) return;
                  setShowAbnormal(false);
                  setTypedAbnormal("");
                }}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>

              {/* ✅ No action wrapper/closure */}
              <form
                action={abnormalCloseProject}
                onSubmit={(e) => {
                  if (!canAbnormalByType) e.preventDefault();
                }}
              >
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="confirm" value="ABNORMAL" />

                <button
                  type="submit"
                  disabled={!canAbnormalByType || isPending}
                  className={[
                    "rounded-lg px-4 py-2 text-sm font-semibold text-white transition",
                    canAbnormalByType ? "bg-rose-600 hover:bg-rose-700" : "bg-gray-300 cursor-not-allowed",
                  ].join(" ")}
                  onClick={() => {
                    if (!canAbnormalByType) return;
                    startTransition(() => {});
                  }}
                >
                  {isPending ? "Closing..." : "Abnormal close"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
