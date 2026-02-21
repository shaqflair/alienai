// src/lib/exports/_shared/puppeteer.ts
import "server-only";

/**
 * Production-safe Puppeteer wrapper:
 * - Local dev: uses `puppeteer`
 * - Serverless (Vercel/AWS Lambda): uses `puppeteer-core` + `@sparticuz/chromium`
 *
 * Key features:
 * - Singleton browser reuse (reduces cold-start pain)
 * - Sensible defaults for PDF rendering
 * - Safe timeouts + always closes pages
 */

type Browser = import("puppeteer-core").Browser;
type PDFOptions = import("puppeteer-core").PDFOptions;

const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// Keep a singleton across invocations (best-effort; serverless may still recycle)
declare global {
  // eslint-disable-next-line no-var
  var __alienai_browser__: Browser | undefined;
  // eslint-disable-next-line no-var
  var __alienai_browser_promise__: Promise<Browser> | undefined;
}

async function getBrowser(): Promise<Browser> {
  if (globalThis.__alienai_browser__) return globalThis.__alienai_browser__;
  if (globalThis.__alienai_browser_promise__) return globalThis.__alienai_browser_promise__;

  globalThis.__alienai_browser_promise__ = (async () => {
    if (!IS_SERVERLESS) {
      const puppeteer = (await import("puppeteer")).default;
      const b = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      globalThis.__alienai_browser__ = b as unknown as Browser;
      return globalThis.__alienai_browser__;
    }

    const puppeteerCore = (await import("puppeteer-core")).default;
    const chromium = (await import("@sparticuz/chromium")).default;

    // `executablePath()` resolves the bundled chromium path in serverless.
    const execPath = await chromium.executablePath();

    const b = await puppeteerCore.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: execPath,
      headless: chromium.headless,
    });

    globalThis.__alienai_browser__ = b;
    return b;
  })();

  return globalThis.__alienai_browser_promise__;
}

function ms(n: number) {
  return Math.max(0, Math.floor(n));
}

export type HtmlToPdfArgs = {
  html: string;

  /**
   * If your HTML references remote images/fonts, `networkidle2` is useful.
   * If everything is inline, `domcontentloaded` is usually enough.
   */
  waitUntil?: "domcontentloaded" | "networkidle0" | "networkidle2";

  /**
   * Hard caps to avoid stuck renders.
   */
  navigationTimeoutMs?: number;
  renderTimeoutMs?: number;

  /**
   * Puppeteer PDF options override
   */
  pdf?: PDFOptions;
};

export async function htmlToPdfBuffer(args: HtmlToPdfArgs): Promise<Buffer> {
  const {
    html,
    waitUntil = "networkidle2",
    navigationTimeoutMs = 30_000,
    renderTimeoutMs = 60_000,
    pdf,
  } = args;

  const browser = await getBrowser();
  const page = await browser.newPage();

  // Conservative defaults to prevent hanging
  page.setDefaultNavigationTimeout(ms(navigationTimeoutMs));
  page.setDefaultTimeout(ms(renderTimeoutMs));

  try {
    await page.setContent(html, { waitUntil });

    // Optional: if you want to ensure fonts are ready (helps with serverless)
    // @ts-ignore
    if (page.evaluate) {
      await page.evaluate(async () => {
        // @ts-ignore
        if (document?.fonts?.ready) {
          // @ts-ignore
          await document.fonts.ready;
        }
      });
    }

    const out = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      ...pdf,
    });

    return Buffer.from(out);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Optional: call this in a shutdown hook if you ever run in long-lived Node.
 * In serverless it’s usually fine to leave it open to enable reuse.
 */
export async function closeSharedBrowser(): Promise<void> {
  const b = globalThis.__alienai_browser__;
  globalThis.__alienai_browser__ = undefined;
  globalThis.__alienai_browser_promise__ = undefined;
  await b?.close().catch(() => {});
}
