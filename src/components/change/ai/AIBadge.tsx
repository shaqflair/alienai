"use client";
import React from "react";

export default function AIBadge({
  label = "AI Analyzed",
  title = "AI has analyzed this change",
}: {
  label?: string;
  title?: string;
}) {
  return (
    <span className="aiBadge" title={title}>
      <span className="aiBadgeDot" aria-hidden />
      {label}
    </span>
  );
}
