"use client";

type Props = {
  show: boolean;
  message?: string | null;
};

export default function ArtifactEditorReadOnlyOverlay({ show, message }: Props) {
  if (!show) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center rounded-3xl bg-slate-950/35 backdrop-blur-[1px]">
      <div className="mt-6 rounded-2xl border border-white/15 bg-slate-900/95 px-4 py-3 text-sm text-white shadow-2xl">
        {message || "This editor is read-only right now."}
      </div>
    </div>
  );
}