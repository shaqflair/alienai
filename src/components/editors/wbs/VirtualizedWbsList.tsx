"use client";

import React from "react";

// NOTE: The @tanstack/react-virtual approach requires a fixed-height scroll
// container which collapses to 0px in this layout. Since WBS lists are
// typically <500 rows, a plain map is simpler and more reliable.

type WbsItem = {
  id: string;
  [key: string]: any; // WBSEditor passes full WbsRow objects
};

export default function VirtualizedWbsList({
  items,
  renderRow,
}: {
  items: WbsItem[];
  renderRow: (item: WbsItem) => React.ReactNode;
}) {
  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {renderRow(item)}
        </React.Fragment>
      ))}
    </div>
  );
}