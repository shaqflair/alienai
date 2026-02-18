"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import SectionsOnlyTableEditor from "@/components/editors/SectionsOnlyTableEditor";
import type { CharterSection } from "@/components/editors/ProjectCharterSectionEditor";

type RowObj = { type: "header" | "data"; cells: string[] };

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function pad(arr: string[], n: number) {
  const out = [...arr.map((x) => s(x))];
  while (out.length < n) out.push("");
  return out.slice(0, n);
}

/**
 * IMPORTANT:
 * We store 4 columns only:
 * [Stakeholder, Role/Interest, Influence, Engagement/Notes]
 * The editor adds a separate sticky Actions column automatically.
 */
function buildStakeholdersSection(): CharterSection {
  return {
    key: "stakeholders",
    title: "Stakeholders",
    table: {
      columns: 4,
      rows: [
        { type: "header", cells: ["Stakeholder", "Role/Interest", "Influence", "Engagement / Notes"] },
        { type: "data", cells: ["", "", "", ""] },
      ],
    },
  };
}

function extractStakeholdersSectionFromCharterJson(json: any): CharterSection | null {
  const secs = json?.sections;
  if (!Array.isArray(secs)) return null;

  const sec = secs.find((x: any) => s(x?.key) === "stakeholders");
  if (!sec) return null;

  // normalize to 4 cols if needed
  const t = sec?.table;
  if (!t?.rows?.length) return null;

  const cols = Math.max(1, Number(t.columns || 1));
  const rows: RowObj[] = (t.rows || []).map((r: any) => ({
    type: r.type === "header" ? "header" : "data",
    cells: pad(Array.isArray(r.cells) ? r.cells : [], cols),
  }));

  // If old data included an "Actions" cell in the JSON, drop it.
  // Expected: 4 cols max; anything beyond is trimmed.
  const fixedCols = 4;
  const fixedRows = rows.map((r) => ({ ...r, cells: pad(r.cells.slice(0, fixedCols), fixedCols) }));

  return {
    key: "stakeholders",
    title: s(sec?.title) || "Stakeholders",
    table: { columns: fixedCols, rows: fixedRows },
  } as CharterSection;
}

/**
 * If old register-style arrays exist, migrate into the 4-column table.
 * Old fields like point_of_contact/internal_external/title_role are preserved into notes.
 */
function migrateRegisterJsonToStakeholdersSection(json: any): CharterSection {
  const section = buildStakeholdersSection();
  const header = (section.table as any).rows[0] as RowObj;

  const candidates: any[] =
    (Array.isArray(json?.stakeholders) && json.stakeholders) ||
    (Array.isArray(json?.rows) && json.rows) ||
    (Array.isArray(json?.items) && json.items) ||
    (Array.isArray(json?.data) && json.data) ||
    [];

  const rows: RowObj[] = [header];

  for (const r of candidates) {
    const stakeholder = s(r?.stakeholder || r?.name || r?.stakeholder_name);
    const roleInterest = s(r?.role || r?.role_interest || r?.interest);
    const influence = s(r?.influence || r?.power || r?.impact || "Medium");

    const poc = s(r?.point_of_contact || r?.contact || r?.poc);
    const ie = s(r?.internal_external || r?.internalExternal || r?.type);
    const titleRole = s(r?.title_role || r?.title || r?.job_title);
    const engagement = s(r?.engagement || r?.notes || r?.engagement_notes);

    const notesParts = [
      poc ? `POC: ${poc}` : "",
      ie ? `Type: ${ie}` : "",
      titleRole ? `Title/Role: ${titleRole}` : "",
      engagement,
    ].filter(Boolean);

    const notes = notesParts.join(" | ");

    rows.push({
      type: "data",
      cells: pad([stakeholder, roleInterest, influence, notes], 4),
    });
  }

  if (rows.length === 1) rows.push({ type: "data", cells: ["", "", "", ""] });

  section.table = { columns: 4, rows };
  return section;
}

function coerceInitialToStakeholdersSection(initialJson: any): CharterSection {
  // Already charter-style content_json with sections
  const sec = extractStakeholdersSectionFromCharterJson(initialJson);
  if (sec) return sec;

  // register-style
  if (
    initialJson &&
    (Array.isArray(initialJson?.stakeholders) ||
      Array.isArray(initialJson?.rows) ||
      Array.isArray(initialJson?.items) ||
      Array.isArray(initialJson?.data))
  ) {
    return migrateRegisterJsonToStakeholdersSection(initialJson);
  }

  return buildStakeholdersSection();
}

export default function StakeholderRegisterClient(props: {
  projectId: string;
  canEdit: boolean;
  artifactId: string | null;
  initialJson: any | null;
}) {
  const { projectId, canEdit, artifactId, initialJson } = props;

  const readOnly = !canEdit;

  const initialSection = useMemo(
    () => coerceInitialToStakeholdersSection(initialJson),
    [initialJson]
  );

  const [sections, setSections] = useState<CharterSection[]>([initialSection]);

  // reset when switching artifact/project
  useEffect(() => {
    setSections([initialSection]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, artifactId]);

  const [isPending, startTransition] = useTransition();
  const lastSavedRef = useRef<string>("");

  function buildPayload() {
    return {
      version: 2,
      type: "stakeholder_register",
      meta: {}, // intentionally empty (table-only view)
      sections,
    };
  }

  async function saveNow() {
    if (readOnly) return;

    const payload = buildPayload();
    const sig = JSON.stringify(payload);
    if (sig === lastSavedRef.current) return;

    const res = await fetch(`/api/stakeholders/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        artifactId,
        contentJson: payload,
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || `Save failed (${res.status})`);
    }

    lastSavedRef.current = sig;
  }

  // debounce autosave
  useEffect(() => {
    if (readOnly) return;

    const handle = window.setTimeout(() => {
      startTransition(() => {
        saveNow().catch((e) => console.warn("[stakeholders.save]", e?.message || e));
      });
    }, 700);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, readOnly]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {readOnly ? "Read-only" : isPending ? "Saving…" : "Saved"}
        </div>

        {!readOnly ? (
          <button
            type="button"
            className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
            disabled={isPending}
            onClick={() => {
              startTransition(() => {
                saveNow().catch((e) => alert(e?.message || "Save failed"));
              });
            }}
          >
            Save
          </button>
        ) : null}
      </div>

      <SectionsOnlyTableEditor
        sections={sections}
        onChange={setSections}
        readOnly={readOnly}
        aiDisabled
      />
    </div>
  );
}
