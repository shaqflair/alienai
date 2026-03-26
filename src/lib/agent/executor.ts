// src/lib/agent/executor.ts
// Runs each tool call against Supabase and existing Aliena API routes.
// Returns a structured result the agent can reason over.

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { ToolName } from "./tools";

export type ToolResult =
  | { ok: true;  data: any }
  | { ok: false; error: string };

export type DraftAction = {
  type: "create_raid";
  payload: Record<string, any>;
  preview: string;
};

// Accumulates any write-actions that need user confirmation
export const pendingDrafts: DraftAction[] = [];

export async function executeTool(
  name: ToolName,
  args: Record<string, any>,
  organisationId: string,
  userId: string,
): Promise<ToolResult> {
  const supabase = createServiceClient();

  try {
    switch (name) {

      // ── get_portfolio_health ─────────────────────────────────────────────
      case "get_portfolio_health": {
        const { data: projects } = await supabase
          .from("projects")
          .select("id, title, project_code, status, resource_status, budget_amount, budget_days")
          .eq("organisation_id", organisationId)
          .neq("resource_status", "pipeline")
          .is("deleted_at", null)
          .limit(100);

        const { data: raids } = await supabase
          .from("raid_items")
          .select("id, project_id, type, priority, status, due_date")
          .in("project_id", (projects ?? []).map((p: any) => p.id))
          .not("status", "in", '("closed","resolved","done")')
          .limit(500);

        const { data: milestones } = await supabase
          .from("schedule_milestones")
          .select("id, project_id, title, end_date, status")
          .in("project_id", (projects ?? []).map((p: any) => p.id))
          .lt("end_date", new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))
          .not("status", "in", '("completed","done","closed")')
          .limit(500);

        return {
          ok: true,
          data: {
            project_count: (projects ?? []).length,
            projects: projects ?? [],
            open_raid_count: (raids ?? []).length,
            high_severity_raid: (raids ?? []).filter(
              (r: any) => String(r.priority ?? "").toLowerCase() === "high"
            ).length,
            milestones_due_30d: (milestones ?? []).length,
          },
        };
      }

      // ── get_project_detail ───────────────────────────────────────────────
      case "get_project_detail": {
        let projectId = args.project_id;

        // Resolve by name/code if no UUID given
        if (!projectId && args.project_name) {
          const { data: found } = await supabase
            .from("projects")
            .select("id, title, project_code")
            .eq("organisation_id", organisationId)
            .or(
              `title.ilike.%${args.project_name}%,project_code::text.ilike.%${args.project_name}%`
            )
            .limit(1)
            .maybeSingle();
          projectId = found?.id;
          if (!projectId) return { ok: false, error: `Project not found: ${args.project_name}` };
        }

        if (!projectId) return { ok: false, error: "project_id or project_name is required" };

        const [projectRes, raidRes, milestonesRes, gatesRes, spendRes] = await Promise.all([
          supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
          supabase.from("raid_items").select("*").eq("project_id", projectId)
            .not("status", "in", '("closed","resolved","done")').limit(50),
          supabase.from("schedule_milestones").select("*").eq("project_id", projectId)
            .not("status", "in", '("completed","done","closed")').limit(50),
          supabase.from("project_gates").select("*").eq("project_id", projectId).limit(10),
          supabase.from("project_spend").select("amount").eq("project_id", projectId)
            .is("deleted_at", null).limit(10000),
        ]);

        const totalSpend = (spendRes.data ?? []).reduce(
          (s: number, r: any) => s + Number(r.amount ?? 0), 0
        );

        return {
          ok: true,
          data: {
            project: projectRes.data,
            open_raid: raidRes.data ?? [],
            upcoming_milestones: milestonesRes.data ?? [],
            gates: gatesRes.data ?? [],
            total_spend: totalSpend,
          },
        };
      }

      // ── list_raid_items ──────────────────────────────────────────────────
      case "list_raid_items": {
        const { data: projects } = await supabase
          .from("projects")
          .select("id")
          .eq("organisation_id", organisationId)
          .neq("resource_status", "pipeline")
          .is("deleted_at", null)
          .limit(200);

        const projectIds = args.project_id
          ? [args.project_id]
          : (projects ?? []).map((p: any) => p.id);

        let query = supabase
          .from("raid_items")
          .select("id, project_id, type, title, description, priority, status, due_date, owner_label")
          .in("project_id", projectIds)
          .not("status", "in", '("closed","resolved","done","completed")')
          .limit(args.limit ?? 20);

        if (args.type) query = query.eq("type", args.type);
        if (args.severity || args.priority) query = query.eq("priority", args.severity ?? args.priority);
        if (args.overdue_only) query = query.lt("due_date", new Date().toISOString().slice(0, 10));

        const { data, error } = await query;
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { items: data ?? [], count: (data ?? []).length } };
      }

      // ── list_milestones_due ──────────────────────────────────────────────
      case "list_milestones_due": {
        const { data: projects } = await supabase
          .from("projects")
          .select("id")
          .eq("organisation_id", organisationId)
          .neq("resource_status", "pipeline")
          .is("deleted_at", null)
          .limit(200);

        const projectIds = args.project_id
          ? [args.project_id]
          : (projects ?? []).map((p: any) => p.id);

        const days = args.days ?? 14;
        const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);

        let query = supabase
          .from("schedule_milestones")
          .select("id, project_id, title, end_date, status, critical_path_flag")
          .in("project_id", projectIds)
          .not("status", "in", '("completed","done","closed")')
          .lte("end_date", cutoff)
          .order("end_date", { ascending: true })
          .limit(50);

        if (args.overdue_only) query = query.lt("end_date", today);

        const { data, error } = await query;
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { milestones: data ?? [], count: (data ?? []).length, days } };
      }

      // ── get_budget_summary ───────────────────────────────────────────────
      case "get_budget_summary": {
        const { data: projects } = await supabase
          .from("projects")
          .select("id, title, project_code, budget_amount, budget_days")
          .eq("organisation_id", organisationId)
          .neq("resource_status", "pipeline")
          .is("deleted_at", null)
          .limit(200);

        const projectIds = args.project_id
          ? [args.project_id]
          : (projects ?? []).map((p: any) => p.id);

        // Primary spend: project_spend table rows
        const { data: spend } = await supabase
          .from("project_spend")
          .select("project_id, amount")
          .in("project_id", projectIds)
          .is("deleted_at", null)
          .limit(100000);

        // Fallback spend: cost_lines[].actual from FINANCIAL_PLAN artifact
        const { data: finPlans } = await supabase
          .from("artifacts")
          .select("project_id, content_json")
          .in("project_id", projectIds)
          .eq("type", "FINANCIAL_PLAN")
          .eq("is_current", true)
          .limit(500);

        const spendByProject = new Map<string, number>();
        for (const row of spend ?? []) {
          const pid = String(row.project_id);
          spendByProject.set(pid, (spendByProject.get(pid) ?? 0) + Number(row.amount ?? 0));
        }

        // Build cost_lines fallback map
        const artSpendByProject = new Map<string, number>();
        for (const art of finPlans ?? []) {
          const pid = String(art.project_id);
          const lines = Array.isArray(art.content_json?.cost_lines) ? art.content_json.cost_lines : [];
          const lineTotal = lines.reduce((sum: number, line: any) => {
            const actual = Number(line?.actual ?? 0);
            return sum + (Number.isFinite(actual) && actual > 0 ? actual : 0);
          }, 0);
          if (lineTotal > 0) artSpendByProject.set(pid, (artSpendByProject.get(pid) ?? 0) + lineTotal);
        }

        const summary = (projects ?? [])
          .filter((p: any) => !args.project_id || p.id === args.project_id)
          .map((p: any) => {
            const dbSpend  = spendByProject.get(p.id) ?? 0;
            const artSpend = artSpendByProject.get(p.id) ?? 0;
            const spent    = dbSpend > 0 ? dbSpend : artSpend;
            const budget   = Number(p.budget_amount ?? 0);
            const pct      = budget > 0 ? Math.round((spent / budget) * 100) : null;
            return {
              id: p.id, title: p.title, code: p.project_code,
              budget, spent, variance_pct: pct,
              spend_source: dbSpend > 0 ? "project_spend" : artSpend > 0 ? "financial_plan_cost_lines" : "none",
            };
          });

        const totalBudget = summary.reduce((s: number, p: any) => s + p.budget, 0);
        const totalSpent  = summary.reduce((s: number, p: any) => s + p.spent, 0);
        const variancePct = totalBudget > 0
          ? Math.round(((totalSpent - totalBudget) / totalBudget) * 100)
          : null;

        // ── Quarterly breakdown from financial plan monthly data ──────────
        // Current quarter: determine Q start/end months
        const now           = new Date();
        const currentMonth  = now.getMonth(); // 0-indexed
        const qStart        = Math.floor(currentMonth / 3) * 3;
        const quarterMonths = [qStart, qStart + 1, qStart + 2].map((m) => {
          const d = new Date(now.getFullYear(), m, 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        });
        const prevQuarterMonths = [qStart - 3, qStart - 2, qStart - 1].map((m) => {
          const d = new Date(now.getFullYear(), m, 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        });
        const nextQuarterMonths = [qStart + 3, qStart + 4, qStart + 5].map((m) => {
          const d = new Date(now.getFullYear(), m, 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        });

        // Aggregate monthly breakdown across all financial plans in scope
        const monthlyAgg: Record<string, { budget: number; forecast: number; actual: number }> = {};

        for (const art of finPlans ?? []) {
          const breakdown = art.content_json?.monthly_data ?? art.content_json?.monthlyBreakdown ?? {};
          for (const [monthKey, vals] of Object.entries(breakdown as Record<string, any>)) {
            if (!monthlyAgg[monthKey]) monthlyAgg[monthKey] = { budget: 0, forecast: 0, actual: 0 };
            monthlyAgg[monthKey].budget   += Number(vals?.budget   ?? 0);
            monthlyAgg[monthKey].forecast += Number(vals?.forecast ?? 0);
            monthlyAgg[monthKey].actual   += Number(vals?.actual   ?? 0);
          }
        }

        // Current quarter summary
        const currentQuarter = quarterMonths.map((m) => ({
          month:    m,
          budget:   Math.round(monthlyAgg[m]?.budget   ?? 0),
          forecast: Math.round(monthlyAgg[m]?.forecast ?? 0),
          actual:   Math.round(monthlyAgg[m]?.actual   ?? 0),
        }));

        const qTotalBudget   = currentQuarter.reduce((s, r) => s + r.budget,   0);
        const qTotalForecast = currentQuarter.reduce((s, r) => s + r.forecast, 0);
        const qTotalActual   = currentQuarter.reduce((s, r) => s + r.actual,   0);
        const qVariance      = qTotalForecast - qTotalBudget;

        // Items moved OUT of this quarter (prev quarter months now have forecast > 0)
        const movedOut = prevQuarterMonths
          .filter((m) => (monthlyAgg[m]?.forecast ?? 0) > (monthlyAgg[m]?.budget ?? 0))
          .map((m) => ({
            month:    m,
            slippage: Math.round((monthlyAgg[m]?.forecast ?? 0) - (monthlyAgg[m]?.budget ?? 0)),
          }));

        // Items moved INTO this quarter from next quarter (next quarter budget > 0 but forecast pulled earlier)
        const pulledIn = nextQuarterMonths
          .filter((m) => (monthlyAgg[m]?.budget ?? 0) > 0 && (monthlyAgg[m]?.forecast ?? 0) === 0)
          .map((m) => ({
            month:  m,
            amount: Math.round(monthlyAgg[m]?.budget ?? 0),
          }));

        return {
          ok: true,
          data: {
            projects:     summary,
            total_budget: totalBudget,
            total_spent:  totalSpent,
            variance_pct: variancePct,
            quarterly: {
              quarter_label:    `Q${Math.floor(qStart / 3) + 1} ${now.getFullYear()}`,
              months:           currentQuarter,
              total_budget:     qTotalBudget,
              total_forecast:   qTotalForecast,
              total_actual:     qTotalActual,
              forecast_variance: qVariance,
              forecast_vs_budget_pct: qTotalBudget > 0
                ? Math.round((qTotalForecast / qTotalBudget) * 100)
                : null,
              moved_out_of_quarter: movedOut,
              pulled_into_quarter:  pulledIn,
            },
          },
        };
      }

      // ── get_governance_status ────────────────────────────────────────────
      case "get_governance_status": {
        const { data: projects } = await supabase
          .from("projects")
          .select("id, title, project_code, finish_date")
          .eq("organisation_id", organisationId)
          .neq("resource_status", "pipeline")
          .is("deleted_at", null)
          .limit(200);

        const projectIds = args.project_id
          ? [args.project_id]
          : (projects ?? []).map((p: any) => p.id);

        const [gatesRes, artifactsRes] = await Promise.all([
          supabase.from("project_gates").select("project_id, gate_number, status, passed_at")
            .in("project_id", projectIds).limit(1000),
          supabase.from("artifacts")
            .select("project_id, type, artifact_type, status, is_current")
            .in("project_id", projectIds)
            .eq("is_current", true)
            .in("type", ["PROJECT_CHARTER", "CHARTER", "FINANCIAL_PLAN", "STAKEHOLDER_REGISTER"])
            .limit(1000),
        ]);

        const gates = gatesRes.data ?? [];
        const artifacts = artifactsRes.data ?? [];

        const byProject = projectIds.map((pid: string) => {
          const proj = (projects ?? []).find((p: any) => p.id === pid);
          const projGates = gates.filter((g: any) => g.project_id === pid);
          const projArtifacts = artifacts.filter((a: any) => a.project_id === pid);

          const gateStatus = args.gate_number
            ? projGates.filter((g: any) => g.gate_number === args.gate_number)
            : projGates;

          const approvedStatuses = new Set(["approved", "active", "current", "published", "signed_off"]);
          const charterApproved = projArtifacts.some(
            (a: any) => ["PROJECT_CHARTER", "CHARTER"].includes(a.type ?? a.artifact_type) &&
              approvedStatuses.has(String(a.status ?? "").toLowerCase().replace(/\s/g, "_"))
          );
          const budgetApproved = projArtifacts.some(
            (a: any) => a.type === "FINANCIAL_PLAN" &&
              approvedStatuses.has(String(a.status ?? "").toLowerCase().replace(/\s/g, "_"))
          );
          const stakeholderPresent = projArtifacts.some(
            (a: any) => a.type === "STAKEHOLDER_REGISTER"
          );

          return {
            project_id: pid,
            title: proj?.title,
            code: proj?.project_code,
            finish_date: proj?.finish_date,
            gates: gateStatus,
            charter_approved: charterApproved,
            budget_approved: budgetApproved,
            stakeholder_present: stakeholderPresent,
          };
        });

        return { ok: true, data: { projects: byProject } };
      }

      // ── get_quarterly_forecast ──────────────────────────────────────────
      case "get_quarterly_forecast": {
        // Determine quarter to analyse
        const now = new Date();
        let quarterStr = String(args.quarter ?? "").trim();
        let qYear: number;
        let qNum: number; // 1-4

        if (quarterStr) {
          // Parse e.g. "Q2 2026"
          const m = quarterStr.match(/Q(\d)\s*(\d{4})/i);
          qNum  = m ? Number(m[1]) : Math.ceil((now.getMonth() + 1) / 3);
          qYear = m ? Number(m[2]) : now.getFullYear();
        } else {
          qNum  = Math.ceil((now.getMonth() + 1) / 3);
          qYear = now.getFullYear();
        }

        // Quarter month range (YYYY-MM strings)
        const qStartMonth = (qNum - 1) * 3 + 1; // 1, 4, 7, 10
        const qMonths: string[] = [];
        for (let i = 0; i < 3; i++) {
          const m = qStartMonth + i;
          qMonths.push(`${qYear}-${String(m).padStart(2, "0")}`);
        }

        // Previous quarter months for comparison
        const prevQNum  = qNum === 1 ? 4 : qNum - 1;
        const prevQYear = qNum === 1 ? qYear - 1 : qYear;
        const prevQStartMonth = (prevQNum - 1) * 3 + 1;
        const prevQMonths: string[] = [];
        for (let i = 0; i < 3; i++) {
          const m = prevQStartMonth + i;
          prevQMonths.push(`${prevQYear}-${String(m).padStart(2, "0")}`);
        }

        // Fetch active projects
        const { data: projects } = await supabase
          .from("projects")
          .select("id, title, project_code, budget_amount")
          .eq("organisation_id", organisationId)
          .neq("resource_status", "pipeline")
          .is("deleted_at", null)
          .limit(200);

        const projectIds = args.project_id
          ? [args.project_id]
          : (projects ?? []).map((p: any) => p.id);

        // Fetch financial plan artifacts with monthly breakdown
        const { data: finPlans } = await supabase
          .from("artifacts")
          .select("project_id, content_json, updated_at")
          .in("project_id", projectIds)
          .eq("type", "FINANCIAL_PLAN")
          .eq("is_current", true)
          .limit(200);

        type MonthRow = { budget: number; forecast: number; actual: number };
        type ProjSummary = {
          project_id:   string;
          title:        string;
          code:         string | null;
          q_budget:     number;
          q_forecast:   number;
          q_actual:     number;
          prev_forecast: number;
          forecast_movement: number; // positive = added, negative = moved out
          months:       Record<string, MonthRow>;
          prev_months:  Record<string, MonthRow>;
          last_updated: string | null;
        };

        const projMap = new Map((projects ?? []).map((p: any) => [p.id, p]));
        const results: ProjSummary[] = [];

        for (const plan of finPlans ?? []) {
          const pid    = String(plan.project_id);
          const proj   = projMap.get(pid);
          const mb     = plan.content_json?.monthlyBreakdown ?? plan.content_json?.monthly_breakdown ?? {};

          // Current quarter
          let qBudget = 0, qForecast = 0, qActual = 0;
          const months: Record<string, MonthRow> = {};
          for (const mo of qMonths) {
            const row = mb[mo] ?? { budget: 0, forecast: 0, actual: 0 };
            const b = Number(row.budget ?? 0);
            const f = Number(row.forecast ?? 0);
            const a = Number(row.actual ?? 0);
            qBudget   += b;
            qForecast += f;
            qActual   += a;
            months[mo] = { budget: b, forecast: f, actual: a };
          }

          // Previous quarter forecast (for movement calc)
          let prevForecast = 0;
          const prevMonths: Record<string, MonthRow> = {};
          for (const mo of prevQMonths) {
            const row = mb[mo] ?? { budget: 0, forecast: 0, actual: 0 };
            const b = Number(row.budget ?? 0);
            const f = Number(row.forecast ?? 0);
            const a = Number(row.actual ?? 0);
            prevForecast += f;
            prevMonths[mo] = { budget: b, forecast: f, actual: a };
          }

          results.push({
            project_id:        pid,
            title:             proj?.title ?? "Unknown",
            code:              proj?.project_code ?? null,
            q_budget:          Math.round(qBudget),
            q_forecast:        Math.round(qForecast),
            q_actual:          Math.round(qActual),
            prev_forecast:     Math.round(prevForecast),
            forecast_movement: Math.round(qForecast - qBudget), // vs original budget
            months,
            prev_months:       prevMonths,
            last_updated:      plan.updated_at ?? null,
          });
        }

        // Portfolio totals
        const totalQBudget   = results.reduce((s, r) => s + r.q_budget, 0);
        const totalQForecast = results.reduce((s, r) => s + r.q_forecast, 0);
        const totalQActual   = results.reduce((s, r) => s + r.q_actual, 0);
        const totalMovement  = results.reduce((s, r) => s + r.forecast_movement, 0);

        // Items moved out (forecast < budget by >10%)
        const movedOut = results.filter(
          (r) => r.q_budget > 0 && r.q_forecast < r.q_budget * 0.9
        );
        // New spend added (forecast > budget)
        const addedIn = results.filter(
          (r) => r.q_forecast > r.q_budget * 1.05
        );

        return {
          ok: true,
          data: {
            quarter:          `Q${qNum} ${qYear}`,
            quarter_months:   qMonths,
            prev_quarter:     `Q${prevQNum} ${prevQYear}`,
            total_q_budget:   totalQBudget,
            total_q_forecast: totalQForecast,
            total_q_actual:   totalQActual,
            total_movement:   totalMovement,
            forecast_vs_budget_pct: totalQBudget > 0
              ? Math.round(((totalQForecast - totalQBudget) / totalQBudget) * 100)
              : null,
            actual_burn_pct: totalQForecast > 0
              ? Math.round((totalQActual / totalQForecast) * 100)
              : null,
            moved_out_projects:  movedOut.map((r) => ({
              title: r.title, code: r.code,
              budget: r.q_budget, forecast: r.q_forecast,
              movement: r.q_forecast - r.q_budget,
            })),
            added_in_projects: addedIn.map((r) => ({
              title: r.title, code: r.code,
              budget: r.q_budget, forecast: r.q_forecast,
              movement: r.q_forecast - r.q_budget,
            })),
            projects: results.map((r) => ({
              title: r.title, code: r.code,
              q_budget: r.q_budget, q_forecast: r.q_forecast, q_actual: r.q_actual,
              movement: r.forecast_movement,
              months: r.months,
            })),
          },
        };
      }

      // ── create_raid_draft ────────────────────────────────────────────────
      case "create_raid_draft": {
        // Does NOT write to DB. Returns a draft for user confirmation.
        const draft: DraftAction = {
          type: "create_raid",
          payload: {
            project_id:   args.project_id,
            type:         args.type,
            title:        args.title,
            description:  args.description ?? "",
            priority:     args.priority,
            owner_label:  args.owner_label ?? null,
            due_date:     args.due_date ?? null,
            status:       "Open",
          },
          preview:
            `${args.type} · ${args.priority} priority · "${args.title}"` +
            (args.owner_label ? ` · Owner: ${args.owner_label}` : "") +
            (args.due_date ? ` · Due: ${args.due_date}` : ""),
        };

        pendingDrafts.push(draft);

        return {
          ok: true,
          data: {
            draft_created: true,
            preview: draft.preview,
            message:
              "Draft RAID item created. I'll show it to the user for confirmation before saving.",
          },
        };
      }

      // ── send_notification ────────────────────────────────────────────────
      case "send_notification": {
        // Resolve recipients
        let recipientIds: string[] = [];

        if (args.recipient_user_id) {
          recipientIds = [args.recipient_user_id];
        } else {
          // Notify all org admins
          const { data: members } = await supabase
            .from("organisation_members")
            .select("user_id, role")
            .eq("organisation_id", organisationId)
            .in("role", ["admin", "owner"])
            .is("removed_at", null)
            .limit(50);
          recipientIds = (members ?? []).map((m: any) => m.user_id);
        }

        // Write in-app notifications
        const notifications = recipientIds.map((uid) => ({
          user_id:       uid,
          type:          args.type ?? "info",
          title:         args.title,
          body:          args.body ?? null,
          link:          args.link ?? null,
          is_read:       false,
          metadata:      { source: "agent", organisation_id: organisationId },
        }));

        const { error: notifErr } = await supabase
          .from("notifications")
          .insert(notifications);

        if (notifErr) return { ok: false, error: notifErr.message };

        return {
          ok: true,
          data: { notified_count: recipientIds.length, channels: ["in_app"] },
        };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Tool execution failed" };
  }
}