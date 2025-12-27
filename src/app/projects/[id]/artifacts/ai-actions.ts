// src/app/projects/[id]/artifacts/ai-actions.ts
"use server";

import { createClient } from "@/utils/supabase/server";

function safe(x: unknown) {
  return typeof x === "string" ? x : "";
}

/**
 * AI helper: generates suggested content for a SINGLE charter section (canonical v2).
 * - Read-only for now: returns { suggested } and does NOT mutate the artifact.
 * - Works with canonical v2: content_json = { version:2, type:"project_charter", sections:[...] }
 */
export async function aiFillCharterSection(formData: FormData) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) throw new Error("Not authenticated");

  const projectId = safe(formData.get("project_id"));
  const artifactId = safe(formData.get("artifact_id"));
  const sectionKey = safe(formData.get("section")); // e.g. "business_need"
  const context = safe(formData.get("context")); // optional

  if (!projectId || !artifactId) throw new Error("Missing project_id/artifact_id");
  if (!sectionKey) throw new Error("Missing section");

  // Membership gate
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!mem) throw new Error("Not a project member");

  // Load project + artifact basics for grounding
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("title, delivery_type, client_name, brand_primary_color, client_logo_url")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;

  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select("title, type, content_json")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (artErr) throw artErr;
  if (!artifact) throw new Error("Artifact not found");

  // Ensure canonical v2 is present (light validation)
  const cj: any = artifact.content_json;
  const isV2 = cj && typeof cj === "object" && Array.isArray(cj.sections);
  const sectionExists = isV2 && cj.sections.some((s: any) => String(s?.key ?? "").toLowerCase() === sectionKey.toLowerCase());

  if (!isV2 || !sectionExists) {
    // We can still suggest content, but we warn via meta in the response so UI can prompt user to "Reset to template".
    // (No throwing to keep UX smooth.)
  }

  const projTitle = String(project?.title ?? "").trim();
  const deliveryType = String(project?.delivery_type ?? "").trim();
  const clientName = String(project?.client_name ?? "").trim();
  const artTitle = String(artifact?.title ?? "").trim();

  // ---- PROVIDER-AGNOSTIC PLACEHOLDER ----
  // Replace this block with your AI provider call.
  // Return concise, copy-pasteable content that fits into the section editor.
  const k = sectionKey.toLowerCase();

  const suggested =
    k === "business_need"
      ? [
          "Business Need (draft):",
          `- Problem: Clearly state the pain point / opportunity for ${clientName || "the client"}.`,
          "- Why now: Regulatory / operational urgency, expiring contract, new demand, or risk exposure.",
          "- Outcomes: Measurable benefits (time saved, cost reduction, risk reduction, service improvement).",
          "- Success criteria: What ‘good’ looks like and how it will be measured.",
          "",
          `Context: ${projTitle || artTitle}${deliveryType ? ` (${deliveryType})` : ""}`,
          context ? `Notes: ${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : k === "scope_assumptions"
      ? [
          "Scope & Assumptions (draft):",
          "- In-scope: list 3–6 items (deliverables, environments, locations, systems).",
          "- Out-of-scope: explicitly state exclusions to protect delivery.",
          "- Assumptions: dependencies you rely on (access, SMEs, approvals, data, environments).",
          "- Constraints: time, budget, technology, security, change windows.",
          "",
          context ? `Notes: ${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : k === "key_milestones"
      ? [
          "Key Milestones (draft):",
          "- Milestone 1 – Discovery complete (target date)",
          "- Milestone 2 – Design sign-off (target date)",
          "- Milestone 3 – Build complete (target date)",
          "- Milestone 4 – UAT / Go-live (target date)",
          "",
          "Tip: If this section uses a table, keep one milestone per row.",
          context ? `Notes: ${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : k === "financials"
      ? [
          "Financials (draft):",
          "- Budget: £___ (or T&M estimate) and what it includes.",
          "- Commercial model: Fixed price / T&M / milestones.",
          "- Key cost drivers: licences, hardware, resourcing, 3rd parties.",
          "- Financial risks: assumptions that could change cost/revenue.",
          "",
          context ? `Notes: ${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : k === "top_risks_issues"
      ? [
          "Top Risks & Issues (draft):",
          "1) Stakeholder alignment risk — Mitigation: cadence, RACI, decision log.",
          "2) Dependency / lead time risk — Mitigation: early engagement, dates locked, escalation route.",
          "3) Scope creep risk — Mitigation: acceptance criteria, change control, MoSCoW.",
          "",
          context ? `Notes: ${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : k === "dependencies"
      ? [
          "Dependencies (draft):",
          "- Customer SMEs availability for workshops and approvals.",
          "- Access to environments / VPN / tooling / security clearance.",
          "- Third party delivery / lead times.",
          "- Change windows & CAB approvals.",
          "",
          context ? `Notes: ${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : k === "decision_ask"
      ? [
          "Decision / Ask (draft):",
          "- Approve the proposed scope and delivery approach.",
          "- Confirm budget and governance (change control, cadence).",
          "- Confirm key dates / milestones and named stakeholders.",
          "",
          context ? `Notes: ${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : k === "approval"
      ? [
          "Approval / Review Committee (draft):",
          "- Project Manager: <name>",
          "- Sponsor: <name>",
          "- Service Owner: <name> (optional)",
          "",
          "Tip: In exports, this will auto-fill from approvers/audit once we wire it.",
          context ? `Notes: ${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `Section ${sectionKey} (draft):`,
          "- Add 3–6 concise bullet points.",
          context ? `Notes: ${context}` : "",
        ]
          .filter(Boolean)
          .join("\n");

  return {
    suggested,
    meta: {
      project_title: projTitle,
      delivery_type: deliveryType,
      client_name: clientName,
      artifact_title: artTitle,
      canonical_v2_detected: !!isV2,
      section_found: !!sectionExists,
    },
  };
}
