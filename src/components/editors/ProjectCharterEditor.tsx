// src/components/editors/ProjectCharterEditor.tsx
"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

// Tiptap v3 uses named exports
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

export type ImproveWithAIPayload = {
  mode: "selection" | "cell" | "doc";
  text: string; // plain text extracted
  html: string; // html snapshot (helpful for LLM)
  json: any; // json snapshot (helpful for LLM)
  meta: {
    from: number;
    to: number;
    hasSelection: boolean;
    readOnly: boolean;
    lockLayout: boolean;
    selectionText?: string;
    createdAtIso: string;
  };
};

function makeDefaultCharterDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          // Title band
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 4, rowspan: 1, colwidth: [240, 240, 240, 240] },
                content: [{ type: "paragraph", content: [{ type: "text", text: "PROJECT CHARTER" }] }],
              },
            ],
          },

          // Metadata rows
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Project Title" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Project Manager" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Project Start Date" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Project End Date" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Project Sponsor" }] }] },
              {
                type: "tableCell",
                attrs: { colspan: 3 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
              },
            ],
          },

          // Business Need
          { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Business Need" }] }] }] },
          { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] }] },

          // Scope vs Deliverables
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Project Scope" }] }] },
              { type: "tableHeader", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Deliverables" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "1." }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "2." }] }] },
            ],
          },

          // Risks vs Assumptions
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Risks & Issues" }] }] },
              { type: "tableHeader", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Assumptions / Dependencies" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "1." }] }] },
              { type: "tableCell", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "1." }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "2." }] }] },
              { type: "tableCell", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "2." }] }] },
            ],
          },

          // Financials
          { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Financials" }] }] }] },
          { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Budget to complete this project" }] }] }] },

          // Milestones
          { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Milestones Schedule" }] }] }] },
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Milestone" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Target Completion Date" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Actual Date" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Notes" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Milestone 1" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Milestone 2" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
            ],
          },

          // Approvals
          { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Approval / Review Committee" }] }] }] },
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Role" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Project Manager" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Sponsor" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
            ],
          },
        ],
      },
    ],
  };
}

function isDocLike(x: any) {
  return x && typeof x === "object" && x.type === "doc" && Array.isArray(x.content);
}

function hasTable(doc: any) {
  const c = doc?.content;
  return Array.isArray(c) && c.some((n: any) => n?.type === "table");
}

function safeTextBetween(editor: any, from: number, to: number) {
  try {
    return editor.state.doc.textBetween(from, to, "\n", "\n").trim();
  } catch {
    return "";
  }
}

function buildImprovePayload(editor: any, readOnly: boolean, lockLayout: boolean): ImproveWithAIPayload {
  const { from, to, empty } = editor.state.selection;

  const jsonDoc = editor.getJSON();
  const htmlDoc = editor.getHTML();

  if (!empty) {
    const text = safeTextBetween(editor, from, to);
    return {
      mode: "selection",
      text,
      html: htmlDoc,
      json: jsonDoc,
      meta: {
        from,
        to,
        hasSelection: true,
        readOnly,
        lockLayout,
        selectionText: text,
        createdAtIso: new Date().toISOString(),
      },
    };
  }

  const window = 250;
  const start = Math.max(0, from - window);
  const end = Math.min(editor.state.doc.content.size, from + window);
  const nearText = safeTextBetween(editor, start, end);

  if (nearText) {
    return {
      mode: "cell",
      text: nearText,
      html: htmlDoc,
      json: jsonDoc,
      meta: {
        from: start,
        to: end,
        hasSelection: false,
        readOnly,
        lockLayout,
        selectionText: nearText,
        createdAtIso: new Date().toISOString(),
      },
    };
  }

  const allText = (editor.getText?.() ?? "").trim();
  return {
    mode: "doc",
    text: allText,
    html: htmlDoc,
    json: jsonDoc,
    meta: {
      from: 0,
      to: editor.state.doc.content.size,
      hasSelection: false,
      readOnly,
      lockLayout,
      selectionText: allText,
      createdAtIso: new Date().toISOString(),
    },
  };
}

function stableSig(x: any) {
  try {
    return JSON.stringify(x ?? {});
  } catch {
    return String(x ?? "");
  }
}

export default function ProjectCharterEditor({
  initialJson,
  onChange,
  readOnly = false,
  lockLayout = false,
  onImproveWithAI,
  improveEnabled = true,
  improveLoading = false,
}: {
  initialJson: any;
  onChange: (doc: any) => void;
  readOnly?: boolean;
  lockLayout?: boolean;
  onImproveWithAI?: (payload: ImproveWithAIPayload) => void;
  improveEnabled?: boolean;
  improveLoading?: boolean;
}) {
  const canEdit = !readOnly && !lockLayout;

  const content = useMemo(() => {
    if (!isDocLike(initialJson)) return makeDefaultCharterDoc();
    if (!hasTable(initialJson)) return makeDefaultCharterDoc();
    return initialJson;
  }, [initialJson]);

  const contentSig = useMemo(() => stableSig(content), [content]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Table.configure({ resizable: true, lastColumnResizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
    onUpdate: ({ editor }) => {
      // When locked/readOnly, we still allow the view, but avoid emitting changes.
      if (!canEdit) return;
      onChange(editor.getJSON());
    },
    editorProps: {
      attributes: {
        class: "focus:outline-none max-w-none text-sm",
      },
    },
  });

  // Ensure table exists (unless locked)
  useEffect(() => {
    if (!editor) return;
    if (lockLayout) return;
    const json = editor.getJSON();
    if (!hasTable(json)) editor.commands.setContent(makeDefaultCharterDoc(), false);
  }, [editor, lockLayout]);

  // Keep editor in sync if parent swaps initialJson (e.g., after migrate/save),
  // but don't clobber active typing.
  const lastAppliedSigRef = useRef<string>("");
  useEffect(() => {
    if (!editor) return;

    // First mount / first apply
    if (!lastAppliedSigRef.current) {
      lastAppliedSigRef.current = contentSig;
      return;
    }

    if (contentSig === lastAppliedSigRef.current) return;

    // If user is actively focused, avoid overwriting their cursor.
    if (editor.isFocused) return;

    try {
      editor.commands.setContent(content, false);
      lastAppliedSigRef.current = contentSig;
    } catch {
      // ignore
    }
  }, [editor, content, contentSig]);

  if (!editor) return null;

  const showToolbar = canEdit;

  return (
    <div className="space-y-3">
      {showToolbar ? (
        <Toolbar
          editor={editor}
          readOnly={readOnly}
          lockLayout={lockLayout}
          onImproveWithAI={onImproveWithAI}
          improveEnabled={!!improveEnabled}
          improveLoading={!!improveLoading}
        />
      ) : null}

      <div className="rounded-lg border border-neutral-300 bg-white p-3 overflow-auto">
        <EditorContent editor={editor} />
      </div>

      <style>{`
        .ProseMirror table {
          border-collapse: collapse;
          width: 100%;
          table-layout: fixed;
          font-size: 12px;
        }
        .ProseMirror td, .ProseMirror th {
          border: 1px solid #cfcfcf;
          padding: 6px 8px;
          vertical-align: top;
          word-break: break-word;
        }
        .ProseMirror th {
          background: #dcfce7;
          font-weight: 700;
        }
        .ProseMirror table tr:first-child td {
          background: #facc15;
          font-weight: 900;
          text-align: center;
          font-size: 18px;
          letter-spacing: 0.5px;
        }
        .ProseMirror td:focus, .ProseMirror th:focus {
          outline: 2px solid rgba(0,0,0,0.15);
          outline-offset: -2px;
        }
        .ProseMirror .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: 0;
          width: 4px;
          background: rgba(0,0,0,0.08);
          pointer-events: none;
        }
        .ProseMirror .resize-cursor {
          cursor: col-resize;
        }
      `}</style>
    </div>
  );
}

function Toolbar({
  editor,
  readOnly,
  lockLayout,
  onImproveWithAI,
  improveEnabled,
  improveLoading,
}: {
  editor: any;
  readOnly: boolean;
  lockLayout: boolean;
  onImproveWithAI?: (payload: ImproveWithAIPayload) => void;
  improveEnabled: boolean;
  improveLoading: boolean;
}) {
  const btn = "rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-60";
  const btnPrimary = "rounded border border-neutral-300 px-2 py-1 text-xs bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-60";

  const canImprove = !!onImproveWithAI && improveEnabled && !readOnly && !lockLayout;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <button type="button" className={btn} onClick={() => editor.chain().focus().addRowBefore().run()}>
        + Row Above
      </button>
      <button type="button" className={btn} onClick={() => editor.chain().focus().addRowAfter().run()}>
        + Row Below
      </button>
      <button type="button" className={btn} onClick={() => editor.chain().focus().deleteRow().run()}>
        − Row
      </button>

      <span className="mx-1 h-4 w-px bg-neutral-300" />

      <button type="button" className={btn} onClick={() => editor.chain().focus().addColumnBefore().run()}>
        + Col Left
      </button>
      <button type="button" className={btn} onClick={() => editor.chain().focus().addColumnAfter().run()}>
        + Col Right
      </button>
      <button type="button" className={btn} onClick={() => editor.chain().focus().deleteColumn().run()}>
        − Col
      </button>

      <span className="mx-1 h-4 w-px bg-neutral-300" />

      <button type="button" className={btn} onClick={() => editor.chain().focus().mergeCells().run()}>
        Merge
      </button>
      <button type="button" className={btn} onClick={() => editor.chain().focus().splitCell().run()}>
        Split
      </button>

      <span className="mx-1 h-4 w-px bg-neutral-300" />

      <button type="button" className={btn} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
        Header Row
      </button>
      <button type="button" className={btn} onClick={() => editor.chain().focus().toggleHeaderColumn().run()}>
        Header Col
      </button>

      <span className="mx-1 h-4 w-px bg-neutral-300" />

      <button
        type="button"
        className={btn}
        onClick={() => {
          editor.chain().focus().addRowAfter().run();
          editor.chain().focus().toggleHeaderRow().run();
        }}
        title="Adds a new header band row for a new section title"
      >
        + Section Title
      </button>

      <button
        type="button"
        className={btn}
        onClick={() => editor.commands.setContent(makeDefaultCharterDoc(), false)}
        title="Reset to the default charter layout"
      >
        Reset Layout
      </button>

      {canImprove ? (
        <>
          <span className="mx-1 h-4 w-px bg-neutral-300" />
          <button
            type="button"
            className={btnPrimary}
            disabled={improveLoading}
            onClick={() => onImproveWithAI?.(buildImprovePayload(editor, readOnly, lockLayout))}
            title="Improve the selected text (or current cell / doc) using AI"
          >
            {improveLoading ? "✨ Improving…" : "✨ Improve with AI"}
          </button>
        </>
      ) : null}
    </div>
  );
}
