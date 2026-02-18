import "server-only";

import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

export async function htmlToPdfBuffer(
  html: string,
  opts?: {
    format?: "A4";
    landscape?: boolean;
    margin?: { top?: string; right?: string; bottom?: string; left?: string };
    viewport?: { width: number; height: number; deviceScaleFactor?: number };
  }
): Promise<Buffer> {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_REGION;

  const browser = isServerless
    ? await puppeteerCore.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      })
    : await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();

    const vp = opts?.viewport ?? { width: 1240, height: 1754, deviceScaleFactor: 2 };
    await page.setViewport(vp);

    await page.setContent(html, { waitUntil: "networkidle2" });
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );

    const pdf = await page.pdf({
      format: opts?.format ?? "A4",
      landscape: !!opts?.landscape,
      printBackground: true,
      margin: {
        top: opts?.margin?.top ?? "14mm",
        right: opts?.margin?.right ?? "12mm",
        bottom: opts?.margin?.bottom ?? "14mm",
        left: opts?.margin?.left ?? "12mm",
      },
    });

    return pdf as Buffer;
  } finally {
    await browser.close();
  }
}

