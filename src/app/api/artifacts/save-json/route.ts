// src/app/api/artifacts/save-json/route.ts
//
// Silent auto-save endpoint for the Financial Plan editor.
//
// Why an API route instead of a server action?
// Next.js App Router automatically triggers an RSC router refresh after
// every server action completes — even if the action calls no revalidatePath.
// That refresh re-fetches the entire shared layout tree (sidebar, heatmap,
// governance, etc.) on every keystroke, swallowing click events during the
// ~500ms debounce window. A plain fetch() to an API route is invisible to
// the router and causes zero re-renders outside the component itself.
//
// SYNC: When the artifact is a financial_plan, this route also writes
// derived totals back to the projects table so that:
//   - ProjectResourcePanel BudgetSection ("Budget days" StatPill)
//   - Project health-score Budget dimension
// both show real data without reading the artifact directly.
//
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const artifactId  = String(body?.artifactId  ?? "").trim();
    const projectId   = String(body?.projectId   ?? "").trim();
    const contentJson = body?.contentJson;

    if (!artifactId)
      return NextResponse.json({ ok: false, error: "Missing artifactId" }, { status: 400 });
    if (!projectId)
      return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    if (contentJson === undefined)
      return NextResponse.json({ ok: false, error: "Missing contentJson" }, { status: 400 });

    const supabase = await createClient();

    // Auth check
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user)
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    // Role check — owner or editor only
    const { data: roleData, error: roleErr } = await supabase.rpc(
      "get_effective_project_role",
      { p_project_id: projectId }
    );
    if (roleErr)
      return NextResponse.json({ ok: false, error: roleErr.message }, { status: 403 });
    const row  = Array.isArray(roleData) ? roleData[0] : roleData;
    const role = String(row?.effective_role ?? "").toLowerCase();
    if (role !== "owner" && role !== "editor")
      return NextResponse.json({ ok: false, error: "Insufficient role" }, { status: 403 });

    // Ownership check — artifact must belong to this project
    // NOTE: we also fetch `type` here so we can run the financial plan sync below
    const { data: artifact, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, type, approval_status, is_locked, is_current")
      .eq("id", artifactId)
      .single();

    if (artErr || !artifact)
      return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 });
    if (String(artifact.project_id) !== projectId)
      return NextResponse.json({ ok: false, error: "Project mismatch" }, { status: 403 });

    // Guard: only draft/changes_requested, unlocked, current can be auto-saved
    const status   = String(artifact.approval_status ?? "draft").toLowerCase();
    const editable =
      !artifact.is_locked &&
      (status === "draft" || status === "changes_requested") &&
      artifact.is_current;

    if (!editable) {
      // Return ok:true silently — editor should not surface an error for this
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Save — intentionally NO revalidatePath / cache tag invalidation
    const { error: saveErr } = await supabase
      .from("artifacts")
      .update({
        content_json: contentJson,
        updated_at:   new Date().toISOString(),
      })
      .eq("id", artifactId);

    if (saveErr)
      return NextResponse.json({ ok: false, error: saveErr.message }, { status: 500 });

    // ─── Financial plan sync ────────────────────────────────────────────────
    // After a successful save, derive budget_days and budget from the plan
    // content and write them back to the projects row.  This is best-effort —
    // we never fail the save response because of a sync error.
    //
    // Source fields (from FinancialPlanContent):
    //   resources[].planned_days  → sum → projects.budget_days
    //   total_approved_budget     → £   → projects.budget
    //
    const artifactType = String(artifact.type ?? "").toUpperCase();
    if (artifactType === "FINANCIAL_PLAN") {
      try {
        const plan      = contentJson as Record<string, any>;
        const resources = Array.isArray(plan?.resources) ? plan.resources : [];

        // Sum planned_days across all resource rows
        const rawDays = resources.reduce((sum: number, r: any) => {
          const d = Number(r?.planned_days);
          return sum + (Number.isFinite(d) && d > 0 ? d : 0);
        }, 0);

        // total_approved_budget is the headline £ figure
        const rawBudget = Number(plan?.total_approved_budget);

        const patch: Record<string, number> = {};
        if (rawDays > 0) patch.budget_days = Math.round(rawDays);
        if (Number.isFinite(rawBudget) && rawBudget > 0) patch.budget = rawBudget;

        if (Object.keys(patch).length > 0) {
          // Fire-and-forget — ignore errors; stale data is better than a failed save
          supabase.from("projects").update(patch).eq("id", projectId).then(
            ({ error }) => {
              if (error) {
                console.warn("[save-json] financial plan sync to projects failed:", error.message);
              }
            }
          );
        }
      } catch (syncErr) {
        // Never propagate — sync is strictly best-effort
        console.warn("[save-json] financial plan sync threw:", syncErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Save failed" }, { status: 500 });
  }
}