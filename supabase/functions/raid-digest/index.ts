// supabase/functions/raid-digest/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import OpenAI from "https://esm.sh/openai@4.56.0";

/* ---------------- response helpers ---------------- */

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

/* ---------------- scoring helpers ---------------- */

function clamp01to100(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function calcScore(prob: any, sev: any) {
  const p = clamp01to100(prob);
  const s = clamp01to100(sev);
  return Math.round((p * s) / 100);
}

/* ---------------- time/date helpers ---------------- */

function mondayOfThisWeekUTC(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0=Sun,1=Mon
  const diff = day === 0 ? -6 : 1 - day; // move to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function parseIsoDate(x: any): Date | null {
  const s = safeStr(x).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse DATE column (YYYY-MM-DD) as UTC midnight */
function parseDateOnlyUTC(x: any): Date | null {
  const t = safeStr(x).trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function daysBetweenUTC(a: Date, b: Date) {
  const ms = 24 * 60 * 60 * 1000;
  const a0 = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const b0 = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((b0 - a0) / ms);
}

/* ---------------- RAID status/type helpers ---------------- */

function normStatus(s: any) {
  return String(s || "").trim().toLowerCase();
}

/** For the weekly digest we include Open/In Progress/Mitigated (exclude Closed/Invalid) */
function isDigestCandidateStatus(status: any) {
  const st = normStatus(status);
  return st !== "closed" && st !== "invalid";
}

/** For alerts we exclude Mitigated as well (alerts are for active work) */
function isAlertCandidateStatus(status: any) {
  const st = normStatus(status);
  return st !== "closed" && st !== "invalid" && st !== "mitigated";
}

/* ---------------- AI schema ---------------- */

const schema = {
  name: "raid_weekly_digest",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string" },
      top_risks: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
      top_issues: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      dependencies_watch: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      next_7_days: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 7 },
    },
    required: ["headline", "top_risks", "top_issues", "dependencies_watch", "next_7_days"],
  },
} as const;

type AlertLevel = "error" | "warn" | "info";

/* ---------------- security/safety helpers ---------------- */

function scrubSecrets(msg: string) {
  // Avoid leaking keys in alert text
  return String(msg || "")
    .replace(/sk-[a-z0-9]{10,}/gi, "sk-***")
    .slice(0, 4000);
}

function dedupeKey(parts: Record<string, any>) {
  // deterministic small key
  const stable = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${String(parts[k] ?? "")}`)
    .join("|");
  return stable.slice(0, 240);
}

/* ---------------- DB helpers ---------------- */

async function insertAlert(
  supabase: any,
  payload: {
    job_name: string;
    project_id?: string | null;
    level: AlertLevel;
    message: string;
    details?: any;
  }
) {
  try {
    const { error } = await supabase.from("raid_job_alerts").insert({
      job_name: payload.job_name,
      project_id: payload.project_id ?? null,
      level: payload.level,
      message: payload.message,
      details: payload.details ?? {},
    });
    if (error) console.warn("[raid-digest alert insert]", error.message);
  } catch (e) {
    console.warn("[raid-digest alert insert]", e);
  }
}

/**
 * In-app notifications (public.notifications)
 * Columns:
 *  user_id, project_id, artifact_id, type, title, body, link, is_read, actor_user_id, metadata(jsonb)
 */
async function insertNotification(
  supabase: any,
  payload: {
    user_id: string;
    project_id: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    actor_user_id?: string | null;
    metadata?: any;
    dedupe_key?: string | null;
  }
) {
  const dk = safeStr(payload.dedupe_key).trim();
  try {
    if (dk) {
      const { data: existing, error: exErr } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", payload.user_id)
        .eq("project_id", payload.project_id)
        .eq("type", payload.type)
        .contains("metadata", { dedupe_key: dk })
        .limit(1);

      if (!exErr && existing && existing.length > 0) return { ok: true, skipped: true };
    }

    const { error } = await supabase.from("notifications").insert({
      user_id: payload.user_id,
      project_id: payload.project_id,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      link: payload.link ?? null,
      is_read: false,
      actor_user_id: payload.actor_user_id ?? null,
      metadata: { ...(payload.metadata ?? {}), ...(dk ? { dedupe_key: dk } : {}) },
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: scrubSecrets(e?.message || String(e)) };
  }
}

/* ---------------- outbound channel helpers ---------------- */

async function postSlack(webhookUrl: string, text: string) {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.warn("[raid-digest slack]", e);
  }
}

// Email (Resend) - optional
async function sendEmailResend(opts: { apiKey: string; from: string; to: string; subject: string; html: string }) {
  const { apiKey, from, to, subject, html } = opts;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Resend failed: ${r.status} ${t}`.slice(0, 800));
  }
}

/* ---------------- AUTH GUARD (cron-safe) ---------------- */

function requireJobAuth(req: Request) {
  // Option A: existing header `x-raid-token` matches RAID_DIGEST_TOKEN
  const digestToken = safeStr(Deno.env.get("RAID_DIGEST_TOKEN")).trim();
  const gotDigest = safeStr(req.headers.get("x-raid-token")).trim();

  // Option B: cron header `X-Job-Token` matches RAID_JOB_TOKEN
  const jobToken = safeStr(Deno.env.get("RAID_JOB_TOKEN")).trim();
  const gotJob = safeStr(req.headers.get("X-Job-Token")).trim();

  // If neither token is set, allow (dev mode)
  if (!digestToken && !jobToken) return { ok: true, mode: "open" as const };

  // If either matches, allow
  if (digestToken && gotDigest && gotDigest === digestToken) return { ok: true, mode: "x-raid-token" as const };
  if (jobToken && gotJob && gotJob === jobToken) return { ok: true, mode: "X-Job-Token" as const };

  return { ok: false, error: "Unauthorized" as const };
}

/* ---------------- formatting helpers for alerts ---------------- */

function shortId(id: any) {
  const s = safeStr(id).trim();
  return s ? s.slice(0, 6) : "------";
}

function cleanOneLine(s: any, max = 140) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function itemLabel(it: any) {
  const type = safeStr(it?.type).trim() || "Item";
  const title = cleanOneLine(it?.title || it?.description || "", 80);
  const due = safeStr(it?.due_date).trim();
  const score = Number.isFinite(Number(it?.score)) ? ` (score ${Number(it.score)})` : "";
  const dueTxt = due ? ` • due ${due}` : "";
  return `${type} #${shortId(it?.id)}${score}${dueTxt} — ${title}`;
}

/* ---------------- main handler ---------------- */

serve(async (req) => {
  // ✅ GET = safe config check (no secrets returned)
  if (req.method === "GET") {
    const hasKey = Boolean(safeStr(Deno.env.get("WIRE_AI_API_KEY")).trim());
    const model = safeStr(Deno.env.get("OPENAI_MODEL")).trim() || "gpt-4.1-mini";
    const temp = safeStr(Deno.env.get("OPENAI_TEMPERATURE")).trim() || "0.2";
    const hasSlack = Boolean(safeStr(Deno.env.get("SLACK_WEBHOOK_URL")).trim());
    const hasSupabase =
      Boolean(safeStr(Deno.env.get("SUPABASE_URL")).trim()) &&
      Boolean(safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")).trim());

    const hasDigestToken = Boolean(safeStr(Deno.env.get("RAID_DIGEST_TOKEN")).trim());
    const hasJobToken = Boolean(safeStr(Deno.env.get("RAID_JOB_TOKEN")).trim());

    const hasResend = Boolean(safeStr(Deno.env.get("RESEND_API_KEY")).trim());
    const emailFrom = safeStr(Deno.env.get("EMAIL_FROM")).trim();

    return json(
      { ok: true, hasKey, model, temp, hasSlack, hasSupabase, hasDigestToken, hasJobToken, hasResend, emailFrom },
      200
    );
  }

  // POST only for the digest run
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  // ✅ AUTH GUARD (cron-safe)
  const auth = requireJobAuth(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, 401);

  const SUPABASE_URL = safeStr(Deno.env.get("SUPABASE_URL")).trim();
  const SERVICE_ROLE_KEY = safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")).trim();

  const AI_KEY = safeStr(Deno.env.get("WIRE_AI_API_KEY")).trim();
  const MODEL = safeStr(Deno.env.get("OPENAI_MODEL")).trim() || "gpt-4.1-mini";
  const TEMP_RAW = Number(Deno.env.get("OPENAI_TEMPERATURE") ?? "0.2");
  const TEMP = Number.isFinite(TEMP_RAW) ? Math.max(0, Math.min(2, TEMP_RAW)) : 0.2;

  const SLACK_WEBHOOK_URL = safeStr(Deno.env.get("SLACK_WEBHOOK_URL")).trim();

  const RESEND_API_KEY = safeStr(Deno.env.get("RESEND_API_KEY")).trim();
  const EMAIL_FROM = safeStr(Deno.env.get("EMAIL_FROM")).trim();

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const projectId = safeStr(body?.projectId).trim();
  const generatedBy = safeStr(body?.generatedBy).trim() || "cron";
  const jobName = safeStr(body?.jobName).trim() || "raid-weekly-digest";

  // alert config (overrideable per call)
  const now = new Date();
  const staleDaysRaw = Number(body?.staleDays ?? "14");
  const staleDays = Number.isFinite(staleDaysRaw) ? Math.max(1, Math.floor(staleDaysRaw)) : 14;

  const highScoreThresholdRaw = Number(body?.highScoreThreshold ?? "61");
  const highScoreThreshold = Number.isFinite(highScoreThresholdRaw)
    ? Math.max(0, Math.min(100, highScoreThresholdRaw))
    : 61;

  const notifyMode = safeStr(body?.notifyMode).trim().toLowerCase() || "all"; // all | inapp | email | none
  const notifyLinkBase = safeStr(body?.linkBase).trim(); // e.g. https://yourapp.com/projects/<id>/raid

  if (!projectId) return json({ ok: false, error: "Missing projectId" }, 400);

  // Find recipients: active project members
  const { data: members, error: memErr } = await supabase
    .from("project_members")
    .select("user_id, role, removed_at")
    .eq("project_id", projectId)
    .is("removed_at", null);

  if (memErr) {
    await insertAlert(supabase, {
      job_name: jobName,
      project_id: projectId,
      level: "error",
      message: "Failed to read project_members for recipients.",
      details: { error: scrubSecrets(memErr.message), generatedBy },
    });
    return json({ ok: false, error: memErr.message }, 400);
  }

  const projectMemberUserIds: string[] = (members ?? [])
    .map((m: any) => safeStr(m.user_id).trim())
    .filter(Boolean);

  // Optionally load emails for those users (auth.users)
  let userEmailsById = new Map<string, string>();
  if (notifyMode === "email" || notifyMode === "all") {
    const { data: users, error: uErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (!uErr && users?.users?.length) {
      for (const u of users.users) {
        if (projectMemberUserIds.includes(u.id) && u.email) userEmailsById.set(u.id, u.email);
      }
    }
  }

  // 1) Load RAID items (match your table schema)
  const { data: items, error: readErr } = await supabase
    .from("raid_items")
    .select(
      "id,project_id,type,title,description,priority,probability,severity,impact,owner_id,status,response_plan,next_steps,notes,ai_rollup,related_refs,created_at,updated_at,due_date"
    )
    .eq("project_id", projectId);

  if (readErr) {
    await insertAlert(supabase, {
      job_name: jobName,
      project_id: projectId,
      level: "error",
      message: "Failed to read raid_items for digest.",
      details: { error: readErr.message, generatedBy },
    });
    if (SLACK_WEBHOOK_URL) {
      await postSlack(
        SLACK_WEBHOOK_URL,
        `❌ RAID digest failed reading raid_items (project ${projectId}): ${scrubSecrets(readErr.message)}`
      );
    }
    return json({ ok: false, error: readErr.message }, 400);
  }

  const enriched = (items ?? []).map((it: any) => ({
    ...it,
    probability: clamp01to100(it.probability),
    severity: clamp01to100(it.severity),
    score: calcScore(it.probability, it.severity),
  }));

  // Split candidates:
  // - Digest: Open/In Progress/Mitigated
  // - Alerts: Open/In Progress only
  const digestCandidates = enriched.filter((x: any) => isDigestCandidateStatus(x.status));
  const alertCandidates = enriched.filter((x: any) => isAlertCandidateStatus(x.status));

  const topForDigest = digestCandidates
    .slice()
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 50);

  const openForAi = topForDigest.slice(0, 20);

  const highRiskCount = digestCandidates.filter((x: any) => (x.score ?? 0) >= highScoreThreshold).length;

  // -----------------------
  // 1B) Generate ALERTS (due_date is DATE, treat as YYYY-MM-DD)
  // -----------------------

  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const overdue = alertCandidates.filter((x: any) => {
    const dd = parseDateOnlyUTC(x.due_date);
    if (!dd) return false;
    return dd.getTime() < todayUTC.getTime();
  });

  const stale = alertCandidates.filter((x: any) => {
    const upd = parseIsoDate(x.updated_at);
    if (!upd) return false;
    return daysBetweenUTC(upd, now) >= staleDays;
  });

  const highScore = alertCandidates.filter((x: any) => (x.score ?? 0) >= highScoreThreshold);

  // Owner-aware targeting:
  // - notify the item owner if set
  // - otherwise notify all project members
  function recipientsForItem(it: any): string[] {
    const owner = safeStr(it?.owner_id).trim();
    if (owner) return [owner];
    return projectMemberUserIds;
  }

  // Compact summary for metadata
  const alertSummary = {
    overdue: overdue.slice(0, 10).map((x: any) => ({
      id: x.id,
      type: x.type,
      score: x.score,
      due_date: x.due_date,
      owner_id: x.owner_id,
      title: safeStr(x.title),
      description: safeStr(x.description).slice(0, 140),
    })),
    stale: stale.slice(0, 10).map((x: any) => ({
      id: x.id,
      type: x.type,
      score: x.score,
      updated_at: x.updated_at,
      owner_id: x.owner_id,
      title: safeStr(x.title),
      description: safeStr(x.description).slice(0, 140),
    })),
    highScore: highScore.slice(0, 10).map((x: any) => ({
      id: x.id,
      type: x.type,
      score: x.score,
      owner_id: x.owner_id,
      title: safeStr(x.title),
      description: safeStr(x.description).slice(0, 140),
    })),
  };

  const shouldNotify = notifyMode !== "none" && overdue.length + stale.length + highScore.length > 0;

  // Build a *per-user* rollup (so owners get only what matters to them)
  const byUser: Record<string, { overdue: any[]; high: any[]; stale: any[] }> = {};

  function pushForUsers(users: string[], bucket: "overdue" | "high" | "stale", it: any) {
    for (const uid of users) {
      if (!uid) continue;
      if (!byUser[uid]) byUser[uid] = { overdue: [], high: [], stale: [] };
      byUser[uid][bucket].push(it);
    }
  }

  for (const it of overdue) pushForUsers(recipientsForItem(it), "overdue", it);
  for (const it of highScore) pushForUsers(recipientsForItem(it), "high", it);
  for (const it of stale) pushForUsers(recipientsForItem(it), "stale", it);

  const link = notifyLinkBase ? `${notifyLinkBase}` : null;

  // De-dupe daily per user
  const dayKey = todayUTC.toISOString().slice(0, 10);

  if (shouldNotify && (notifyMode === "all" || notifyMode === "inapp")) {
    const notifType = "raid_alerts";

    for (const uid of Object.keys(byUser)) {
      const u = byUser[uid];
      const title = `RAID Alerts: ${u.overdue.length} overdue • ${u.high.length} high • ${u.stale.length} stale`;

      const bodyLines: string[] = [];
      if (u.overdue.length) {
        bodyLines.push("Overdue:");
        for (const it of u.overdue.slice(0, 5)) bodyLines.push(`- ${itemLabel(it)}`);
      }
      if (u.high.length) {
        if (bodyLines.length) bodyLines.push("");
        bodyLines.push("High score:");
        for (const it of u.high.slice(0, 5)) bodyLines.push(`- ${itemLabel(it)}`);
      }
      if (u.stale.length) {
        if (bodyLines.length) bodyLines.push("");
        bodyLines.push(`Stale (no update ≥ ${staleDays}d):`);
        for (const it of u.stale.slice(0, 5)) bodyLines.push(`- ${itemLabel(it)}`);
      }

      const bodyText = bodyLines.join("\n") || "No actionable alerts.";

      const dk = dedupeKey({
        t: "raid_alerts_user",
        projectId,
        day: dayKey,
        uid,
        o: u.overdue.length,
        h: u.high.length,
        s: u.stale.length,
      });

      const res = await insertNotification(supabase, {
        user_id: uid,
        project_id: projectId,
        type: notifType,
        title,
        body: bodyText,
        link,
        actor_user_id: null,
        metadata: { job: jobName, generatedBy, summary: alertSummary, for_user: uid },
        dedupe_key: dk,
      });

      if (!res.ok) {
        await insertAlert(supabase, {
          job_name: jobName,
          project_id: projectId,
          level: "warn",
          message: "Failed to insert in-app notification.",
          details: { error: res.error, user_id: uid },
        });
      }
    }
  }

  if (shouldNotify && (notifyMode === "all" || notifyMode === "email")) {
    if (!RESEND_API_KEY || !EMAIL_FROM) {
      await insertAlert(supabase, {
        job_name: jobName,
        project_id: projectId,
        level: "warn",
        message: "Email notify requested but RESEND_API_KEY or EMAIL_FROM not set.",
        details: { hasResend: Boolean(RESEND_API_KEY), hasFrom: Boolean(EMAIL_FROM) },
      });
    } else {
      // Email per user (owner-aware)
      for (const uid of Object.keys(byUser)) {
        const to = userEmailsById.get(uid);
        if (!to) continue;

        const u = byUser[uid];
        const subject = `[RAID] RAID Alerts: ${u.overdue.length} overdue • ${u.high.length} high • ${u.stale.length} stale`;

        const section = (label: string, arr: any[], extra?: string) => {
          if (!arr.length) return "";
          const rows = arr
            .slice(0, 8)
            .map((it) => `<li>${itemLabel(it)}</li>`)
            .join("");
          return `
            <h3 style="margin:16px 0 6px 0">${label}${
              extra ? ` <span style="color:#666;font-weight:normal">(${extra})</span>` : ""
            }</h3>
            <ul style="margin:0 0 8px 18px">${rows}</ul>
          `;
        };

        const html = `
          <div style="font-family: ui-sans-serif, system-ui; line-height:1.45">
            <h2 style="margin:0 0 8px 0">RAID Alerts</h2>
            <p style="margin:0 0 10px 0">
              ${u.overdue.length} overdue • ${u.high.length} high • ${u.stale.length} stale
            </p>
            ${section("Overdue", u.overdue)}
            ${section("High score", u.high)}
            ${section("Stale", u.stale, `no update ≥ ${staleDays}d`)}
            ${link ? `<p style="margin:14px 0 0 0"><a href="${link}">Open RAID board</a></p>` : ""}
            <p style="color:#666;font-size:12px;margin:14px 0 0 0">Generated by ${generatedBy} (${jobName})</p>
          </div>
        `.trim();

        try {
          await sendEmailResend({ apiKey: RESEND_API_KEY, from: EMAIL_FROM, to, subject, html });
        } catch (e: any) {
          await insertAlert(supabase, {
            job_name: jobName,
            project_id: projectId,
            level: "warn",
            message: "Failed to send alert email.",
            details: { error: scrubSecrets(e?.message || String(e)), user_id: uid, to },
          });
        }
      }
    }
  }

  // -----------------------
  // 2) Weekly digest generation
  // -----------------------

  // Guard AI config
  if (!AI_KEY) {
    await insertAlert(supabase, {
      job_name: jobName,
      project_id: projectId,
      level: "error",
      message: "Missing WIRE_AI_API_KEY (cannot generate RAID digest).",
      details: { generatedBy },
    });
    if (SLACK_WEBHOOK_URL) {
      await postSlack(SLACK_WEBHOOK_URL, `❌ RAID digest failed: missing WIRE_AI_API_KEY (project ${projectId})`);
    }
    return json({ ok: false, error: "Missing WIRE_AI_API_KEY" }, 500);
  }

  // If nothing digest-worthy, we still store a digest (useful signal)
  if (openForAi.length === 0) {
    const weekStart = mondayOfThisWeekUTC();
    const digestEmpty = {
      headline: "No open RAID items this week.",
      top_risks: [],
      top_issues: [],
      dependencies_watch: [],
      next_7_days: [
        "Maintain cadence: confirm RAID still current.",
        "Spot-check new changes for emerging risks.",
        "Review dependencies for upcoming milestones.",
      ],
    };

    const { data: saved, error: upErr } = await supabase
      .from("raid_digests")
      .upsert(
        {
          project_id: projectId,
          week_start: weekStart,
          generated_by: generatedBy,
          generated_at: new Date().toISOString(),
          model: MODEL,
          temperature: TEMP,
          headline: digestEmpty.headline,
          digest: digestEmpty,
          open_items: 0,
          high_risk_count: 0,
        },
        { onConflict: "project_id,week_start" }
      )
      .select("*")
      .single();

    if (upErr) {
      await insertAlert(supabase, {
        job_name: jobName,
        project_id: projectId,
        level: "error",
        message: "Failed to upsert raid_digests (empty open set).",
        details: { error: scrubSecrets(upErr.message), generatedBy },
      });
      if (SLACK_WEBHOOK_URL) {
        await postSlack(
          SLACK_WEBHOOK_URL,
          `❌ RAID digest failed saving (project ${projectId}): ${scrubSecrets(upErr.message)}`
        );
      }
      return json({ ok: false, error: upErr.message }, 400);
    }

    return json({
      ok: true,
      digest: saved,
      skippedAI: true,
      alerts: { overdue: overdue.length, highScore: highScore.length, stale: stale.length },
      authMode: auth.mode,
    });
  }

  // OpenAI call
  let digest: any = null;
  try {
    const client = new OpenAI({ apiKey: AI_KEY });

    const resp = await client.responses.create({
      model: MODEL,
      temperature: TEMP,
      reasoning: { effort: "low" },
      instructions: [
        "You are a PMO governance assistant.",
        "Produce a weekly RAID digest for exec review.",
        "Be concise, action-oriented, and grounded ONLY in provided items.",
        "If information is missing, say what to clarify (do not invent).",
      ].join("\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Create a weekly RAID digest.",
                "Use the provided RAID items (top open items only).",
                "Return JSON ONLY matching the schema.",
                "",
                `Project: ${projectId}`,
                "",
                "Items JSON:",
                JSON.stringify(openForAi),
              ].join("\n"),
            },
          ],
        },
      ],
      text: { format: { type: "json_schema", json_schema: schema } },
    });

    const raw = (resp as any).output_text as string | undefined;
    if (!raw) throw new Error("No output_text from model");
    digest = JSON.parse(raw);
  } catch (e: any) {
    const em = scrubSecrets(e?.message || String(e));
    await insertAlert(supabase, {
      job_name: jobName,
      project_id: projectId,
      level: "error",
      message: "OpenAI call failed (digest not generated).",
      details: { error: em, generatedBy, model: MODEL, temperature: TEMP },
    });
    if (SLACK_WEBHOOK_URL) {
      await postSlack(SLACK_WEBHOOK_URL, `❌ RAID digest OpenAI failed (project ${projectId}): ${em}`);
    }
    return json({ ok: false, error: "OpenAI call failed" }, 502);
  }

  // Save digest
  const weekStart = mondayOfThisWeekUTC();

  const { data: saved, error: upErr } = await supabase
    .from("raid_digests")
    .upsert(
      {
        project_id: projectId,
        week_start: weekStart,
        generated_by: generatedBy,
        generated_at: new Date().toISOString(),
        model: MODEL,
        temperature: TEMP,
        headline: safeStr(digest?.headline),
        digest,
        open_items: digestCandidates.length,
        high_risk_count: highRiskCount,
      },
      { onConflict: "project_id,week_start" }
    )
    .select("*")
    .single();

  if (upErr) {
    await insertAlert(supabase, {
      job_name: jobName,
      project_id: projectId,
      level: "error",
      message: "Failed to upsert raid_digests (after AI).",
      details: { error: scrubSecrets(upErr.message), generatedBy },
    });
    if (SLACK_WEBHOOK_URL) {
      await postSlack(
        SLACK_WEBHOOK_URL,
        `❌ RAID digest failed saving (project ${projectId}): ${scrubSecrets(upErr.message)}`
      );
    }
    return json({ ok: false, error: upErr.message }, 400);
  }

  return json({
    ok: true,
    digest: saved,
    alerts: { overdue: overdue.length, highScore: highScore.length, stale: stale.length },
    authMode: auth.mode,
  });
});
