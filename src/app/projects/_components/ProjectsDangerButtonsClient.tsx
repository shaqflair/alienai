"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  closeProject,
  reopenProject,
  deleteProject,
  abnormalCloseProject,
} from "../actions";

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

type ModalMode = "delete" | "abnormal";

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

  /* ─────────────────────────────
     Dropdown state
  ───────────────────────────── */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!menuOpen) return;
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [menuOpen]);

  /* ─────────────────────────────
     Modal state
  ───────────────────────────── */
  const [showModal, setShowModal] = useState(false);
  const [mode, setMode] = useState<ModalMode>("delete");

  const [typedDelete, setTypedDelete] = useState("");
  const [typedAbnormal, setTypedAbnormal] = useState("");

  const canDeleteByType = typedDelete.trim().toUpperCase() === "DELETE";
  const canAbnormalByType = typedAbnormal.trim().toUpperCase() === "ABNORMAL";

  function openDeleteFlow() {
    setMode("delete");
    setShowModal(true);
    setMenuOpen(false);
  }

  function openAbnormalFlow() {
    setMode("abnormal");
    setShowModal(true);
    setMenuOpen(false);
  }

  function closeModal() {
    setShowModal(false);
    setTypedDelete("");
    setTypedAbnormal("");
  }

  /* ─────────────────────────────
     UI
  ───────────────────────────── */
  return (
    <>
      <div className="flex items-center gap-2">
        {/* PRIMARY BUTTON: Close / Reopen */}
        {isClosed ? (
          <form
            action={reopenProject}
            onSubmit={(e) => {
              if (!confirm(`Reopen "${title}"?\n\nEditing will be enabled again.`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="project_id" value={projectId} />
            <button
              type="submit"
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Reopen
            </button>
          </form>
        ) : (
          <form
            action={closeProject}
            onSubmit={(e) => {
              if (!confirm(`Close "${title}"?\n\nYou can reopen it later.`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="project_id" value={projectId} />
            <button
              type="submit"
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              Close
            </button>
          </form>
        )}

        {/* DROPDOWN */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            ⋯
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden z-40">
              {/* DELETE */}
              <button
                type="button"
                onClick={openDeleteFlow}
                className="w-full text-left px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                Delete…
                {deleteBlocked && (
                  <span className="ml-2 text-[11px] text-rose-500">(protected)</span>
                )}
              </button>

              {/* ABNORMAL */}
              <button
                type="button"
                onClick={openAbnormalFlow}
                className="w-full text-left px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                Abnormal close…
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900">
              {mode === "abnormal"
                ? "Abnormal close"
                : deleteBlocked
                ? "Delete blocked"
                : "Delete project"}
            </h3>

            <p className="mt-2 text-sm text-gray-600">Project:</p>
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-semibold text-gray-900">
              {title}
            </div>

            {/* BODY */}
            {mode === "abnormal" ? (
              <>
                <p className="mt-4 text-sm text-gray-600">
                  Close with audit trail (no deletion).
                </p>

                <p className="mt-4 text-sm font-medium text-gray-700">
                  Type <span className="font-mono bg-gray-100 px-1">ABNORMAL</span> to confirm:
                </p>

                <input
                  autoFocus
                  value={typedAbnormal}
                  onChange={(e) => setTypedAbnormal(e.target.value)}
                  placeholder="ABNORMAL"
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </>
            ) : deleteBlocked ? (
              <>
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  <div className="font-semibold">Enterprise protection</div>
                  <ul className="mt-2 list-disc pl-5 space-y-1">
                    {(effectiveGuard.reasons.length
                      ? effectiveGuard.reasons
                      : ["Protected artifacts exist."]
                    ).map((r, i) => (
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
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </>
            ) : (
              <>
                <p className="mt-4 text-sm text-gray-600">
                  <span className="font-semibold text-rose-600">Cannot be undone.</span>
                </p>

                <p className="mt-4 text-sm font-medium text-gray-700">
                  Type <span className="font-mono bg-gray-100 px-1">DELETE</span> to confirm:
                </p>

                <input
                  autoFocus
                  value={typedDelete}
                  onChange={(e) => setTypedDelete(e.target.value)}
                  placeholder="DELETE"
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </>
            )}

            {/* FOOTER */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700"
              >
                Cancel
              </button>

              {(mode === "abnormal" || deleteBlocked) ? (
                <form action={abnormalCloseProject}>
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="hidden" name="confirm" value="ABNORMAL" />
                  <button
                    type="submit"
                    disabled={!canAbnormalByType}
                    className={[
                      "rounded-lg px-4 py-2 text-sm font-semibold text-white",
                      canAbnormalByType
                        ? "bg-rose-600 hover:bg-rose-700"
                        : "bg-gray-300 cursor-not-allowed",
                    ].join(" ")}
                  >
                    Abnormal close
                  </button>
                </form>
              ) : (
                <form action={deleteProject}>
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="hidden" name="confirm" value="DELETE" />
                  <button
                    type="submit"
                    disabled={!canDeleteByType}
                    className={[
                      "rounded-lg px-4 py-2 text-sm font-semibold text-white",
                      canDeleteByType
                        ? "bg-rose-600 hover:bg-rose-700"
                        : "bg-gray-300 cursor-not-allowed",
                    ].join(" ")}
                  >
                    Delete project
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
