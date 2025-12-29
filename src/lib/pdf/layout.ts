// src/lib/pdf/layout.ts
import PDFDocument from "pdfkit";
import type { PdfBounds } from "./chrome";

export function currentBounds(doc: PDFDocument, b: PdfBounds) {
  return {
    ...b,
    y: doc.y,
    remaining: b.bottom - doc.y,
  };
}

/**
 * Ensure there's vertical space available for the next block.
 * If not enough space, call `addPage()` and return true.
 */
export function ensureSpace(
  doc: PDFDocument,
  needHeight: number,
  chrome: { bounds: (doc: PDFDocument) => PdfBounds; addPage: (doc: PDFDocument) => void }
): boolean {
  const b = chrome.bounds(doc);
  const remaining = b.bottom - doc.y;

  if (remaining >= needHeight) return false;

  chrome.addPage(doc);
  return true;
}

/**
 * Section title helper (Classic view style):
 * - Full-width light-green band
 * - Dark-green title text
 * - Safe pagination (no recursion)
 */
export function drawSectionTitle(
  doc: PDFDocument,
  title: string,
  chrome: { bounds: (doc: PDFDocument) => PdfBounds; addPage: (doc: PDFDocument) => void }
) {
  // Band height + spacing below
  const bandH = 20;
  const padX = 8;
  const after = 8;

  // Ensure we have space for the band + a little breathing room
  ensureSpace(doc, bandH + after + 4, chrome);

  const b = chrome.bounds(doc);
  const y = doc.y;

  // Draw band
  doc.save();
  doc.fillColor("#D9F5E5"); // light green band (classic view vibe)
  doc.rect(b.left, y, b.width, bandH).fill();
  doc.restore();

  // Title text
  doc.save();
  doc.fillColor("#0F5132"); // dark green
  doc.fontSize(12);
  doc.text(title, b.left + padX, y + 5, {
    width: b.width - padX * 2,
    lineBreak: false,
    ellipsis: true,
  });
  doc.restore();

  // Move cursor below band
  doc.y = y + bandH + after;
}
