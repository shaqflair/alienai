// src/app/projects/[id]/change/[crId]/page.tsx
import "server-only";

import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeDetailClient from "@/components/change/ChangeDetailClient";
import ChangeActions from "@/components/change/ChangeActions";
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";

import { createClient } from "@/utils/supabase/server";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

/** allow only in-app relative paths */
function safeReturnTo(raw: unknown): string {
  const s = safeStr(raw).trim();
  if (!s) return "";
  if (!s.startsWith("/")) return "";
  if (s.startsWith("//")) return "";
  if (!s.startsWith("/projects/")) return "";
  return s;
}

function parseProposedChange(proposed: string) {
  const txt = safeStr(proposed || "");
  const out: Record<string, string> = {
    justification: "",
    financial: "",
    schedule: "",
    risks: "",
    dependencies: "",
  };

  const lines = txt.split(/\r?\n/);
  let cur: keyof typeof out | null = null;

  function takeKey(line: string): keyof typeof out | null {
    const s = line.trim();
    const map: Record<string, keyof typeof out> = {
      justification: "justification",
      financial: "financial",
      schedule: "schedule",
      risks: "risks",
      dependencies: "dependencies",
    };

    for (const k of Object.keys(map)) {
      const prefix = `${k[0].toUpperCase()}${k.slice(1)}:`;
      if (s.toLowerCase().startsWith(prefix.toLowerCase())) return map[k];
    }
    return null;
  }

  for (const raw of lines) {
    const line = raw ?? "";
    const key = takeKey(line);
    if (key) {
      cur = key;
      out[cur] = line.replace(/^([A-Za-z_ ]+):\s*/i, "");
      continue;
    }
    if (!cur) continue;

    if (out[cur]) out[cur] += "\n" + line;
    else out[cur] = line;
  }

  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] = out[k].trim();
  return out;
}

function normalizeLane(x: unknown) {
  const v = safeStr(x).trim().toLowerCase();
  const lanes = new Set(["new", "analysis", "review", "in_progress", "implemented", "closed"]);
  return lanes.has(v) ? v : "new";
}

function looksLikePublicId(x: string) {
  const t = x.trim();
  return /^cr-\d+$/i.test(t) || /^cr\d+$/i.test(t);
}

function toClientChange(row: any) {
  const impact = row?.impact_analysis ?? {};
  const proposed = safeStr(row?.proposed_change);
  const parts = parseProposedChange(proposed);

  return {
    id: safeStr(row?.id) || "",
    dbId: safeStr(row?.id) || "",
    publicId: safeStr(row?.public_id) || "",

    projectId: safeStr(row?.project_id) || "",
    artifactId: safeStr(row?.artifact_id) || "",

    title: safeStr(row?.title) || "",
    requester:
      safeStr(row?.requester_name).trim() ||
      safeStr(row?.profiles?.full_name).trim() ||
      safeStr(row?.profiles?.name).trim() ||
      "",

    summary: safeStr(row?.description) || "",
    status: normalizeLane(row?.delivery_status ?? row?.deliveryStatus ?? row?.status) as any,
    priority: safeStr(row?.priority || "Medium") as any,
    tags: Array.isArray(row?.tags) ? row.tags : [],

    aiImpact: {
      days: Number(impact?.days ?? 0) || 0,
      cost: Number(impact?.cost ?? 0) || 0,
      risk: safeStr(impact?.risk) || "None identified",
    },

    // ✅ IMPORTANT: pass full impact_analysis through
    impact_analysis: impact,

    justification: parts.justification || "",
    financial: parts.financial || "",
    schedule: parts.schedule || "",
    risks: parts.risks || "",
    dependencies: parts.dependencies || "",
  };
}

type Panel = "" | "attach" | "comment" | "timeline";
function safePanel(x: unknown): Panel {
  const p = safeStr(x).trim().toLowerCase();
  if (p === "attach") return "attach";
  if (p === "comment") return "comment";
  if (p === "timeline") return "timeline";
  return "";
}

type ParamsShape = { id?: string; crId?: string };

export default async function ChangeDetailPage({
  params,
  searchParams,
}: {
  // ✅ Support both Promise + non-Promise (matches your other routes)
  params: ParamsShape | Promise<ParamsShape>;
  // ✅ Next.js 16 can pass searchParams as a Promise (async dynamic APIs)
  searchParams?: Record<string, string | string[] | undefined> | Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = (typeof (params as any)?.then === "function" ? await (params as any) : params) as ParamsShape;
  const sp =
    typeof (searchParams as any)?.then === "function" ? await (searchParams as any) : (searchParams ?? {});

  const projectId = safeStr(p?.id).trim();
  const changeParam = safeStr(p?.crId).trim();

  const returnTo = safeReturnTo(Array.isArray((sp as any)?.returnTo) ? (sp as any).returnTo[0] : (sp as any)?.returnTo);
  const initialPanel = safePanel(Array.isArray((sp as any)?.panel) ? (sp as any).panel[0] : (sp as any)?.panel);

  const supabase = await createClient();

  // ✅ Lookup by ID or by public_id (CR-123)
  let query = supabase
    .from("change_requests")
    .select(
      `
      id,
      project_id,
      artifact_id,
      title,
      description,
      proposed_change,
      impact_analysis,
      status,
      delivery_status,
      priority,
      tags,
      requester_id,
      requester_name,
      approver_id,
      approval_date,
      created_at,
      updated_at,
      public_id,
      profiles:requester_id(full_name,name)
    `
    )
    .eq("project_id", projectId);

  if (looksLikePublicId(changeParam)) {
    const m = changeParam.match(/cr[-_\s]*(\d+)/i);
    const normalized = m?.[1] ? `cr-${m[1]}` : changeParam.toLowerCase();
    query = query.eq("public_id", normalized);
  } else {
    query = query.eq("id", changeParam);
  }

  const { data, error } = await query.maybeSingle();

  const change = !error && data ? (toClientChange(data) as any) : undefined;

  const pageTitle = change?.publicId
    ? `${change.publicId}${change?.title ? ` • ${change.title}` : ""}`
    : change?.title
    ? `Change Request • ${change.title}`
    : "Change Request";

  const subtitle = change?.title ? "Review details, impacts, and approvals" : "Open a change request";

  // ✅ Always go back to Change board (unless returnTo provided)
  const backHref = returnTo || (projectId ? `/projects/${projectId}/change` : "/projects");

  const artifactId = safeStr(change?.artifactId || (data as any)?.artifact_id || "").trim() || undefined;

  // ✅ IMPORTANT: changeId for client/actions should be DB id (even if route used public_id)
  const resolvedChangeId = safeStr(change?.dbId || (data as any)?.id || changeParam).trim();

  return (
    <main className="crPage">
      <ChangeHeader
        title={pageTitle}
        subtitle={subtitle}
        backHref={backHref}
        rightSlot={
          change ? (
            <div className="crHeaderActionsSlot">
              <ChangeActions
                projectId={projectId}
                changeId={resolvedChangeId}
                status={safeStr(change?.status)}
                impact={change?.impact_analysis}
              />
            </div>
          ) : null
        }
      />

      <ChangeDetailClient
        projectId={projectId}
        artifactId={artifactId}
        changeId={resolvedChangeId}
        change={change}
        returnTo={returnTo || undefined}
        initialPanel={initialPanel}
      />
    </main>
  );
}
