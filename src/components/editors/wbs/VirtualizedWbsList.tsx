"use client";

import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

type WbsItem = {
  id: string;
  title: string;
  owner?: string;
  effort?: number;
};

export default function VirtualizedWbsList({
  items,
  renderRow,
}: {
  items: WbsItem[];
  renderRow: (item: WbsItem) => React.ReactNode;
}) {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      style={{
        height: "100%",
        overflow: "auto",
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];

          return (
            <div
              key={item.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderRow(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}