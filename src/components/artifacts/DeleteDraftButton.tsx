"use client";

import { useState } from "react";
import { deleteDraftArtifact } from "@/app/projects/[id]/artifacts/actions";

type Props = {
  projectId: string;
  artifactId: string;
  disabled?: boolean;
};

export default function DeleteDraftButton({
  projectId,
  artifactId,
  disabled,
}: Props) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        Delete draft
      </button>
    );
  }

  return (
    <form action={async (fd) => { await deleteDraftArtifact(fd); }} className="inline-flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="artifactId" value={artifactId} />

      <button
        type="submit"
        disabled={disabled}
        className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
      >
        Confirm delete
      </button>

      <button
        type="button"
        className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </button>
    </form>
  );
}
