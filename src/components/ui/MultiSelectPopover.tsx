"use client";

import * as React from "react";

export type MultiSelectOption = {
  value: string;
  label: string;
};

function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

export default function MultiSelectPopover(props: {
  value: string[];
  options: MultiSelectOption[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  widthClassName?: string;
  maxChips?: number;
}) {
  const {
    value = [],
    options,
    onChange,
    disabled,
    placeholder = "Select…",
    widthClassName = "w-[320px]",
    maxChips = 2,
  } = props;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  const selected = new Set(value.map(String));

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
  }, [query, options]);

  function toggle(v: string) {
    const next = new Set(selected);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange(Array.from(next));
  }

  function remove(v: string) {
    onChange(value.filter((x) => x !== v));
  }

  const chosen = options.filter((o) => selected.has(o.value));
  const shown = chosen.slice(0, maxChips);
  const extra = Math.max(0, chosen.length - shown.length);

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className={cx("relative", widthClassName)}>
      {/* Trigger (NOT a <button> to avoid nested-button hydration errors) */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled ? "true" : "false"}
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        onKeyDown={onTriggerKeyDown}
        className={cx(
          "w-full rounded-lg border px-3 py-2 text-sm flex items-center justify-between select-none",
          disabled && "opacity-60 cursor-not-allowed",
          !disabled && "cursor-pointer"
        )}
      >
        <div className="flex flex-wrap gap-2 min-w-0">
          {chosen.length === 0 ? (
            <span className="text-gray-500">{placeholder}</span>
          ) : (
            <>
              {shown.map((o) => (
                <span
                  key={o.value}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs bg-gray-50"
                >
                  {o.label}

                  {!disabled && (
                    // Use <span role="button"> instead of <button> (no nested buttons)
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(o.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          remove(o.value);
                        }
                      }}
                      className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-500 hover:text-black hover:bg-white"
                      title="Remove"
                      aria-label="Remove"
                    >
                      ×
                    </span>
                  )}
                </span>
              ))}

              {extra > 0 && <span className="text-xs text-gray-600">+{extra}</span>}
            </>
          )}
        </div>

        <span className="ml-2 text-gray-400">?</span>
      </div>

      {/* Dropdown */}
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-white shadow-lg">
          <div className="p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-md border px-2 py-1 text-sm outline-none"
            />
          </div>

          <div className="max-h-60 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
            ) : (
              filtered.map((o) => {
                const active = selected.has(o.value);
                return (
                  <div
                    key={o.value}
                    role="option"
                    aria-selected={active ? "true" : "false"}
                    onClick={() => toggle(o.value)}
                    className={cx(
                      "w-full flex justify-between items-center px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer",
                      active && "bg-gray-100"
                    )}
                  >
                    <span>{o.label}</span>
                    <span className="text-xs">{active ? "?" : ""}</span>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-between px-3 py-2 text-xs text-gray-500">
            <span
              role="button"
              tabIndex={0}
              onClick={() => onChange([])}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange([]);
                }
              }}
              className="cursor-pointer hover:text-black"
            >
              Clear
            </span>

            <span
              role="button"
              tabIndex={0}
              onClick={() => setOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              className="cursor-pointer hover:text-black"
            >
              Done
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
