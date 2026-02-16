"use client";

import React from "react";

type Status = "Done" | "Working on it" | "Stuck";

type Row = {
  id: string;
  task: string;
  owners: { name: string; initials: string }[];
  progress: number; // 0..100
  status: Status;
  due: string; // e.g., "Sep 06"
};

const statusStyles: Record<Status, { pill: string; dot: string }> = {
  Done: {
    pill: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-600/20",
    dot: "bg-emerald-500",
  },
  "Working on it": {
    pill: "bg-amber-500/15 text-amber-800 ring-1 ring-amber-600/20",
    dot: "bg-amber-500",
  },
  Stuck: {
    pill: "bg-rose-500/15 text-rose-700 ring-1 ring-rose-600/20",
    dot: "bg-rose-500",
  },
};

function AvatarStack({ owners }: { owners: Row["owners"] }) {
  return (
    <div className="flex -space-x-2">
      {owners.slice(0, 3).map((o, idx) => (
        <div
          key={`${o.name}-${idx}`}
          className="h-8 w-8 rounded-full bg-white ring-2 ring-white shadow-sm grid place-items-center border border-slate-200"
          title={o.name}
        >
          <span className="text-xs font-semibold text-slate-700">{o.initials}</span>
        </div>
      ))}
      {owners.length > 3 && (
        <div className="h-8 w-8 rounded-full bg-slate-100 ring-2 ring-white shadow-sm grid place-items-center border border-slate-200">
          <span className="text-xs font-semibold text-slate-600">+{owners.length - 3}</span>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full max-w-[180px]">
      <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const s = statusStyles[status];
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${s.pill}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function SectionTable({
  title,
  accent,
  rows,
}: {
  title: string;
  accent: "blue" | "purple";
  rows: Row[];
}) {
  const accentBar = accent === "blue" ? "bg-blue-500" : "bg-purple-500";
  const titleColor = accent === "blue" ? "text-blue-600" : "text-purple-600";

  return (
    <div className="relative">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className={`text-sm font-semibold ${titleColor}`}>{title}</h3>
      </div>

      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* left accent line */}
        <div className={`absolute left-0 top-0 h-full w-1.5 ${accentBar}`} />

        <div className="pl-4 pr-4 py-3">
          {/* header */}
          <div className="grid grid-cols-12 gap-3 px-2 pb-2 text-xs font-semibold text-slate-500">
            <div className="col-span-5">Task</div>
            <div className="col-span-2">Owner</div>
            <div className="col-span-2">Timeline</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1 text-right">Due</div>
          </div>

          <div className="divide-y divide-slate-100">
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-12 gap-3 px-2 py-3 items-center">
                <div className="col-span-5">
                  <div className="text-sm font-medium text-slate-900">{r.task}</div>
                </div>
                <div className="col-span-2">
                  <AvatarStack owners={r.owners} />
                </div>
                <div className="col-span-2">
                  <ProgressBar value={r.progress} />
                </div>
                <div className="col-span-2">
                  <StatusPill status={r.status} />
                </div>
                <div className="col-span-1 text-right">
                  <span className="text-sm font-medium text-slate-700">{r.due}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GmailReminderOverlay() {
  return (
    <div className="absolute right-10 top-10 w-[420px] max-w-[90vw]">
      {/* subtle blur card */}
      <div className="rounded-2xl border border-slate-200 bg-white/85 backdrop-blur-md shadow-xl overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Gmail-like M */}
            <div className="h-9 w-9 rounded-xl bg-white border border-slate-200 grid place-items-center shadow-sm">
              <span className="text-sm font-black">
                <span className="text-red-500">M</span>
              </span>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">When due date arrives,</div>
              <div className="text-sm font-semibold text-slate-900">Email Owner</div>
            </div>
          </div>
          <span className="text-xs font-semibold text-slate-500">Automation</span>
        </div>

        <div className="px-5 pb-5">
          <button
            type="button"
            className="w-full rounded-xl bg-slate-900 text-white text-sm font-semibold py-2.5 hover:bg-slate-800 transition"
          >
            + Add to board
          </button>

          <div className="mt-3 text-xs text-slate-500">
            Tip: wire this to your AlienAI “Triggers” (e.g. stakeholder updates, RAID changes, approvals).
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MonthlyPlanningBoard() {
  const thisMonth: Row[] = [
    {
      id: "t1",
      task: "Finalize kickoff materials",
      owners: [{ name: "Adu", initials: "AA" }],
      progress: 78,
      status: "Done",
      due: "Sep 06",
    },
    {
      id: "t2",
      task: "Refine objectives",
      owners: [
        { name: "Alex", initials: "AP" },
        { name: "Nadine", initials: "NC" },
      ],
      progress: 55,
      status: "Working on it",
      due: "Sep 15",
    },
    {
      id: "t3",
      task: "Identify key resources",
      owners: [{ name: "Temi", initials: "TO" }],
      progress: 92,
      status: "Done",
      due: "Sep 17",
    },
    {
      id: "t4",
      task: "Test plan",
      owners: [{ name: "Sam", initials: "SR" }],
      progress: 20,
      status: "Stuck",
      due: "Sep 17",
    },
  ];

  const nextMonth: Row[] = [
    {
      id: "n1",
      task: "Update contractor agreement",
      owners: [{ name: "Alex", initials: "AP" }],
      progress: 80,
      status: "Done",
      due: "Oct 04",
    },
    {
      id: "n2",
      task: "Conduct a risk assessment",
      owners: [{ name: "Nadine", initials: "NC" }],
      progress: 65,
      status: "Done",
      due: "Oct 07",
    },
    {
      id: "n3",
      task: "Monitor budget",
      owners: [{ name: "Chris", initials: "CL" }],
      progress: 35,
      status: "Stuck",
      due: "Oct 12",
    },
    {
      id: "n4",
      task: "Develop communication plan",
      owners: [
        { name: "Temi", initials: "TO" },
        { name: "Alex", initials: "AP" },
      ],
      progress: 45,
      status: "Working on it",
      due: "Oct 14",
    },
  ];

  return (
    <div className="relative min-h-[720px] w-full bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-8 pt-8 pb-6">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Monthly planning</h1>
          </div>

          <div className="px-8 pb-10 space-y-10">
            <SectionTable title="This month" accent="blue" rows={thisMonth} />
            <SectionTable title="Next month" accent="purple" rows={nextMonth} />
          </div>
        </div>
      </div>

      {/* floating overlay */}
      <GmailReminderOverlay />
    </div>
  );
}
