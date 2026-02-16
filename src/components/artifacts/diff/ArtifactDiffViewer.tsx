"use client";

import React, { useMemo, useState } from "react";
import type { ArtifactDiffV1, SectionDiff, DiffOp } from "@/types/artifact-diff";
import DiffOpRow from "./DiffOpRow";

type Props = {
  diff: ArtifactDiffV1;
};

function opCounts(sections: SectionDiff[]) {
  let add = 0, remove = 0, replace = 0;
  for (const s of sections) {
    for (const op of s.ops) {
      if (op.op === "add") add += 1;
      else if (op.op === "remove") remove += 1;
      else if (op.op === "replace") replace += 1;
    }
  }
  return { add, remove, replace, total: add + remove + replace };
}

export default function ArtifactDiffViewer({ diff }: Props) {
  const sections = diff.sections ?? [];
  const counts = useMemo(() => opCounts(sections), [sections]);

  const defaultKey = sections[0]?.section_key ?? "__meta__";
  const [activeKey, setActiveKey] = useState<string>(defaultKey);

  const active = useMemo(
    () => sections.find((s) => s.section_key === activeKey) ?? null,
    [sections, activeKey]
  );

  return (
    <section className="border rounded-2xl bg-white overflow-hidden">
      <div className="border-b bg-gray-50 px-5 py-3 flex items-center justify-between gap-4">
        <div className="font-medium">Diff</div>
        <div className="text-xs text-gray-600 flex items-center gap-3">
          <span>Total: <span className="font-mono">{counts.total}</span></span>
          <span className="text-green-700">Add: <span className="font-mono">{counts.add}</span></span>
          <span className="text-red-700">Remove: <span className="font-mono">{counts.remove}</span></span>
          <span className="text-blue-700">Replace: <span className="font-mono">{counts.replace}</span></span>
        </div>
      </div>

      <div className="grid grid-cols-12">
        <aside className="col-span-12 md:col-span-3 border-b md:border-b-0 md:border-r">
          {sections.length === 0 ? (
            <div className="p-5 text-sm text-gray-600">No changes detected.</div>
          ) : (
            <ul className="divide-y">
              {sections.map((s) => {
                const isActive = s.section_key === activeKey;
                return (
                  <li key={s.section_key}>
                    <button
                      type="button"
                      onClick={() => setActiveKey(s.section_key)}
                      className={[
                        "w-full text-left px-4 py-3 text-sm",
                        isActive ? "bg-black text-white" : "hover:bg-gray-50"
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">
                          {s.section_key === "__meta__" ? "Meta" : s.section_key}
                        </span>
                        <span className={["font-mono text-xs px-2 py-0.5 rounded-full",
                          isActive ? "bg-white/15" : "bg-gray-100 text-gray-700"
                        ].join(" ")}>
                          {s.ops.length}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="col-span-12 md:col-span-9">
          {!active ? (
            <div className="p-5 text-sm text-gray-600">Select a section to view changes.</div>
          ) : (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  {active.section_key === "__meta__" ? "Meta changes" : `Section: ${active.section_key}`}
                </h2>
                <span className="text-xs text-gray-500">
                  Ops: <span className="font-mono">{active.ops.length}</span>
                </span>
              </div>

              <div className="space-y-2">
                {active.ops.map((op: DiffOp, idx: number) => (
                  <DiffOpRow key={`${active.section_key}:${idx}:${op.path}`} op={op} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
