// src/app/wbs/page.tsx
import { redirect } from "next/navigation";

type SP = { [k: string]: string | string[] | undefined };

function firstString(v: string | string[] | undefined) {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

function isTruthyParam(v: string) {
  const x = String(v || "").trim().toLowerCase();
  return x === "1" || x === "true" || x === "yes" || x === "y";
}

export default function WbsRootPage({ searchParams }: { searchParams: SP }) {
  const sp = new URLSearchParams();

  // Preserve incoming params (single values only)
  for (const [k, v] of Object.entries(searchParams || {})) {
    const s = firstString(v);
    if (s) sp.set(k, s);
  }

  // ✅ HARD enforce WBS filter + LIST mode
  sp.set("type", "wbs");
  sp.set("view", "list");

  // Safety cleanup (legacy params)
  sp.delete("group");

  /**
   * ✅ Effort gaps deep-link support
   *
   * Allow any of:
   *  - /wbs?missingEffort=1
   *  - /wbs?needsEstimation=1
   *  - /wbs?scope=effort_gaps
   *
   * Optional:
   *  - /wbs?severity=critical   (only show critical effort gaps)
   *
   * If user is coming from an "effort gaps" tile, we force missingEffort=1.
   */
  const missingEffort = firstString(searchParams?.missingEffort);
  const needsEstimation = firstString(searchParams?.needsEstimation);
  const scope = firstString(searchParams?.scope);
  const severity = String(firstString(searchParams?.severity) || "").trim().toLowerCase();

  const wantsEffortGaps =
    isTruthyParam(missingEffort) ||
    isTruthyParam(needsEstimation) ||
    String(scope || "").trim().toLowerCase() === "effort_gaps";

  if (wantsEffortGaps) {
    sp.set("missingEffort", "1"); // canonical param used by artifacts list
    sp.delete("needsEstimation");

    // Optional severity passthrough (artifacts page can choose to honor this)
    if (severity === "critical" || severity === "warning" || severity === "ok") {
      sp.set("severity", severity);
    } else {
      sp.delete("severity");
    }

    // Optional: nudge UI sorting if the list supports it
    // (harmless if ignored)
    if (!sp.get("sort")) sp.set("sort", "health");
  } else {
    // don't accidentally keep stale params if user navigates back to /wbs
    sp.delete("missingEffort");
    sp.delete("needsEstimation");
    sp.delete("severity");
    if (sp.get("sort") === "health") sp.delete("sort");
  }

  const qs = sp.toString();
  redirect(qs ? `/artifacts?${qs}` : "/artifacts?type=wbs&view=list");
}
