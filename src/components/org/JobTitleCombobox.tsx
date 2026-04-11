// src/components/org/JobTitleCombobox.tsx
// Uses native <datalist> for the dropdown — no custom JS state, works everywhere.
// Suggestions come from the rate card role_label values so both stay in sync.
"use client";

import { useEffect, useId, useState } from "react";

type Props = {
  orgId:        string;
  value:        string;
  onChange:     (val: string) => void;
  disabled?:    boolean;
  placeholder?: string;
  className?:   string;
  style?:       React.CSSProperties;
};

export default function JobTitleCombobox({
  orgId,
  value,
  onChange,
  disabled,
  placeholder = "e.g. Project Manager",
  className,
  style,
}: Props) {
  const [roles, setRoles] = useState<string[]>([]);
  const listId = useId().replace(/:/g, "");

  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/org/rate-card-roles?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (d.ok && Array.isArray(d.roles)) setRoles(d.roles); })
      .catch(() => {});
  }, [orgId]);

  return (
    <div style={style} className={className}>
      <input
        list={listId}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%",
          border: "1px solid #d1d5db",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 14,
          color: "#0d1117",
          background: disabled ? "#f9fafb" : "#fff",
          outline: "none",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
        className="focus:ring-2 focus:ring-cyan-500"
      />
      <datalist id={listId}>
        {roles.map(r => <option key={r} value={r} />)}
      </datalist>
      {roles.length > 0 && !disabled && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>
          Suggestions from rate card — selecting one auto-links to the correct rate.
        </div>
      )}
    </div>
  );
}