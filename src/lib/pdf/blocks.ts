import "server-only";

import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";

function safeParam(x: unknown) {
  return typeof x === "string" ? x : "";
}

function isProdLike() {
  // treat Vercel / prod builds as prod-like
  return process.env.NODE_ENV === "production" || !!process.env.VERCEL;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; artifactId: string }> }
) {
  const { id, artifactId } = await ctx.params;
  const projectId = safeParam(id).trim();
  const aid = safeParam(artifactId).trim();

  if (!projectId || !aid) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const html = `<!doctype html><html><body><h1>HELLO PDF</h1><p>${projectId}</p><p>${aid}</p></body></html>`;

  const prodLike = isProdLike();

  const launchOptions: Parameters<typeof puppeteer.launch>[0] = prodLike
    ? {
        // ✅ Serverless/Production: use Sparticuz Chromium
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      }
    : {
        // ✅ Local dev (Windows): use installed Chrome
        // Option 1: set PUPPETEER_EXECUTABLE_PATH to your Chrome path
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        // Option 2: if executablePath not provided, let puppeteer try a known channel
        channel: process.env.PUPPETEER_EXECUTABLE_PATH ? undefined : ("chrome" as any),
        headless: true,
      };

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="test.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await browser.close();
  }
}
