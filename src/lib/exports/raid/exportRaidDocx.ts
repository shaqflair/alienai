import "server-only";

import { Packer, Paragraph } from "docx";
import { ExportMeta } from "../core/meta";
import { buildStandardDocxShell, docxTable } from "../docx/standardDocx";
import { formatIsoDateOnly } from "../core/format";
import { RaidItem } from "./types";

/**
 * Generates a RAID Register DOCX buffer.
 * Utilizes the standard shell and table utilities to ensure consistent branding.
 */
export async function exportRaidDocxBuffer(args: { meta: ExportMeta; items: RaidItem[] }) {
  const { meta, items } = args;

  const doc = buildStandardDocxShell({
    title: "RAID Register",
    subtitle: meta.projectCode ? `Project ${meta.projectCode} • Org Library Standard` : "Org Library Standard",
    meta,
    theme: { primary: meta.brandPrimary },
    children: [
      new Paragraph({ text: " ", spacing: { after: 120 } }),
      docxTable({
        headers: ["Type", "Title / Detail", "Owner", "Status", "Due"],
        rows: (items || []).map((it) => [
          it.type?.toUpperCase() || "",
          (it.title || "") + (it.description ? ` — ${it.description}` : ""),
          it.owner || "—",
          it.status || "—",
          formatIsoDateOnly(it.due_date) || "—",
        ]),
      }),
    ],
  });

  return await Packer.toBuffer(doc);
}
