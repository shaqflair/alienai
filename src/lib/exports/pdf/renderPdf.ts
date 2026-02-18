// src/lib/exports/pdf/renderPdf.ts
import "server-only";

import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

/**
 * Renders an HTML string into a high-quality A4 PDF Buffer.
 * Automatically handles different browser runtimes for Local vs. Production.
 */
export async function renderHtmlToPdfBuffer(html: string) {
  const isProd = process.env.NODE_ENV === "production";

  // FIX: Updated launch options for newer Puppeteer/Chromium API
  // Removed chromium.defaultViewport and chromium.headless which don't exist on the type
  const browser = isProd
    ? await puppeteerCore.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
      })
    : await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();
    
    // FIX: Set viewport manually since we can't use chromium.defaultViewport
    if (isProd) {
      await page.setViewport({ width: 1280, height: 720 });
    }
    
    // networkidle2 is crucial: it waits for all images/fonts to load
    await page.setContent(html, { waitUntil: "networkidle2" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "18mm",
        right: "14mm",
        bottom: "16mm",
        left: "14mm",
      },
    });

    return Buffer.from(pdf);
  } finally {
    // Always close the browser to prevent memory leaks
    await browser.close();
  }
}