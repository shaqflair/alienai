"use client";

import { useEffect, useRef, useState } from "react";

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
  const [roles,       setRoles]       = useState<string[]>([]);
  const [open,        setOpen]        = useState(false);
  const [inputValue,  setInputValue]  = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  // Sync external value -> local
  useEffect(() => { setInputValue(value); }, [value]);

  // Load rate card roles from the API you just created
  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/org/rate-card-roles?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (d.ok && Array.isArray(d.roles)) setRoles(d.roles); })
      .catch(() => {});
  }, [orgId]);

  const filtered = roles.filter(r =>
    !inputValue.trim() || r.toLowerCase().includes(inputValue.toLowerCase())
  );

  function select(role: string) {
    setInputValue(role);
    onChange(role);
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleBlur(e: React.FocusEvent) {
    // Close only if focus left both input and list
    if (!listRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
      onChange(inputValue); // commit free-text on blur
    }
  }

  const listId = `job-title-list-${orgId.slice(0, 8)}`;

  return (
    <div style={{ position: "relative", ...style }} className={className}>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => {
          setInputValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={e => {
          if (e.key === "Escape") { setOpen(false); }
          if (e.key === "Enter" && filtered.length === 1) { select(filtered[0]); e.preventDefault(); }
        }}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open && filtered.length > 0}
        style={{
          width: "100%",
          border: "1px solid #d1d5db",
          borderRadius: 6,
          padding: "8px 30px 8px 10px",
          fontSize: 14,
          color: "#0d1117",
          background: disabled ? "#f9fafb" : "#fff",
          outline: "none",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
      
      {/* Dropdown arrow toggle */}
      {roles.length > 0 && !disabled && (
        <span
          onClick={() => { setOpen(v => !v); inputRef.current?.focus(); }}
          style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            cursor: "pointer", color: "#6b7280", userSelect: "none", fontSize: 10,
          }}
        >
          ▼
        </span>
      )}

      {/* Dropdown list */}
      {open && filtered.length > 0 && !disabled && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute", zIndex: 999, top: "calc(100% + 2px)", left: 0, right: 0,
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
            maxHeight: 220,
            overflowY: "auto",
            margin: 0, padding: "4px 0",
            listStyle: "none",
          }}
        >
          {/* Custom "Use as typed" option */}
          {inputValue.trim() && !roles.includes(inputValue.trim()) && (
            <li
              role="option"
              onMouseDown={e => { e.preventDefault(); select(inputValue.trim()); }}
              style={{
                padding: "7px 12px", fontSize: 13, cursor: "pointer",
                color: "#6b7280", fontStyle: "italic",
                borderBottom: "1px solid #f3f4f6",
              }}
            >
              Use "{inputValue.trim()}"
            </li>
          )}
          {filtered.map(role => (
            <li
              key={role}
              role="option"
              aria-selected={role === value}
              onMouseDown={e => { e.preventDefault(); select(role); }}
              style={{
                padding: "8px 12px", fontSize: 13, cursor: "pointer",
                background: role === value ? "#eff6ff" : "transparent",
                color: role === value ? "#1d4ed8" : "#0d1117",
                fontWeight: role === value ? 600 : 400,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#f9fafb"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = role === value ? "#eff6ff" : "transparent"; }}
            >
              <span>{role}</span>
              {role === value && <span style={{ fontSize: 10, color: "#3b82f6" }}>✓</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Helper text */}
      {roles.length > 0 && !disabled && (
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>
          Suggestions from rate card — selecting one auto-links to the correct rate.
        </div>
      )}
    </div>
  );
}
