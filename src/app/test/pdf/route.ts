import PDFDocument from "pdfkit";
import { NextResponse, type NextRequest } from "next/server";

function renderPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("PDF Export Baseline OK", 50, 50);
    doc.fontSize(12).text("If you can read this, exports work.", 50, 100);

    doc.end();
  });
}

export async function GET() {
  const buffer = await renderPdf();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="baseline.pdf"',
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
}

