// src/lib/governance/kb.ts

export type GovernanceKbSection = {
  heading: string;
  body: string[]; // paragraphs
  bullets?: string[];
};

export type GovernanceKbArticle = {
  slug: string;
  title: string;
  summary: string;
  updatedAt: string; // ISO date (YYYY-MM-DD) for UI
  sections: GovernanceKbSection[];
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function normSlug(x: unknown) {
  const raw = safeStr(x).trim();
  if (!raw) return "";
  // tolerate encoded slugs (defensive)
  try {
    return decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

function isoDateValue(s: string) {
  // For sorting; unknown/invalid dates go to 0
  const t = Date.parse(String(s || ""));
  return Number.isFinite(t) ? t : 0;
}

export const GOVERNANCE_KB: Record<string, GovernanceKbArticle> = {
  "delivery-governance-framework": {
    slug: "delivery-governance-framework",
    title: "Aliena Delivery Governance Framework™",
    summary:
      "The operating model that makes delivery visible, controlled, auditable, and continuity-safe.",
    updatedAt: "2026-02-26",
    sections: [
      {
        heading: "What it is",
        body: [
          "The Aliena Delivery Governance Framework™ is a practical operating model for running delivery in a way that’s board-safe: decisions are controlled, changes are visible, and accountability is explicit.",
          "It exists to prevent hidden scope drift, approval bottlenecks, single points of failure, and untracked delivery risk.",
        ],
      },
      {
        heading: "The five pillars",
        body: [
          "These pillars work together; weakness in one will show up as cost, schedule, or confidence impact.",
        ],
        bullets: [
          "Structured Ownership: resilient membership and role clarity (no SPOF).",
          "Controlled Decision-Making: approvals with sequence, delegation, and audit trail.",
          "Transparent Change Control: scope/cost/schedule discipline with traceability.",
          "Continuous Risk Intelligence: RAID cadence, escalation, and mitigations.",
          "Executive Visibility & Confidence: portfolio truth in seconds, not weeks.",
        ],
      },
      {
        heading: "How to use it weekly",
        body: [
          "Use the framework as your operating checklist: keep roles current, approvals flowing, RAID fresh, and changes governed.",
          "If delivery is stressed, the framework helps you diagnose where the system is failing (not just where the symptom appears).",
        ],
      },
    ],
  },

  "roles-ownership": {
    slug: "roles-ownership",
    title: "Roles & Ownership",
    summary:
      "Assign delivery roles correctly so projects remain resilient, secure, and board-safe.",
    updatedAt: "2026-02-26",
    sections: [
      {
        heading: "Core roles in Aliena",
        body: [
          "Owners are accountable for governance configuration and continuity. Editors update delivery artifacts. Viewers have read-only access.",
          "Approvers must be valid members and must appear in the configured approval chain for the relevant artifact/change.",
        ],
        bullets: [
          "Maintain 2+ Owners (continuity best practice).",
          "Use delegation / holiday cover to avoid approval deadlocks.",
          "Keep membership current when teams change.",
        ],
      },
      {
        heading: "Continuity rules",
        body: [
          "Avoid single points of failure: if one person leaving or going on holiday can stall approvals, your governance is fragile.",
        ],
        bullets: [
          "Ensure backup approvers exist for every critical decision gate.",
          "Use group-based approvers where possible (org governance).",
          "Review owners monthly (or on major resourcing changes).",
        ],
      },
    ],
  },

  "approvals-decision-control": {
    slug: "approvals-decision-control",
    title: "Approvals & Decision Control",
    summary:
      "Sequential approval chains, delegation, SLA awareness, and a traceable decision history.",
    updatedAt: "2026-02-26",
    sections: [
      {
        heading: "Lifecycle",
        body: [
          "Approvals move through Draft → Submitted → In Review → Approved / Changes Requested / Rejected.",
          "Each decision is timestamped and attributed for auditability.",
        ],
      },
      {
        heading: "Bottleneck prevention",
        body: ["Approvals are a system: when they stall, delivery stalls."],
        bullets: [
          "Set holiday cover / delegation for absences.",
          "Use clear ordering (Reviewer → Commercial → Sponsor).",
          "Escalate when SLA breach risk appears.",
        ],
      },
    ],
  },

  "change-control": {
    slug: "change-control",
    title: "Change Control",
    summary:
      "No hidden scope drift. All cost/scope/schedule changes must be raised and approved.",
    updatedAt: "2026-02-26",
    sections: [
      {
        heading: "When to raise a change",
        body: [
          "Raise a change when there is cost, schedule, scope, risk, or commercial impact that requires an explicit decision.",
        ],
        bullets: [
          "Budget uplift, commercial exposure, or margin impact.",
          "Scope addition/removal, acceptance criteria change.",
          "Key milestones shifting or delivery approach change.",
        ],
      },
      {
        heading: "What good looks like",
        body: [
          "A change is decision-grade: clear impact, options, recommendation, and next actions.",
        ],
        bullets: [
          "Describe the driver and the options.",
          "Quantify the cost/schedule impact.",
          "Define what approval unlocks (and what happens if rejected).",
        ],
      },
    ],
  },

  "risk-raid-discipline": {
    slug: "risk-raid-discipline",
    title: "Risk & RAID Discipline",
    summary:
      "Delivery risk is never invisible. RAID is the single source of operational truth.",
    updatedAt: "2026-02-26",
    sections: [
      {
        heading: "Definitions",
        body: [
          "Risk: potential future problem. Issue: active problem. Assumptions and dependencies must be explicit to be managed.",
        ],
      },
      {
        heading: "Cadence and escalation",
        body: ["RAID should be updated weekly at minimum on active delivery."],
        bullets: [
          "Escalate high severity items for executive visibility.",
          "Link mitigations to owners and due dates.",
          "Close items with outcome and learning captured.",
        ],
      },
    ],
  },

  "ai-assistance": {
    slug: "ai-assistance",
    title: "AI Assistance",
    summary:
      "AI supports governance (drafts + signals). Humans remain accountable for decisions.",
    updatedAt: "2026-02-26",
    sections: [
      {
        heading: "How AI helps",
        body: [
          "AI can draft content, surface signals, and summarize governance state — but decisions remain human-owned and auditable.",
        ],
        bullets: [
          "Drafts: charters, reports, summaries.",
          "Signals: approval bottlenecks, stale RAID, delivery risk patterns.",
          "Recommendations: next clicks, today actions (review before executing).",
        ],
      },
    ],
  },

  "executive-oversight": {
    slug: "executive-oversight",
    title: "Executive Oversight",
    summary:
      "Boards want truth fast: portfolio health, exposure, bottlenecks, and risk signals.",
    updatedAt: "2026-02-26",
    sections: [
      {
        heading: "Executive questions this must answer",
        body: [
          "Your governance should let executives answer these in seconds, not in meetings.",
        ],
        bullets: [
          "Is delivery on track (and trending)?",
          "Where are approvals stuck and why?",
          "What is the change exposure (value, risk, decisions pending)?",
          "What are the top risks and what’s being done?",
        ],
      },
    ],
  },
};

/**
 * Build a defensive index from slug -> article.
 * This allows:
 * - record keys to change without breaking routing
 * - case-insensitive and URI-decoding matching
 */
const KB_BY_SLUG: Record<string, GovernanceKbArticle> = (() => {
  const out: Record<string, GovernanceKbArticle> = {};
  for (const k of Object.keys(GOVERNANCE_KB)) {
    const a = GOVERNANCE_KB[k];
    const keySlug = normSlug(k);
    const articleSlug = normSlug(a?.slug);
    if (a && articleSlug) out[articleSlug] = a;
    if (a && keySlug) out[keySlug] = a;
  }
  return out;
})();

export function getGovernanceArticle(slug: string): GovernanceKbArticle | null {
  const s = normSlug(slug);
  if (!s) return null;
  return KB_BY_SLUG[s] ?? null;
}

export function getGovernanceArticles(): GovernanceKbArticle[] {
  // Stable ordering for UI: newest updated first, then title
  const list = Object.values(GOVERNANCE_KB);
  return list
    .slice()
    .sort((a, b) => {
      const da = isoDateValue(a.updatedAt);
      const db = isoDateValue(b.updatedAt);
      if (db !== da) return db - da;
      return safeStr(a.title).localeCompare(safeStr(b.title));
    });
}

export function getGovernanceSlugs(): string[] {
  return getGovernanceArticles().map((a) => a.slug);
}

export function searchGovernanceArticles(query: string): GovernanceKbArticle[] {
  const q = normSlug(query); // reuse trim/lower/decoding
  if (!q) return getGovernanceArticles();

  const articles = getGovernanceArticles();
  return articles.filter((a) => {
    const blob =
      `${a.slug}\n${a.title}\n${a.summary}\n` +
      a.sections
        .map((s) => `${s.heading}\n${(s.body || []).join("\n")}\n${(s.bullets || []).join("\n")}`)
        .join("\n");
    return blob.toLowerCase().includes(q);
  });
}

export function getGovernancePrevNext(slug: string): {
  prev: GovernanceKbArticle | null;
  next: GovernanceKbArticle | null;
} {
  const s = normSlug(slug);
  const list = getGovernanceArticles();
  const idx = list.findIndex((a) => normSlug(a.slug) === s);

  if (idx < 0) return { prev: null, next: null };

  return {
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx < list.length - 1 ? list[idx + 1] : null,
  };
}