// src/app/api/cron/project-health/generate/route.ts
// Synthesises cross-artifact health snapshot daily
// vercel.json: { "path": "/api/cron/project-health/generate", "schedule": "0 7 * * *" }
// Run after other crons (exec-intel/raid/schedule all at 06:00, this at 07:00)
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  ArtifactHealth,
  ArtifactKey,
  ProjectHealthSnapshot,
  ProjectHealthResult,
  HealthSignal,
  computeHealthSignals,
  rollupRAG,
  ruleBasedHealthAnalysis,
} from "@/lib/project-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

const JSON_SCHEMA = {
  name: "project_health",
  strict: true,
  schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      rag: { type: "string", enum: ["green", "amber", "red", "unknown"] },
      narrative: { type: "string" },
      artifactBreakdown: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: ["financial", "raid", "schedule", "overall"] },
            label: { type: "string" },
            rag: { type: "string", enum: ["green", "amber", "red", "unknown"] },
            summary: { type: "string" },
            topConcern: { type: ["string", "null"] },
          },
          required: ["key", "label", "rag", "summary", "topConcern"],
          additionalProperties: false,
        },
      },
      crossCuttingRisks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            rationale: { type: "string" },
            urgency: { type: "string", enum: ["immediate", "this_week", "this_sprint", "monitor"] },
          },
          required: ["title", "rationale", "urgency"],
          additionalProperties: false,
        },
      },
      execActions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string" },
            owner: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            timeframe: { type: "string" },
          },
          required: ["action", "owner", "priority", "timeframe"],
          additionalProperties: false,
        },
      },
      earlyWarnings: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "rag", "narrative", "artifactBreakdown", "crossCuttingRisks", "execActions", "earlyWarnings"],
    additionalProperties: false,
  },
};

// ─── Load artifact health from Supabase intelligence tables ──────────────────

async function loadArtifactHealth(
  supabase: ReturnType<typeof getSupabase>,
  projectId: string
): Promise<ArtifactHealth[]> {
  const artifacts: ArtifactHealth[] = [];

  // Financial intelligence
  const { data: fin } = await supabase
    .from("financial_intelligence")
    .select("rag, headline, signals, fallback, generated_at")
    .eq("project_id", projectId)
    .single();

  if (fin) {
    const signals = fin.signals ? JSON.parse(fin.signals) : [];
    artifacts.push({
      key: "financial",
      label: "Financial",
      rag: fin.rag ?? "unknown",
      headline: fin.headline ?? "",
      criticalSignals: signals.filter((s: any) => s.severity === "critical").length,
      warningSignals: signals.filter((s: any) => s.severity === "warning").length,
      lastUpdated: fin.generated_at,
      fallback: fin.fallback ?? false,
    });
  } else {
    artifacts.push({ key: "financial", label: "Financial", rag: "unknown", headline: "No data", criticalSignals: 0, warningSignals: 0, lastUpdated: null, fallback: true });
  }

  // RAID intelligence
  const { data: raid } = await supabase
    .from("raid_intelligence")
    .select("rag, headline, signals, fallback, generated_at")
    .eq("project_id", projectId)
    .single();

  if (raid) {
    const signals = raid.signals ? JSON.parse(raid.signals) : [];
    artifacts.push({
      key: "raid",
      label: "RAID",
      rag: raid.rag ?? "unknown",
      headline: raid.headline ?? "",
      criticalSignals: signals.filter((s: any) => s.severity === "critical").length,
      warningSignals: signals.filter((s: any) => s.severity === "warning").length,
      lastUpdated: raid.generated_at,
      fallback: raid.fallback ?? false,
    });
  } else {
    artifacts.push({ key: "raid", label: "RAID", rag: "unknown", headline: "No data", criticalSignals: 0, warningSignals: 0, lastUpdated: null, fallback: true });
  }

  // Schedule intelligence
  const { data: sched } = await supabase
    .from("schedule_intelligence")
    .select("rag, headline, signals, fallback, generated_at")
    .eq("project_id", projectId)
    .single();

  if (sched) {
    const signals = sched.signals ? JSON.parse(sched.signals) : [];
    artifacts.push({
      key: "schedule",
      label: "Schedule",
      rag: sched.rag ?? "unknown",
      headline: sched.headline ?? "",
      criticalSignals: signals.filter((s: any) => s.severity === "critical").length,
      warningSignals: signals.filter((s: any) => s.severity === "warning").length,
      lastUpdated: sched.generated_at,
      fallback: sched.fallback ?? false,
    });
  } else {
    artifacts.push({ key: "schedule", label: "Schedule", rag: "unknown", headline: "No data", criticalSignals: 0, warningSignals: 0, lastUpdated: null, fallback: true });
  }

  return artifacts;
}

// ─── Generate health for one project ─────────────────────────────────────────

async function generateHealthForProject(
  projectId: string,
  projectName: string,
  artifacts: ArtifactHealth[],
  snapshots: ProjectHealthSnapshot[]
): Promise<{ result: ProjectHealthResult; signals: HealthSignal[]; overallRag: string; fallback: boolean }> {
  const signals = computeHealthSignals(artifacts, snapshots);
  const overallRag = rollupRAG(artifacts);
  const apiKey = process.env.OPENAI_API_KEY || process.env.WIRE_AI_API_KEY;

  if (!apiKey) {
    return { result: ruleBasedHealthAnalysis(artifacts, signals, snapshots), signals, overallRag, fallback: true };
  }

  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const prompt = `You are a senior programme director providing a daily integrated project health brief.

Project: ${projectName}
Overall RAG: ${overallRag.toUpperCase()}
Total critical signals: ${artifacts.reduce((s, a) => s + a.criticalSignals, 0)}

ARTIFACT HEALTH
${artifacts
  .filter((a) => a.key !== "overall")
  .map((a) => `${a.label}: ${a.rag.toUpperCase()} | ${a.criticalSignals} critical, ${a.warningSignals} warnings\n  ${a.headline}`)
  .join("\n\n")}

CROSS-ARTIFACT SIGNALS
${signals.length > 0 ? signals.map((s) => `[${s.severity.toUpperCase()}] ${s.label}: ${s.detail}`).join("\n") : "None"}

RECENT TREND (last 5 snapshots)
${snapshots.slice(-5).map((s) => `${s.snapshotDate}: ${s.overallRag.toUpperCase()} (${s.totalCriticalSignals} critical)`).join("\n") || "No history"}

Provide a concise executive health brief. Narrative: 2-3 sentences.`;

  try {
    const response = await (openai as any).post("https://api.openai.com/v1/responses", {
      model,
      input: prompt,
      max_output_tokens: 1000,
      response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
    });

    const result: ProjectHealthResult = JSON.parse(
      response.data?.output_text ?? response.output_text ?? "{}"
    );
    return { result, signals, overallRag, fallback: false };
  } catch (err) {
    console.error(`[project-health-cron] AI failed for ${projectId}:`, err);
    return { result: ruleBasedHealthAnalysis(artifacts, signals, snapshots), signals, overallRag, fallback: true };
  }
}

// ─── Cron handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, any> = {};
  let processed = 0;
  let failed = 0;

  try {
    const supabase = getSupabase();

    const { data: projects, error: projectErr } = await supabase
      .from("projects")
      .select("id, name")
      .eq("status", "active");

    if (projectErr) throw projectErr;
    if (!projects || projects.length === 0) {
      return NextResponse.json({ message: "No active projects", processed: 0 });
    }

    const today = new Date().toISOString().slice(0, 10);

    for (const project of projects) {
      try {
        // Load current artifact health from intelligence tables
        const artifacts = await loadArtifactHealth(supabase, project.id);

        // Load recent snapshots for trend context (last 60 days)
        const { data: snapshots } = await supabase
          .from("project_health_snapshots")
          .select("*")
          .eq("project_id", project.id)
          .gte("snapshot_date", new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10))
          .order("snapshot_date", { ascending: false });

        const snapshotData: ProjectHealthSnapshot[] = (snapshots ?? []).map((row: any) => ({
          id: row.id,
          projectId: row.project_id,
          snapshotDate: row.snapshot_date,
          overallRag: row.overall_rag,
          financialRag: row.financial_rag,
          raidRag: row.raid_rag,
          scheduleRag: row.schedule_rag,
          totalCriticalSignals: row.total_critical_signals,
          totalWarningSignals: row.total_warning_signals,
          headline: row.headline,
          generatedAt: row.generated_at,
        }));

        const { result, signals, overallRag, fallback } = await generateHealthForProject(
          project.id,
          project.name,
          artifacts,
          snapshotData
        );

        const financialRag = artifacts.find((a) => a.key === "financial")?.rag ?? "unknown";
        const raidRag = artifacts.find((a) => a.key === "raid")?.rag ?? "unknown";
        const scheduleRag = artifacts.find((a) => a.key === "schedule")?.rag ?? "unknown";
        const totalCritical = artifacts.reduce((s, a) => s + a.criticalSignals, 0);
        const totalWarning = artifacts.reduce((s, a) => s + a.warningSignals, 0);

        // Upsert today's snapshot
        const { error: snapshotErr } = await supabase.from("project_health_snapshots").upsert(
          {
            project_id: project.id,
            snapshot_date: today,
            overall_rag: overallRag,
            financial_rag: financialRag,
            raid_rag: raidRag,
            schedule_rag: scheduleRag,
            total_critical_signals: totalCritical,
            total_warning_signals: totalWarning,
            headline: result.headline,
            generated_at: new Date().toISOString(),
          },
          { onConflict: "project_id,snapshot_date" }
        );

        // Upsert latest health record
        const { error: healthErr } = await supabase.from("project_health").upsert(
          {
            project_id: project.id,
            overall_rag: overallRag,
            headline: result.headline,
            narrative: result.narrative,
            artifact_breakdown: JSON.stringify(result.artifactBreakdown),
            cross_cutting_risks: JSON.stringify(result.crossCuttingRisks),
            exec_actions: JSON.stringify(result.execActions),
            early_warnings: JSON.stringify(result.earlyWarnings),
            signals: JSON.stringify(signals),
            fallback,
            generated_at: new Date().toISOString(),
          },
          { onConflict: "project_id" }
        );

        if (snapshotErr || healthErr) {
          console.error(`[project-health-cron] DB error for ${project.id}:`, snapshotErr ?? healthErr);
          failed++;
        } else {
          results[project.id] = { overallRag, financialRag, raidRag, scheduleRag, signals: signals.length, fallback };
          processed++;
        }
      } catch (projErr) {
        console.error(`[project-health-cron] Project ${project.id} failed:`, projErr);
        failed++;
      }
    }

    return NextResponse.json({
      message: "Project health snapshots generated",
      processed,
      failed,
      results,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[project-health-cron] Fatal error:", err);
    return NextResponse.json({ error: "Cron job failed", detail: err?.message }, { status: 500 });
  }
}
