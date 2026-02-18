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
  return (
    isTruthy(process.env.VERCEL) ||
    Boolean(process.env.VERCEL_ENV) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
  );
}

function localExecutablePath() {
  return (
    safeStr(process.env.PUPPETEER_EXECUTABLE_PATH) ||
    safeStr(process.env.CHROME_EXECUTABLE_PATH) ||
    safeStr(process.env.CHROMIUM_EXECUTABLE_PATH) ||
    ""
  );
}

declare global {
  // eslint-disable-next-line no-var
  var __alienai_browser__: Browser | undefined;
  // eslint-disable-next-line no-var
  var __alienai_browser_promise__: Promise<Browser> | undefined;
}

async function createBrowser(): Promise<Browser> {
  const isServerless = isServerlessRuntime();

  if (isServerless) {
    const puppeteerCore = await import("puppeteer-core");
    // ✅ FIX: cast to any to avoid TS errors on headless/defaultViewport on some versions
    const chromium = (await import("@sparticuz/chromium")).default as any;

    const launchOpts: any = {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless, // boolean | "shell" depending on version
      timeout: 15_000,
      ignoreHTTPSErrors: true, // typings vary; runtime supports it
    };

    return (await puppeteerCore.launch(launchOpts)) as unknown as Browser;
  }

  // Local dev: prefer full puppeteer if available, else fallback to puppeteer-core
  try {
    const puppeteer = await import("puppeteer");
    const b = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    return b as unknown as Browser;
  } catch {
    const puppeteerCore = await import("puppeteer-core");
    // ✅ FIX: cast to any
    const chromium = (await import("@sparticuz/chromium")).default as any;

    const execPath =
      localExecutablePath() || (await chromium.executablePath().catch(() => ""));

    const launchOpts: any = {
      ...(execPath ? { executablePath: execPath } : {}),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
      ],
      timeout: 30_000,
      ignoreHTTPSErrors: true,
    };

    return (await puppeteerCore.launch(launchOpts)) as unknown as Browser;
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
  waitUntil?: "domcontentloaded" | "networkidle0" | "networkidle2";
  navigationTimeoutMs?: number;
  renderTimeoutMs?: number;
  emulateScreen?: boolean;
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  forceA4PageSize?: boolean;
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

    const vp = viewport ?? { width: 1240, height: 1754, deviceScaleFactor: 2 };
    await page.setViewport(vp);

    await page.setContent(html, { waitUntil });

    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r))
        )
    );

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

    const out = await page.pdf({
      printBackground: true,
      ...(forceA4PageSize
        ? {
            width: landscape ? "297mm" : "210mm",
            height: landscape ? "210mm" : "297mm",
          }
        : { format: "A4" }),
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
