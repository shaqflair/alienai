"use client";

import React, { useState } from "react";
import type { DiffOp } from "@/types/artifact-diff";

type Props = {
  op: DiffOp;
};

function badge(op: DiffOp) {
  if (op.op === "add") return { label: "ADD", cls: "bg-green-50 border-green-200 text-green-800" };
  if (op.op === "remove") return { label: "REMOVE", cls: "bg-red-50 border-red-200 text-red-800" };
  return { label: "REPLACE", cls: "bg-blue-50 border-blue-200 text-blue-800" };
}

function pretty(x: unknown): string {
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

export default function DiffOpRow({ op }: Props) {
  const b = badge(op);
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${b.cls}`}>
              {b.label}
            </span>
            <span className="font-mono text-xs text-gray-700 truncate">{op.path}</span>
          </div>
        </div>

        <button
          type="button"
          className="text-xs underline text-gray-600 hover:text-black"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Details"}
        </button>
      </div>

      {open ? (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {"before" in op ? (
            <div>
              <div className="text-xs font-medium text-gray-600 mb-1">Before</div>
              <pre className="text-xs bg-gray-50 border rounded-lg p-2 overflow-auto">{pretty((op as any).before)}</pre>
            </div>
          ) : null}

          {"after" in op ? (
            <div>
              <div className="text-xs font-medium text-gray-600 mb-1">After</div>
              <pre className="text-xs bg-gray-50 border rounded-lg p-2 overflow-auto">{pretty((op as any).after)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
