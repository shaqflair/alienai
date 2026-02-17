// src/app/api/raid/digest/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

function fmtDateOnly(x: any) {
  // prefer yyyy-mm-dd for UI consistency
  if (!x) return null;
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(x);
  }
}

function clamp01to100(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function calcScore(prob: any, sev: any) {
  const p = clamp01to100(prob);
  const s = clamp01to100(sev);
  if (p == null || s == null) return null;
  return Math.round((p * s) / 100);
}

function normType(x: any) {
  const v = String(x || "").trim().toLowerCase();
  if (v === "risk") return "risk";
  if (v === "issue") return "issue";
  if (v === "dependency") return "dependency";
  if (v === "assumption") return "assumption";
  return "other";
}

function pickTitle(row: any) {
  const t = safeStr(row?.title).trim();
  if (t) return t;
  const d = safeStr(row?.description).trim();
  if (d) return d.length > 80 ? d.slice(0, 77) + "…" : d;
  return "Untitled";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = safeStr(url.searchParams.get("projectId")).trim();
  if (!projectId) return jsonErr("Missing projectId", 400);
  if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);

  const supabase = await createClient();

  // ✅ fetch a real project display header (falls back safely)
  const { data: projectRow } = await supabase
    .from("projects")
    .select("id,title,project_code,client_name")
    .eq("id", projectId)
    .maybeSingle();

  // ✅ fetch RAID items (INCLUDES public_id so UI can show human id)
  const { data, error } = await supabase
    .from("raid_items")
    .select("id,public_id,type,title,description,priority,probability,severity,status,updated_at,due_date,owner_label,owner_id")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (error) return jsonErr(error.message, 400);

  const rows = (data ?? []).map((r: any) => {
    const probability = clamp01to100(r?.probability);
    const severity = clamp01to100(r?.severity);

    return {
      id: safeStr(r?.id),
      public_id: safeStr(r?.public_id) || null, // ✅ human id for UI
      type: normType(r?.type),
      title: pickTitle(r),
      description: safeStr(r?.description) || null,

      owner_label: safeStr(r?.owner_label) || null,
      owner_id: safeStr(r?.owner_id) || null,

      status: safeStr(r?.status) || null,
      priority: safeStr(r?.priority) || null,

      due_date: fmtDateOnly(r?.due_date),
      updated_at: r?.updated_at ?? null,

      probability,
      severity,
      score: calcScore(probability, severity),
    };
  });

  // helpers to slice + sort “top” items
  const byScoreDesc = (a: any, b: any) => (b?.score ?? -1) - (a?.score ?? -1);
  const byDueAsc = (a: any, b: any) => String(a?.due_date || "").localeCompare(String(b?.due_date || ""));

  const risks = rows.filter((x) => x.type === "risk").sort(byScoreDesc);
  const issues = rows.filter((x) => x.type === "issue").sort(byScoreDesc);
  const deps = rows.filter((x) => x.type === "dependency").sort(byScoreDesc);

  // next 7 days: due_date within 7 days (UTC-ish; good enough for digest)
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const next7 = rows
    .filter((x) => x.due_date)
    .filter((x) => {
      const d = new Date(String(x.due_date) + "T00:00:00Z");
      return !Number.isNaN(d.getTime()) && d >= now && d <= in7;
    })
    .sort(byDueAsc);

  const digest = {
    generated_at: new Date().toISOString(),

    header: {
      title: "Weekly RAID Digest",
      digest_date: fmtDateOnly(new Date().toISOString()),
      project_id: projectId,
      project_code: projectRow?.project_code ?? null,
      project_name: projectRow?.title ?? null,
      client_name: projectRow?.client_name ?? null,
      total_items: rows.length,
    },

    sections: [
      { key: "top_risks", title: "Top risks", count: risks.slice(0, 5).length, items: risks.slice(0, 5) },
      { key: "top_issues", title: "Top issues", count: issues.slice(0, 5).length, items: issues.slice(0, 5) },
      { key: "dependencies_watch", title: "Dependencies to watch", count: deps.slice(0, 5).length, items: deps.slice(0, 5) },
      { key: "next_7_days", title: "Next 7 days", count: next7.slice(0, 10).length, items: next7.slice(0, 10) },
    ],
  };

  return jsonOk({ digest });
}
