import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DependencyNode = {
  project_id:    string;
  project_title: string;
  project_code:  string | null;
  status:        string;
  risk_score:    number;
  risk_band:     string;
  is_at_risk:    boolean;
  is_delayed:    boolean;
  delay_days:    number;
  finish_date:   string | null;
};

export type DependencyEdge = {
  id:               string;
  from_project_id:  string;
  to_project_id:    string;
  from_label:       string | null;
  to_label:         string | null;
  dependency_type:  string;
  strength:         string;
  status:           string;
  risk_propagation: boolean;
  impact_description: string | null;
  lag_days:         number;
};

export type ImpactChain = {
  trigger_project_id:  string;
  trigger_project:      string;
  affected_projects:    string[];
  chain_description:    string;
  max_delay_days:      number;
  severity:             "critical" | "high" | "medium" | "low";
};

export type DependencyGraphResult = {
  nodes:         DependencyNode[];
  edges:         DependencyEdge[];
  impact_chains: ImpactChain[];
  at_risk_count: number;
  critical_path: string[];
  generated_at:  string;
};

function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeNum(x: any): number {
  const n = Number(x); return Number.isFinite(n) ? n : 0;
}

export async function computeDependencyGraph(
  supabase: SupabaseClient,
  orgId: string,
): Promise<DependencyGraphResult> {
  const now = new Date().toISOString();

  // Fetch all active projects
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, project_code, status, start_date, finish_date")
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .not("status", "in", '("closed","archived","pipeline","proposed","pre-pipeline")')
    .neq("resource_status", "pipeline")
    .or("on_hold.is.null,on_hold.eq.false");

  const projectMap = new Map<string, any>();
  for (const p of (projects ?? [])) projectMap.set(p.id, p);

  // Fetch Pre-Mortem snapshots for risk data
  const projectIds = (projects ?? []).map((p: any) => p.id);
  const { data: snapshots } = await supabase
    .from("ai_premortem_snapshots")
    .select("project_id, failure_risk_score, failure_risk_band, direction")
    .in("project_id", projectIds)
    .order("generated_at", { ascending: false });

  const snapshotMap = new Map<string, any>();
  for (const s of (snapshots ?? [])) {
    if (!snapshotMap.has(s.project_id)) snapshotMap.set(s.project_id, s);
  }

  // Fetch overdue milestones to detect delays
  const { data: overdueMilestones } = await supabase
    .from("milestones")
    .select("project_id, title, due_date, status")
    .in("project_id", projectIds)
    .lt("due_date", new Date().toISOString().slice(0, 10))
    .not("status", "in", '("complete","done","completed")');

  const delayMap = new Map<string, number>();
  for (const m of (overdueMilestones ?? [])) {
    const daysDiff = Math.round((Date.now() - new Date(m.due_date).getTime()) / 86400000);
    const existing = delayMap.get(m.project_id) ?? 0;
    delayMap.set(m.project_id, Math.max(existing, daysDiff));
  }

  // Fetch dependencies
  const { data: deps } = await supabase
    .from("project_dependencies")
    .select("*")
    .eq("organisation_id", orgId)
    .eq("status", "active");

  // Build nodes
  const nodes: DependencyNode[] = (projects ?? []).map((p: any) => {
    const snap      = snapshotMap.get(p.id);
    const riskScore = snap ? safeNum(snap.failure_risk_score) : 0;
    const riskBand  = snap ? safeStr(snap.failure_risk_band) : "Low";
    const delayDays = delayMap.get(p.id) ?? 0;

    return {
      project_id:    p.id,
      project_title: safeStr(p.title),
      project_code:  p.project_code ?? null,
      status:        safeStr(p.status),
      risk_score:    riskScore,
      risk_band:     riskBand,
      is_at_risk:    riskScore >= 50 || delayDays > 7,
      is_delayed:    delayDays > 0,
      delay_days:    delayDays,
      finish_date:   p.finish_date ?? null,
    };
  });

  // Build edges
  const edges: DependencyEdge[] = (deps ?? []).map((d: any) => ({
    id:               d.id,
    from_project_id:  d.from_project_id,
    to_project_id:    d.to_project_id,
    from_label:       d.from_label ?? null,
    to_label:         d.to_label ?? null,
    dependency_type:  d.dependency_type ?? "finish_to_start",
    strength:         d.strength ?? "hard",
    status:           d.status ?? "active",
    risk_propagation: d.risk_propagation ?? true,
    impact_description: d.impact_description ?? null,
    lag_days:         d.lag_days ?? 0,
  }));

  // Compute impact chains
  const impact_chains: ImpactChain[] = [];
  const atRiskNodes = nodes.filter(n => n.is_at_risk || n.is_delayed);

  for (const triggerNode of atRiskNodes) {
    const visited    = new Set<string>();
    const queue      = [triggerNode.project_id];
    const affected: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const downstreamEdges = edges.filter(e =>
        e.to_project_id === current && e.risk_propagation
      );

      for (const edge of downstreamEdges) {
        if (!visited.has(edge.from_project_id)) {
          const affectedNode = nodes.find(n => n.project_id === edge.from_project_id);
          if (affectedNode) {
            affected.push(affectedNode.project_title);
            queue.push(edge.from_project_id);
          }
        }
      }
    }

    if (affected.length > 0) {
      const maxDelay  = triggerNode.delay_days + Math.max(...edges.filter(e => e.to_project_id === triggerNode.project_id).map(e => e.lag_days), 0);
      const severity  = triggerNode.risk_band === "Critical" ? "critical"
                      : triggerNode.risk_band === "High"      ? "high"
                      : triggerNode.delay_days > 14           ? "high" : "medium";

      impact_chains.push({
        trigger_project_id:  triggerNode.project_id,
        trigger_project:      triggerNode.project_title,
        affected_projects:    affected,
        chain_description:    `Delay in ${triggerNode.project_title} (${triggerNode.delay_days}d overdue, risk: ${triggerNode.risk_band}) will propagate to: ${affected.join(", ")}`,
        max_delay_days:      maxDelay,
        severity,
      });
    }
  }

  // Simple critical path computation
  const critical_path: string[] = [];
  let maxChainLength = 0;

  for (const node of nodes) {
    const chain = buildChain(node.project_id, edges, nodes, new Set());
    if (chain.length > maxChainLength) {
      maxChainLength = chain.length;
      critical_path.splice(0, critical_path.length, ...chain);
    }
  }

  return {
    nodes,
    edges,
    impact_chains: impact_chains.sort((a, b) => {
      const sv: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return (sv[b.severity] ?? 0) - (sv[a.severity] ?? 0);
    }),
    at_risk_count: nodes.filter(n => n.is_at_risk).length,
    critical_path,
    generated_at: now,
  };
}

function buildChain(
  projectId: string,
  edges: DependencyEdge[],
  nodes: DependencyNode[],
  visited: Set<string>,
  depth = 0,
): string[] {
  if (visited.has(projectId) || depth > 20) return [];
  visited.add(projectId);

  const node = nodes.find(n => n.project_id === projectId);
  if (!node) return [];

  const outgoing = edges.filter(e => e.from_project_id === projectId && e.strength === "hard");
  if (!outgoing.length) return [node.project_title];

  let longest: string[] = [];
  for (const edge of outgoing) {
    const chain = buildChain(edge.to_project_id, edges, nodes, new Set(visited), depth + 1);
    if (chain.length > longest.length) longest = chain;
  }

  return [node.project_title, ...longest];
}

export async function addDependency(
  supabase: SupabaseClient,
  orgId: string,
  data: {
    from_project_id: string;
    to_project_id:   string;
    dependency_type?: string;
    strength?:        string;
    description?:     string;
    from_label?:      string;
    to_label?:       string;
    lag_days?:        number;
    impact_description?: string;
  },
  userId: string,
) {
  const { data: dep, error } = await supabase
    .from("project_dependencies")
    .insert({
      organisation_id:    orgId,
      from_project_id:    data.from_project_id,
      to_project_id:      data.to_project_id,
      dependency_type:    data.dependency_type ?? "finish_to_start",
      strength:           data.strength ?? "hard",
      description:        data.description ?? null,
      from_label:         data.from_label ?? null,
      to_label:          data.to_label ?? null,
      lag_days:           data.lag_days ?? 0,
      impact_description: data.impact_description ?? null,
      risk_propagation:   true,
      status:             "active",
      created_by:         userId,
    })
    .select()
    .maybeSingle();

  return { dep, error };
}