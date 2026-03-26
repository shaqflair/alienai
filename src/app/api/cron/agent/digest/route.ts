import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAgent } from "@/lib/agent/orchestrator";
import { sendAgentNotification } from "@/lib/agent/notify";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 120; // Extended time for processing multiple organisations

/**
 * GET /api/cron/agent/digest
 * Automated task to generate and send portfolio briefings.
 */
export async function GET(req: NextRequest) {
  // 1. Verify cron secret (set this in your Vercel/Env vars)
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // 2. Fetch active organisations
  const { data: orgs } = await supabase
    .from("organisations")
    .select("id, name")
    .limit(200);

  if (!orgs?.length) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results: any[] = [];

  // 3. Process each organisation
  for (const org of orgs) {
    try {
      // Check for active projects to avoid sending empty digests
      const { data: projects } = await supabase
        .from("projects")
        .select("id")
        .eq("organisation_id", org.id)
        .neq("resource_status", "pipeline")
        .is("deleted_at", null)
        .limit(1);

      if (!projects?.length) continue;

      // Impersonate an admin to provide the agent with a security context
      const { data: adminMember } = await supabase
        .from("organisation_members")
        .select("user_id")
        .eq("organisation_id", org.id)
        .in("role", ["admin", "owner"])
        .is("removed_at", null)
        .limit(1)
        .maybeSingle();

      if (!adminMember?.user_id) continue;

      // 4. Trigger the Agent Loop with a specific "Digest" prompt
      const agentResult = await runAgent({
        userMessage: `Generate a concise morning portfolio digest for ${org.name}. 
          Include:
          1. Overall portfolio health and RAG summary
          2. Top 3 items requiring attention today (overdue RAID, milestones due this week, governance gaps)
          3. Any projects whose health has deteriorated
          4. One recommended action for the portfolio manager
          Be specific with numbers. Format with clear sections. Keep it under 300 words.`,
        organisationId: org.id,
        userId:          adminMember.user_id,
      });

      const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

      // 5. Deliver via Email and In-App notification
      await sendAgentNotification({
        organisationId: org.id,
        title:          `Morning Portfolio Digest — ${today}`,
        body:            agentResult.answer,
        link:            "/",
        type:            "digest",
        emailSubject:   `Aliena Morning Digest — ${today} — ${org.name}`,
        emailHtml:      buildDigestEmail(org.name, today, agentResult.answer),
      });

      results.push({ org_id: org.id, org_name: org.name, ok: true });

    } catch (err: any) {
      console.error(`[digest] Error for org ${org.id}:`, err);
      results.push({ org_id: org.id, ok: false, error: err?.message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

/**
 * buildDigestEmail
 * Converts the Agent's Markdown response into a clean, mobile-ready HTML email.
 */
function buildDigestEmail(orgName: string, date: string, content: string): string {
  const lines = content
    .split("\n")
    .map((line) => {
      if (line.startsWith("##") || line.startsWith("**")) {
        return `<h3 style="margin:20px 0 8px;font-size:15px;color:#0f172a">${line.replace(/[#*]/g, "").trim()}</h3>`;
      }
      if (line.trim().startsWith("-") || line.trim().startsWith("•")) {
        return `<li style="margin:4px 0;color:#334155;font-size:14px">${line.replace(/^[-•]\s*/, "")}</li>`;
      }
      if (line.trim()) return `<p style="margin:6px 0;color:#334155;font-size:14px;line-height:1.6">${line}</p>`;
      return "";
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#fff;border-radius:8px;overflow:hidden;
                      border:1px solid #e2e8f0;max-width:100%">
          <tr>
            <td style="background:#0A1628;padding:24px 32px">
              <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:900;
                           color:#00B8DB;letter-spacing:4px">ΛLIΞNΛ</span>
              <span style="display:block;font-size:10px;color:rgba(150,220,255,0.6);
                           letter-spacing:2px;margin-top:2px">PROJECT INTELLIGENCE PLATFORM</span>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px">
              <h2 style="margin:0 0 4px;font-size:22px;color:#0f172a">Morning Portfolio Digest</h2>
              <p style="margin:0;font-size:13px;color:#64748b">${date} · ${orgName}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px">
              ${lines}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px">
              <a href="https://aliena.co.uk"
                 style="background:#00B8DB;color:#fff;padding:10px 22px;border-radius:4px;
                        text-decoration:none;font-weight:600;font-size:14px">
                Open Aliena →
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e2e8f0;background:#f8fafc">
              <p style="margin:0;font-size:12px;color:#94a3b8">
                Sent daily at 06:00 by Aliena Intelligence ·
                <a href="https://aliena.co.uk/settings" style="color:#00B8DB">Manage notifications</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
