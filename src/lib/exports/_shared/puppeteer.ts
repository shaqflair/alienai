// src/lib/exports/_shared/puppeteer.ts
import "server-only";

/**
 * Canonical Puppeteer wrapper for exports (Vercel-first):
 * - Local dev: `puppeteer` (bundled chromium) if installed, else fallback to core+local path.
 * - Serverless (Vercel/AWS Lambda): `puppeteer-core` + `@sparticuz/chromium`.
 *
 * Key features:
 * - Singleton browser reuse (best-effort on serverless)
 * - Optional “UI-faithful” rendering: screen media, viewport, RAF settle, explicit @page sizing
 * - Safe timeouts, always closes pages
 */

type Browser = import("puppeteer-core").Browser;
type PDFOptions = import("puppeteer-core").PDFOptions;

function safeStr(x: any) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x);
}

function isTruthy(v: any) {
  const s = safeStr(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function isServerlessRuntime() {
  // ✅ Strong signals only. (AWS_REGION can exist outside Lambda.)
  return (
    isTruthy(process.env.VERCEL) ||
    Boolean(process.env.VERCEL_ENV) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
  );
}

// Optional: force a local Chrome path in dev
function localExecutablePath() {
  return (
    safeStr(process.env.PUPPETEER_EXECUTABLE_PATH) ||
    safeStr(process.env.CHROME_EXECUTABLE_PATH) ||
    safeStr(process.env.CHROMIUM_EXECUTABLE_PATH) ||
    ""
  );
}

// Keep a singleton across invocations (best-effort; serverless may recycle)
declare global {
  // eslint-disable-next-line no-var
  var __alienai_browser__: Browser | undefined;
  // eslint-disable-next-line no-var
  var __alienai_browser_promise__: Promise<Browser> | undefined;
}

async function createBrowser(): Promise<Browser> {
  const isServerless = isServerlessRuntime();

  if (isServerless) {
    const puppeteerCore = (await import("puppeteer-core")).default;
    const chromium = (await import("@sparticuz/chromium")).default;

    return puppeteerCore.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      timeout: 15_000,
    });
  }

  // Local dev: prefer full puppeteer if available (auto-managed chromium),
  // else fallback to puppeteer-core with an executable path.
  try {
    const puppeteer = (await import("puppeteer")).default;
    const b = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    return b as unknown as Browser;
  } catch {
    const puppeteerCore = (await import("puppeteer-core")).default;
    const chromium = (await import("@sparticuz/chromium")).default;

    const execPath = localExecutablePath() || (await chromium.executablePath().catch(() => ""));
    return puppeteerCore.launch({
      ...(execPath ? { executablePath: execPath } : {}),
      headless: "new",
      ignoreHTTPSErrors: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
      ],
      timeout: 30_000,
    });
  }
}

async function getBrowser(): Promise<Browser> {
  if (globalThis.__alienai_browser__) return globalThis.__alienai_browser__;
  if (globalThis.__alienai_browser_promise__) return globalThis.__alienai_browser_promise__;

  globalThis.__alienai_browser_promise__ = (async () => {
    const b = await createBrowser();
    globalThis.__alienai_browser__ = b;
    return b;
  })();

  return globalThis.__alienai_browser_promise__;
}

function ms(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
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
   * UI-faithful mode matches layout like the app:
   * - screen media
   * - setViewport (useful for responsive CSS)
   * - double RAF settle
   * - explicit @page sizing (prevents landscape clipping)
   */
  emulateScreen?: boolean;
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  forceA4PageSize?: boolean;

  /**
   * Puppeteer PDF options override.
   * NOTE: shared helper does NOT force landscape by default.
   */
  pdf?: PDFOptions;
};

export async function htmlToPdfBuffer(args: HtmlToPdfArgs): Promise<Buffer> {
  const {
    html,
    waitUntil = "networkidle2",
    navigationTimeoutMs = 30_000,
    renderTimeoutMs = 60_000,
    emulateScreen = true,
    viewport,
    forceA4PageSize = true,
    pdf,
  } = args;

  if (!html || typeof html !== "string") {
    throw new Error("htmlToPdfBuffer: missing html");
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  page.setDefaultNavigationTimeout(ms(navigationTimeoutMs));
  page.setDefaultTimeout(ms(renderTimeoutMs));

  try {
    if (emulateScreen) {
      await page.emulateMediaType("screen");
    }

    // Wide viewport helps landscape & responsive tables
    const vp = viewport ?? { width: 1240, height: 1754, deviceScaleFactor: 2 };
    await page.setViewport(vp);

    await page.setContent(html, { waitUntil });

    // settle layout
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // ensure fonts are ready
    await page.evaluate(async () => {
      // @ts-ignore
      if (document?.fonts?.ready) {
        // @ts-ignore
        await document.fonts.ready;
      }
    });

    const landscape = !!pdf?.landscape;

    if (forceA4PageSize) {
      await page.addStyleTag({
        content: `
          @page { size: A4 ${landscape ? "landscape" : "portrait"}; }
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        `,
      });
    }

    // Defaults (do NOT force landscape)
    const out = await page.pdf({
      printBackground: true,
      // Use explicit mm sizing to avoid Puppeteer format+landscape clipping edge cases
      ...(forceA4PageSize
        ? {
            width: landscape ? "297mm" : "210mm",
            height: landscape ? "210mm" : "297mm",
          }
        : {
            format: "A4",
          }),
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      ...pdf,
    });

    return Buffer.from(out);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeSharedBrowser(): Promise<void> {
  const b = globalThis.__alienai_browser__;
  globalThis.__alienai_browser__ = undefined;
  globalThis.__alienai_browser_promise__ = undefined;
  await b?.close().catch(() => {});
}
