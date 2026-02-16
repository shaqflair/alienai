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

  // Use sparticuz/chromium in production to stay under serverless size limits
  const browser = isProd
    ? await puppeteerCore.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      })
    : await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();
    
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

