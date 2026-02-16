"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";

type ArtifactStatus = "Draft" | "In review" | "Approved" | "Blocked";

type ArtifactRow = {
  id: string;
  artifactType:
    | "Project Charter"
    | "Stakeholder Register"
    | "Work Breakdown Structure"
    | "RAID Log"
    | "RACI Matrix"
    | "Change Request Log"
    | "Decision Log"
    | "Status Report"
    | "Benefits Plan"
    | "Budget & Forecast";
  title: string;
  owner: { name: string; initials: string };
  progress: number; // 0..100
  status: ArtifactStatus;
  due: string; // e.g., "15 Jan"
  phase: "Initiating" | "Planning" | "Executing" | "Monitoring & Controlling" | "Closing";
};

const statusStyles: Record<ArtifactStatus, { pill: string; dot: string }> = {
  Draft: {
    pill: "bg-slate-500/10 text-slate-700 ring-1 ring-slate-600/20",
    dot: "bg-slate-400",
  },
  "In review": {
    pill: "bg-indigo-500/12 text-indigo-700 ring-1 ring-indigo-600/20",
    dot: "bg-indigo-500",
  },
  Approved: {
    pill: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-600/20",
    dot: "bg-emerald-500",
  },
  Blocked: {
    pill: "bg-rose-500/15 text-rose-700 ring-1 ring-rose-600/20",
    dot: "bg-rose-500",
  },
};

const phaseStyles: Record<ArtifactRow["phase"], string> = {
  Initiating: "bg-blue-500/10 text-blue-700 ring-1 ring-blue-600/20",
  Planning: "bg-purple-500/10 text-purple-700 ring-1 ring-purple-600/20",
  Executing: "bg-amber-500/10 text-amber-800 ring-1 ring-amber-600/20",
  "Monitoring & Controlling": "bg-teal-500/10 text-teal-700 ring-1 ring-teal-600/20",
  Closing: "bg-slate-600/10 text-slate-700 ring-1 ring-slate-600/20",
};

function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full max-w-[170px]">
      <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ArtifactStatus }) {
  const s = statusStyles[status];
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${s.pill}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function PhasePill({ phase }: { phase: ArtifactRow["phase"] }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${phaseStyles[phase]}`}>
      {phase}
    </span>
  );
}

function OwnerBadge({ owner }: { owner: ArtifactRow["owner"] }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-8 rounded-full bg-white border border-slate-200 shadow-sm grid place-items-center">
        <span className="text-xs font-bold text-slate-700">{owner.initials}</span>
      </div>
      <div className="text-sm font-medium text-slate-800">{owner.name}</div>
    </div>
  );
}

function AiTriggerOverlay() {
  return (
    <div className="absolute right-10 top-10 w-[460px] max-w-[92vw]">
      <div className="rounded-2xl border border-slate-200 bg-white/85 backdrop-blur-md shadow-xl overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-white border border-slate-200 grid place-items-center shadow-sm">
              <span className="text-xs font-black text-slate-900">AI</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                When <span className="underline decoration-slate-300">due date</span> arrives,
              </div>
              <div className="text-sm font-semibold text-slate-900">Generate status update + notify owner</div>
            </div>
          </div>
          <span className="text-xs font-semibold text-slate-500">Trigger</span>
        </div>

        <div className="px-5 pb-5">
          <button
            type="button"
            className="w-full rounded-xl bg-slate-900 text-white text-sm font-semibold py-2.5 hover:bg-slate-800 transition"
          >
            + Add automation to artifact
          </button>

          <div className="mt-3 text-xs text-slate-500">
            Wire later to: <span className="font-semibold">/api/ai/events</span> (eventType:{" "}
            <span className="font-semibold">artifact_due</span>)
          </div>
        </div>
      </div>
    </div>
  );
}

function ArtifactTable({
  title,
  accent,
  rows,
  onRowClick,
}: {
  title: string;
  accent: "blue" | "purple";
  rows: ArtifactRow[];
  onRowClick: (row: ArtifactRow) => void;
}) {
  const accentBar = accent === "blue" ? "bg-blue-500" : "bg-purple-500";
  const titleColor = accent === "blue" ? "text-blue-600" : "text-purple-600";

  return (
    <div className="relative">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className={`text-sm font-semibold ${titleColor}`}>{title}</h3>
        <div className="text-xs text-slate-500">Deliverable-based board</div>
      </div>

      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className={`absolute left-0 top-0 h-full w-1.5 ${accentBar}`} />

        <div className="pl-4 pr-4 py-3">
          <div className="grid grid-cols-12 gap-3 px-2 pb-2 text-xs font-semibold text-slate-500">
            <div className="col-span-4">Artifact</div>
            <div className="col-span-2">Owner</div>
            <div className="col-span-2">Progress</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1">Phase</div>
            <div className="col-span-1 text-right">Due</div>
          </div>

          <div className="divide-y divide-slate-100">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onRowClick(r)}
                className="w-full text-left grid grid-cols-12 gap-3 px-2 py-3 items-center hover:bg-slate-50 transition"
              >
                <div className="col-span-4">
                  <div className="text-sm font-semibold text-slate-900">{r.artifactType}</div>
                  <div className="text-xs text-slate-500 line-clamp-1">{r.title}</div>
                </div>
                <div className="col-span-2">
                  <OwnerBadge owner={r.owner} />
                </div>
                <div className="col-span-2">
                  <ProgressBar value={r.progress} />
                </div>
                <div className="col-span-2">
                  <StatusPill status={r.status} />
                </div>
                <div className="col-span-1">
                  <PhasePill phase={r.phase} />
                </div>
                <div className="col-span-1 text-right">
                  <span className="text-sm font-medium text-slate-700">{r.due}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="px-2 pt-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
            >
              <span className="text-lg leading-none">+</span> Add artifact
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ArtifactBoard() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const projectId = String(params?.id ?? "").trim();

  // Demo data — next step is to replace with Supabase rows
  const initiating: ArtifactRow[] = [
    {
      id: "a1",
      artifactType: "Project Charter",
      title: "Define objectives, governance, and success criteria",
      owner: { name: "Alex", initials: "AP" },
      progress: 70,
      status: "In review",
      due: "15 Jan",
      phase: "Initiating",
    },
    {
      id: "a2",
      artifactType: "Stakeholder Register",
      title: "Identify stakeholders and engagement approach",
      owner: { name: "Nadine", initials: "NC" },
      progress: 55,
      status: "Draft",
      due: "18 Jan",
      phase: "Initiating",
    },
  ];

  const planning: ArtifactRow[] = [
    {
      id: "p1",
      artifactType: "Work Breakdown Structure",
      title: "Deliverable-based WBS aligned to PMI phases",
      owner: { name: "Alex", initials: "AP" },
      progress: 30,
      status: "Draft",
      due: "22 Jan",
      phase: "Planning",
    },
    {
      id: "p2",
      artifactType: "RAID Log",
      title: "Baseline risks, issues, assumptions, dependencies",
      owner: { name: "Temi", initials: "TO" },
      progress: 20,
      status: "Blocked",
      due: "24 Jan",
      phase: "Planning",
    },
    {
      id: "p3",
      artifactType: "RACI Matrix",
      title: "Confirm accountability across delivery roles",
      owner: { name: "Sam", initials: "SR" },
      progress: 80,
      status: "Approved",
      due: "26 Jan",
      phase: "Planning",
    },
    {
      id: "p4",
      artifactType: "Change Request Log",
      title: "Track governance + delivery status for changes",
      owner: { name: "Alex", initials: "AP" },
      progress: 10,
      status: "Draft",
      due: "28 Jan",
      phase: "Planning",
    },
  ];

  function handleRowClick(r: ArtifactRow) {
    if (!projectId) return;

    // ✅ IMPORTANT: Change Request Log must go project-wide, NOT artifact-scoped
    if (r.artifactType === "Change Request Log") {
      router.push(`/projects/${projectId}/change`);
      return;
    }

    // Placeholder: wire this to your real artifact detail route later
    router.push(`/projects/${projectId}/artifacts`);
  }

  return (
    <div className="relative min-h-[760px] w-full bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-8 pt-8 pb-6 flex items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">AlienAI Artifact Board</h1>
              <p className="mt-1 text-sm text-slate-600">
                Deliverable-based view of PMI artifacts with ownership, progress, status, and due dates.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Filters
              </button>
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                + New artifact
              </button>
            </div>
          </div>

          <div className="px-8 pb-10 space-y-10">
            <ArtifactTable title="Initiating" accent="blue" rows={initiating} onRowClick={handleRowClick} />
            <ArtifactTable title="Planning" accent="purple" rows={planning} onRowClick={handleRowClick} />
          </div>
        </div>
      </div>

      <AiTriggerOverlay />
    </div>
  );
}
