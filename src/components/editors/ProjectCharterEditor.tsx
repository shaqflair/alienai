// src/components/editors/ProjectCharterEditor.tsx
"use client";

import React, { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

// Tiptap v3 uses named exports
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

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
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "PROJECT CHARTER" }] },
                ],
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
              { type: "tableCell", attrs: { colspan: 3 }, content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
            ],
          },

          // Business Need
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 4 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Business Need" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 4 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
              },
            ],
          },

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
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Financials" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Budget to complete this project" }] }] },
            ],
          },

          // Milestones
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Milestones Schedule" }] }] },
            ],
          },
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
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", attrs: { colspan: 4 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Approval / Review Committee" }] }] },
            ],
          },
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

export default function ProjectCharterEditor({
  initialJson,
  onChange,
  readOnly = false,
  lockLayout = false,
}: {
  initialJson: any;
  onChange: (doc: any) => void;
  readOnly?: boolean;
  lockLayout?: boolean;
}) {
  const content = useMemo(() => {
    if (!isDocLike(initialJson)) return makeDefaultCharterDoc();
    if (!hasTable(initialJson)) return makeDefaultCharterDoc();
    return initialJson;
  }, [initialJson]);

  const editor = useEditor({
    immediatelyRender: false, // avoids hydration mismatch with Next.js

    editable: !readOnly,
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
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: {
        class: "focus:outline-none max-w-none text-sm",
      },
    },
  });

  // Auto-heal if table deleted (only when layout NOT locked)
  useEffect(() => {
    if (!editor) return;
    if (lockLayout) return;

    const json = editor.getJSON();
    if (!hasTable(json)) editor.commands.setContent(makeDefaultCharterDoc(), false);
  }, [editor, lockLayout]);

  if (!editor) return null;

  const showToolbar = !readOnly && !lockLayout;

  return (
    <div className="space-y-3">
      {showToolbar ? <Toolbar editor={editor} /> : null}

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

        /* Light green headers */
        .ProseMirror th {
          background: #dcfce7;
          font-weight: 700;
        }

        /* Yellow title band (first row) */
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

function Toolbar({ editor }: { editor: any }) {
  const btn = "rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100";

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
    </div>
  );
}
