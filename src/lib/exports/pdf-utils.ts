import "server-only";

import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

type HtmlToPdfOpts = {
  format?: "A4";
  landscape?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
};

async function launchBrowser() {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_REGION || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isServerless) {
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
    });
  }

  return puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

export async function htmlToPdfBuffer(html: string, opts?: HtmlToPdfOpts): Promise<Buffer> {
  if (!html || typeof html !== "string") throw new Error("htmlToPdfBuffer: missing html");

  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();

    // ✅ IMPORTANT: emulate screen so the output matches the UI layout
    await page.emulateMediaType("screen");

    // ✅ Use a wide viewport for landscape layouts
    const vp = opts?.viewport ?? { width: 1240, height: 1754, deviceScaleFactor: 2 };
    await page.setViewport(vp);

    await page.setContent(html, { waitUntil: "networkidle0" });

    // ✅ Two RAFs to ensure layout is fully settled
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const margin = {
      top: opts?.margin?.top ?? "12mm",
      right: opts?.margin?.right ?? "12mm",
      bottom: opts?.margin?.bottom ?? "12mm",
      left: opts?.margin?.left ?? "12mm",
    };

    const landscape = !!opts?.landscape;

    // ✅ FORCE @page size (prevents “portrait clipping” even when landscape is true)
    // Inject after content is loaded so it always applies
    await page.addStyleTag({
      content: `
        @page { size: A4 ${landscape ? "landscape" : "portrait"}; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `,
    });

    // ✅ Strongest, least ambiguous PDF sizing:
    // Use explicit dimensions for A4 portrait/landscape
    // (Avoid Puppeteer edge cases where format+landscape still clips)
    const pdf = await page.pdf({
      printBackground: true,
      // Explicit A4 size:
      width: landscape ? "297mm" : "210mm",
      height: landscape ? "210mm" : "297mm",
      margin,
      // Also keep this for compatibility (doesn't hurt):
      landscape,
    });

    return pdf as Buffer;
  } finally {
    await browser.close();
  }
}
