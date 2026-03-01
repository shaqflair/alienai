"use client";

import { useState } from "react";

const COLOURS = [
  { value: "#0cb8b6", label: "Teal"   },
  { value: "#3b82f6", label: "Blue"   },
  { value: "#8b5cf6", label: "Purple" },
  { value: "#ec4899", label: "Pink"   },
  { value: "#f59e0b", label: "Amber"  },
  { value: "#10b981", label: "Green"  },
  { value: "#ef4444", label: "Red"    },
  { value: "#f97316", label: "Orange" },
];

const DEPARTMENTS = [
  "Design",
  "Engineering",
  "Analytics",
  "Delivery",
  "Product",
  "Marketing",
];

export default function HeatmapProjectFields() {
  const [status,  setStatus]  = useState<"confirmed" | "pipeline">("confirmed");
  const [winProb, setWinProb] = useState(80);
  const [colour,  setColour]  = useState("#0cb8b6");
  const [dept,    setDept]    = useState("");
  const [code,    setCode]    = useState("");

  const isPipeline = status === "pipeline";

  return (
    <>
      <style>{`
        @keyframes pp-slide-down {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .pp-heatmap-fields {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .pp-status-toggle {
          display: flex;
          gap: 8px;
        }
        .pp-status-btn {
          flex: 1;
          padding: 9px 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          transition: all 0.15s;
          border: 1.5px solid #e2e8f0;
          background: white;
          color: #64748b;
        }
        .pp-status-btn.active-confirmed {
          background: #00B8DB;
          border-color: #00B8DB;
          color: white;
        }
        .pp-status-btn.active-pipeline {
          background: #7c3aed;
          border-color: #7c3aed;
          color: white;
        }
        .pp-pipeline-box {
          background: #f5f0ff;
          border: 1px solid #c4b5fd;
          border-radius: 10px;
          padding: 14px 16px;
          animation: pp-slide-down 0.2s ease;
        }
        .pp-pipeline-label {
          display: block;
          font-size: 12.5px;
          font-weight: 700;
          color: #7c3aed;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .pp-range-row {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .pp-range-row input[type="range"] {
          flex: 1;
          accent-color: #7c3aed;
        }
        .pp-prob-value {
          font-size: 22px;
          font-weight: 800;
          min-width: 52px;
          text-align: right;
        }
        .pp-colour-swatches {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .pp-swatch {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          transition: outline 0.1s;
          outline: 2px solid transparent;
          outline-offset: 2px;
        }
        .pp-colour-preview {
          margin-left: 8px;
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 700;
          font-family: 'DM Mono', monospace;
        }
      `}</style>

      <div className="pp-heatmap-fields">

        {/* Section label */}
        <p style={{
          fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "#00B8DB", margin: 0,
        }}>
          ▦ Resource heatmap
        </p>

        {/* Code + Department */}
        <div className="pp-form-row">
          <div>
            <label className="pp-field-label" htmlFor="hm-code">
              Project code
            </label>
            <input
              id="hm-code"
              name="project_code"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. ATL-01"
              className="pp-input"
              autoComplete="off"
            />
            <p className="pp-field-hint">Shown in heatmap cells.</p>
          </div>
          <div>
            <label className="pp-field-label" htmlFor="hm-dept">
              Department
            </label>
            <select
              id="hm-dept"
              name="department"
              value={dept}
              onChange={e => setDept(e.target.value)}
              className="pp-select"
            >
              <option value="">Select department…</option>
              {DEPARTMENTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <p className="pp-field-hint">Used in heatmap filter bar.</p>
          </div>
        </div>

        {/* Status toggle */}
        <div>
          <label className="pp-field-label">Resource status</label>
          <div className="pp-status-toggle">
            <button
              type="button"
              onClick={() => setStatus("confirmed")}
              className={`pp-status-btn${status === "confirmed" ? " active-confirmed" : ""}`}
            >
              ✓ Confirmed
            </button>
            <button
              type="button"
              onClick={() => setStatus("pipeline")}
              className={`pp-status-btn${status === "pipeline" ? " active-pipeline" : ""}`}
            >
              ◌ Pipeline
            </button>
          </div>
          {/* Hidden input — carries value to server action */}
          <input type="hidden" name="resource_status" value={status} />
          <p className="pp-field-hint">
            {isPipeline
              ? "Pipeline projects appear in capacity gap analysis only — no hard allocation."
              : "Confirmed projects affect the live capacity heatmap immediately."}
          </p>
        </div>

        {/* Win probability — only when pipeline */}
        {isPipeline && (
          <div className="pp-pipeline-box">
            <label className="pp-pipeline-label">
              Win probability — {winProb}%
            </label>
            <div className="pp-range-row">
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={winProb}
                onChange={e => setWinProb(parseInt(e.target.value))}
              />
              <span
                className="pp-prob-value"
                style={{
                  color: winProb >= 70
                    ? "#059669"
                    : winProb >= 40
                    ? "#d97706"
                    : "#dc2626",
                }}
              >
                {winProb}%
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
              {([
                ["5–39%",  "Low",    "#dc2626"],
                ["40–69%", "Medium", "#d97706"],
                ["70–100%","High",   "#059669"],
              ] as const).map(([range, label, color]) => (
                <span key={label} style={{ fontSize: "11px", color: "#94a3b8" }}>
                  {range} = <strong style={{ color }}>{label}</strong>
                </span>
              ))}
            </div>
            <p className="pp-field-hint" style={{ marginTop: "8px" }}>
              Drives weighted demand in the pipeline capacity view.
            </p>
            {/* Hidden input — carries slider value to server action */}
            <input type="hidden" name="win_probability" value={winProb} />
          </div>
        )}

        {/* Colour picker */}
        <div>
          <label className="pp-field-label">Project colour</label>
          <div className="pp-colour-swatches">
            {COLOURS.map(c => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                onClick={() => setColour(c.value)}
                className="pp-swatch"
                style={{
                  background: c.value,
                  outline: colour === c.value
                    ? `3px solid ${c.value}`
                    : "2px solid transparent",
                }}
              />
            ))}
            {/* Live preview of how the project tag looks in the heatmap */}
            <div
              className="pp-colour-preview"
              style={{
                background:   `${colour}18`,
                border:       `1px solid ${colour}50`,
                borderLeft:   `3px solid ${colour}`,
                color:         colour,
              }}
            >
              {code || "PRJ-01"}
            </div>
          </div>
          {/* Hidden input — carries colour to server action */}
          <input type="hidden" name="colour" value={colour} />
          <p className="pp-field-hint">Identifies this project in heatmap swimlane rows.</p>
        </div>

      </div>
    </>
  );
}
