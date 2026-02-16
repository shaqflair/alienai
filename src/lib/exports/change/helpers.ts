import "server-only";

export function safeStr(x: any) {
  if (typeof x === "string") return x.trim();
  if (x == null) return "";
  return String(x).trim();
}

/**
 * Parse a long "Proposed Change" narrative into named sections.
 * Supports patterns like:
 * "Justification: ..."
 * "Financial: ..."
 * "Schedule: ..."
 * "Risks: ..."
 */
export function parseProposedChange(text: any) {
  const raw = safeStr(text);
  const out: { key: string; title: string; body: string; kind: "text" | "bullets" | "steps" }[] = [];

  if (!raw) return out;

  const headings: Array<{ key: string; title: string; aliases: string[] }> = [
    { key: "justification", title: "Justification", aliases: ["justification", "driver", "value"] },
    { key: "financial", title: "Financial Impact", aliases: ["financial", "cost", "finance", "budget"] },
    { key: "schedule", title: "Schedule Impact", aliases: ["schedule", "timeline", "dates"] },
    { key: "risks", title: "Risks", aliases: ["risks", "risk level", "risk"] },
    { key: "mitigations", title: "Mitigations", aliases: ["mitigations", "controls"] },
    { key: "dependencies", title: "Dependencies", aliases: ["dependencies", "dependency"] },
    { key: "assumptions", title: "Assumptions", aliases: ["assumptions", "assumption"] },
    { key: "implementation", title: "Implementation Plan", aliases: ["implementation", "implementation plan", "plan", "steps"] },
    { key: "validation", title: "Validation Evidence", aliases: ["validation", "evidence", "validation evidence"] },
    { key: "rollback", title: "Rollback Plan", aliases: ["rollback", "backout", "revert"] },
    { key: "unknowns", title: "Unknowns", aliases: ["unknowns", "tbc", "to be confirmed"] },
  ];

  const findHeading = (line: string) => {
    const lower = safeStr(line).toLowerCase();
    for (const h of headings) {
      for (const a of h.aliases) {
        const p = a.toLowerCase();
        if (lower.startsWith(p + ":") || lower.startsWith(p + " :")) return h;
      }
    }
    return null;
  };

  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let current: { key: string; title: string; buf: string[] } | null = null;

  function flush() {
    if (!current) return;
    const body = current.buf.join(" ").trim();
    if (!body) return;

    const kind: "text" | "bullets" | "steps" =
      looksNumberedSteps(body) ? "steps" : looksBullets(body) ? "bullets" : "text";

    out.push({ key: current.key, title: current.title, body, kind });
  }

  for (const line of lines) {
    const hit = findHeading(line);
    if (hit) {
      flush();
      current = { key: hit.key, title: hit.title, buf: [] };

      // strip the "Heading:" prefix
      const after = line.replace(/^([^:]+):/i, "").trim();
      if (after) current.buf.push(after);
      continue;
    }

    if (!current) {
      current = { key: "summary", title: "Summary", buf: [] };
    }
    current.buf.push(line);
  }

  flush();

  return out;
}

export function looksBullets(s: string) {
  // crude: semicolon-separated or comma-separated lists often become bullets in CRs
  const txt = safeStr(s);
  if (!txt) return false;
  const semi = txt.split(";").filter(Boolean).length;
  if (semi >= 3) return true;
  return false;
}

export function looksNumberedSteps(s: string) {
  const txt = safeStr(s);
  if (!txt) return false;
  // matches "1) ..." or "1. ..." or "1 - ..."
  return /\b1\s*[\)\.\-]\s*/.test(txt) && /\b2\s*[\)\.\-]\s*/.test(txt);
}

export function splitToBullets(s: string) {
  const txt = safeStr(s);
  if (!txt) return [];
  return txt
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function splitToSteps(s: string) {
  const txt = safeStr(s);
  if (!txt) return [];
  // split on "1)" / "2)" / "3)" etc
  const parts = txt.split(/\b\d+\s*[\)\.\-]\s*/).map((x) => x.trim());
  return parts.filter(Boolean);
}
