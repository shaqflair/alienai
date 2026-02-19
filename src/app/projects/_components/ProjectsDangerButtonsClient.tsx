"use client";

import React, { useState } from "react";
import { closeProject, deleteProject } from "../actions";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default function ProjectsDangerButtonsClient({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle?: string | null;
}) {
  const title = safeStr(projectTitle).trim() || "this project";

  const [showDelete, setShowDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canDelete = typed.trim().toUpperCase() === "DELETE";

  return (
    <>
      <div className="flex justify-end gap-2">
        {/* CLOSE */}
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
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
          >
            Close
          </button>
        </form>

        {/* DELETE BUTTON */}
        <button
          type="button"
          onClick={() => setShowDelete(true)}
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
        >
          Delete
        </button>
      </div>

      {/* ============================
          DELETE MODAL
      ============================ */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900">
              Delete project
            </h3>

            <p className="mt-2 text-sm text-gray-600">
              You are about to delete:
            </p>

            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-semibold text-gray-900">
              {title}
            </div>

            <p className="mt-4 text-sm text-gray-600">
              This will remove the project from active use.
              <br />
              <span className="font-semibold text-rose-600">
                This action cannot be undone.
              </span>
            </p>

            <p className="mt-4 text-sm font-medium text-gray-700">
              Type <span className="font-mono bg-gray-100 px-1">DELETE</span> to
              confirm:
            </p>

            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 outline-none"
            />

            {/* ACTIONS */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (submitting) return;
                  setShowDelete(false);
                  setTyped("");
                }}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>

              <form
                action={async (formData: FormData) => {
                  setSubmitting(true);
                  await deleteProject(formData);
                }}
              >
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="confirm" value="DELETE" />

                <button
                  type="submit"
                  disabled={!canDelete || submitting}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition
                  ${
                    canDelete
                      ? "bg-rose-600 hover:bg-rose-700"
                      : "bg-gray-300 cursor-not-allowed"
                  }`}
                >
                  {submitting ? "Deleting..." : "Delete project"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
