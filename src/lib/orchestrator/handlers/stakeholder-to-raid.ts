// src/lib/orchestrator/handlers/stakeholder-to-raid.ts
import type { ArtifactEventLike } from "../types";

function asArray(x: any): any[] {
  return Array.isArray(x) ? x : [];
}

function normalizeName(s: any) {
  return String(s ?? "").trim();
}

// Very simple heuristic MVP (you can improve later)
function deriveStakeholderRiskSignals(row: any) {
  const influence = String(row?.influence ?? "").toLowerCase();
  const interest = String(row?.interest ?? "").toLowerCase();
  const support = String(row?.support_level ?? row?.support ?? "").toLowerCase();
  const notes = String(row?.notes ?? row?.comments ?? "").toLowerCase();

  const isHighInfluence = ["high", "h", "3"].includes(influence);
  const isHighInterest = ["high", "h", "3"].includes(interest);
  const isLowSupport = ["low", "l", "1", "opposed", "blocker"].some((k) => support.includes(k));

  const sentimentFlag =
    notes.includes("unreliable") ||
    notes.includes("blocking") ||
    notes.includes("delay") ||
    notes.includes("risk") ||
    notes.includes("not responsive");

  return {
    isHighInfluence,
    isHighInterest,
    isLowSupport,
    sentimentFlag,
  };
}

export function stakeholderEventToRaidSuggestions(evt: ArtifactEventLike) {
  // Expect evt.payload to include stakeholder register JSON (or at least rows)
  const rows = asArray(evt?.payload?.rows ?? evt?.payload?.stakeholders ?? evt?.payload?.content_json?.rows);

  const suggestions: any[] = [];

  for (const r of rows) {
    const name = normalizeName(r?.name ?? r?.stakeholder_name ?? r?.stakeholder);
    if (!name) continue;

    const sig = deriveStakeholderRiskSignals(r);

    // ✅ Dependency suggestion (high influence stakeholder usually implies dependency)
    if (sig.isHighInfluence) {
      suggestions.push({
        project_id: evt.project_id,
        source_event_id: evt.id,
        target_artifact_type: "raid_log",
        suggestion_type: "add_dependency",
        confidence: 0.72,
        rationale: `Stakeholder "${name}" has high influence. Track engagement as a dependency to protect delivery.`,
        patch: {
          op: "append_row",
          table: "dependencies",
          value: {
            title: `Engage ${name}`,
            owner: r?.owner ?? null,
            status: "open",
            due_date: r?.next_touchpoint_date ?? null,
            notes: "Auto-suggested from Stakeholder Register (high influence).",
            source: { artifact_type: "stakeholder_register", stakeholder: name },
          },
        },
      });
    }

    // ✅ Risk suggestion (low support or negative signals)
    if (sig.isLowSupport || sig.sentimentFlag) {
      suggestions.push({
        project_id: evt.project_id,
        source_event_id: evt.id,
        target_artifact_type: "raid_log",
        suggestion_type: "add_risk",
        confidence: sig.isLowSupport ? 0.78 : 0.64,
        rationale: `Stakeholder "${name}" shows risk signals (${sig.isLowSupport ? "low support" : "negative notes"}). Consider adding a RAID risk.`,
        patch: {
          op: "append_row",
          table: "risks",
          value: {
            title: `${name} may block delivery`,
            probability: "medium",
            impact: sig.isHighInfluence ? "high" : "medium",
            owner: r?.owner ?? null,
            status: "open",
            mitigation: "Increase engagement cadence; align on outcomes; escalate via sponsor if required.",
            source: { artifact_type: "stakeholder_register", stakeholder: name },
          },
        },
      });
    }
  }

  return suggestions;
}
