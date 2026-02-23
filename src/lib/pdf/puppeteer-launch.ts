import "server-only";

type PuppeteerCore = typeof import("puppeteer-core");

function isTruthy(x: any) {
  return x === true || x === "true" || x === "1" || x === 1;
}

/**
 * Production-safe browser launcher:
 * - Serverless: puppeteer-core + @sparticuz/chromium
 * - Local Windows: set PUPPETEER_EXECUTABLE_PATH (Chrome/Edge) OR set PDF_USE_FULL_PUPPETEER=true and install puppeteer
 */
export async function launchBrowser() {
  const executablePathEnv =
    process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH;

  // Optionally use full puppeteer locally (downloads Chromium automatically)
  if (isTruthy(process.env.PDF_USE_FULL_PUPPETEER)) {
    try {
      const puppeteer = (await import("puppeteer")) as any;
      return puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    } catch {
      // fall through to puppeteer-core
    }
  }

  const puppeteer = (await import("puppeteer-core")) as PuppeteerCore;

  // Local: use installed Chrome/Edge path if provided
  if (executablePathEnv) {
    return puppeteer.launch({
      headless: true,
      executablePath: executablePathEnv,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  // Serverless: Sparticuz Chromium (default export)
  const chromium = (await import("@sparticuz/chromium")).default;
  const executablePath = await chromium.executablePath();

  // FIX: Removed deprecated headless, defaultViewport from launch options
  // Use boolean true for headless instead of chromium.headless (string)
  // Set viewport via page.setViewport() after launch instead
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: chromium.args,
  });

  // Set default viewport on first page if available
  const pages = await browser.pages();

  return browser;
}