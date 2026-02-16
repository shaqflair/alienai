// src/lib/puppeteer/executable.ts
import fs from "fs";
import path from "path";

function exists(p: string) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

/**
 * Auto-detect a Chromium executable on Windows/macOS/Linux.
 * Priority:
 * 1) PUPPETEER_EXECUTABLE_PATH
 * 2) Common Chrome paths
 * 3) Common Edge paths
 * 4) Puppeteer default (return undefined)
 */
export function resolveChromiumExecutablePath(): { executablePath?: string; picked?: string; tried: string[] } {
  const env = (process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (env) {
    return { executablePath: env, picked: "env:PUPPETEER_EXECUTABLE_PATH", tried: [env] };
  }

  const platform = process.platform;

  const candidates: string[] = [];

  if (platform === "win32") {
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    const pfx = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] || "";

    // Chrome
    candidates.push(
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pfx, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe")
    );

    // Edge
    candidates.push(
      path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pfx, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(local, "Microsoft", "Edge", "Application", "msedge.exe")
    );
  } else if (platform === "darwin") {
    // macOS
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(process.env.HOME || "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      path.join(process.env.HOME || "", "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
    );
  } else {
    // Linux
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable"
    );
  }

  const tried = uniq(candidates);
  const found = tried.find(exists);

  if (found) {
    const isEdge = found.toLowerCase().includes("edge") || found.toLowerCase().includes("msedge");
    return { executablePath: found, picked: isEdge ? "auto:edge" : "auto:chrome", tried };
  }

  // Let puppeteer use its own default (bundled Chromium / system)
  return { executablePath: undefined, picked: "puppeteer-default", tried };
}
