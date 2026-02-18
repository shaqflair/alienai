import "server-only";
import { safeStr } from "../_shared/utils";
import { formatDateUk } from "../_shared/utils";

/* ---------------- HTML escape ---------------- */

function esc(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ---------------- Proposed Change parsing ---------------- */

type PcSection = { key: string; title: string; body: string; kind: "text" | "bullets" | "steps" };

function isLikelyBullets(s: string) {
  const t = safeStr(s);
  if (!t) return false;
  return t.split(";").filter(Boolean).length >= 3;
}

function isLikelySteps(s: string) {
  const t = safeStr(s);
  if (!t) return false;
  return /\b1\s*[\)\.\-]\s*/.test(t) && /\b2\s*[\)\.\-]\s*/.test(t);
}

function splitBullets(s: string) {
  return safeStr(s)
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitSteps(s: string) {
  const t = safeStr(s);
  if (!t) return [];
  const parts = t.split(/\b\d+\s*[\)\.\-]\s*/).map((x) => x.trim());
  return parts.filter(Boolean);
}

function parseProposedChangeToSections(input: any): PcSection[] {
  const raw = safeStr(input);
  if (!raw) return [];

  const defs: Array<{ key: string; title: string; aliases: string[] }> = [
    { key: "justification", title: "Justification", aliases: ["justification", "driver", "value"] },
    { key: "financial", title: "Financial Impact", aliases: ["financial", "cost", "finance", "budget"] },
    { key: "schedule", title: "Schedule Impact", aliases: ["schedule", "timeline"] },
    { key: "risks", title: "Risks", aliases: ["risks", "risk level", "risk"] },
    { key: "mitigations", title: "Mitigations", aliases: ["mitigations", "controls"] },
    { key: "dependencies", title: "Dependencies", aliases: ["dependencies", "dependency"] },
    { key: "assumptions", title: "Assumptions", aliases: ["assumptions", "assumption"] },
    { key: "implementation", title: "Implementation Plan", aliases: ["implementation plan", "implementation", "plan", "steps"] },
    { key: "validation", title: "Validation Evidence", aliases: ["validation evidence", "validation", "evidence"] },
    { key: "rollback", title: "Rollback Plan", aliases: ["rollback plan", "rollback", "backout", "revert"] },
    { key: "unknowns", title: "Unknowns", aliases: ["unknowns", "tbc", "to be confirmed"] },
  ];

  const aliasToDef = new Map<string, { key: string; title: string }>();
  const aliases: string[] = [];
  for (const d of defs) {
    for (const a of d.aliases) {
      const al = a.toLowerCase();
      aliasToDef.set(al, { key: d.key, title: d.title });
      aliases.push(al.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
  }

  const re = new RegExp(`\\b(${aliases.join("|")})\\s*:\\s*`, "gi");

  const matches: Array<{ alias: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    matches.push({ alias: String(m[1] || "").toLowerCase(), start: m.index, end: re.lastIndex });
  }

  if (!matches.length) {
    const body = raw.trim();
    const kind: PcSection["kind"] = isLikelySteps(body) ? "steps" : isLikelyBullets(body) ? "bullets" : "text";
    return [{ key: "summary", title: "Summary", body, kind }];
  }

  const out: PcSection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const def = aliasToDef.get(cur.alias) || { key: cur.alias, title: cur.alias };
    const chunk = raw.slice(cur.end, next ? next.start : raw.length).trim();
    if (!chunk) continue;

    const kind: PcSection["kind"] = isLikelySteps(chunk) ? "steps" : isLikelyBullets(chunk) ? "bullets" : "text";
    out.push({ key: def.key, title: def.title, body: chunk, kind });
  }

  return out;
}

/* ---------------- renderer ---------------- */

export function renderChangeRequestHtml(args: {
  cr: Record<string, any>;
  attachments: Array<{ name: string; url: string }>;
  orgName?: string | null;
  clientName?: string | null;
  logoUrl?: string | null;
  projectCode?: string | null;
  projectTitle?: string | null;
  generatedValue?: string | null;
}) {
  const { cr, attachments } = args;

  const title = safeStr(cr.title || cr.change_title || "Change Request");
  const ref = safeStr(cr.public_id || cr.human_id || cr.reference || cr.id);

  const projectTitle = safeStr(args.projectTitle || "Project");
  const projectCode = safeStr(args.projectCode || "");

  const submitted = formatDateUk(cr.submitted_at || cr.created_at);
  const neededBy = formatDateUk(cr.needed_by || cr.required_by || cr.due_date);
  const generated = safeStr(args.generatedValue || "");

  const proposedSections = parseProposedChangeToSections(cr.proposed_change || "");

  const kv = (k: string, v: any) => `
    <div class="kv">
      <div class="k">${esc(k)}</div>
      <div class="v">${esc(safeStr(v) || "—")}</div>
    </div>
  `;

  const attachmentsHtml =
    attachments?.length
      ? `<ul class="att">${attachments
          .map((a) => `<li><a href="${esc(a.url)}">${esc(a.name)}</a></li>`)
          .join("")}</ul>`
      : `<div class="muted">No attachments</div>`;

  const proposedHtml =
    proposedSections.length
      ? proposedSections
          .map((s) => {
            const head = `<div class="subhead">${esc(s.title)}</div>`;
            if (s.kind === "bullets") {
              const items = splitBullets(s.body);
              return `${head}<ul class="bul">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
            }
            if (s.kind === "steps") {
              const items = splitSteps(s.body);
              return `${head}<ol class="num">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`;
            }
            return `${head}<div class="text">${esc(s.body)}</div>`;
          })
          .join("")
      : `<div class="muted">—</div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root{
    --ink:#0b1220;
    --muted:#64748b;
    --line:#e7ecf7;
    --card:#fbfdff;
    --accent:#2563eb;
    --accent2:#7c3aed;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;color:var(--ink);background:#fff;line-height:1.5}
  .page{padding:28px 28px 22px 28px}
  .top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid var(--line)}
  .brand{display:flex;gap:14px;align-items:flex-start}
  .badge{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--accent) 0%,var(--accent2) 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900}
  .titles{display:flex;flex-direction:column;gap:4px}
  .h1{font-size:28px;font-weight:900;margin:0;letter-spacing:-0.02em}
  .sub{font-size:13px;color:var(--muted);font-weight:600}
  .gen{text-align:right}
  .gen .lbl{font-size:12px;color:var(--muted);font-weight:700}
  .gen .val{font-size:13px;font-weight:800}
  .cards{margin-top:14px;display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
  .card{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:12px 14px}
  .card .k{font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:800}
  .card .v{margin-top:4px;font-size:14px;font-weight:900}
  .code{color:var(--accent);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
  .section{margin-top:16px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}
  .sectionHead{padding:12px 14px;border-bottom:1px solid var(--line);background:var(--card)}
  .sectionHead .t{font-size:16px;font-weight:900;color:#1e293b}
  .sectionBody{padding:12px 14px;font-size:12px}
  .muted{color:var(--muted);font-weight:700}
  .kvGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .kv{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
  .kv .k{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:900}
  .kv .v{font-size:12px;font-weight:800;color:#0b1220;text-align:right;max-width:62%}
  .text{white-space:pre-wrap}
  .subhead{margin-top:10px;font-size:12px;font-weight:900;color:var(--accent)}
  ul.bul{margin:8px 0 0 0;padding-left:18px}
  ul.bul li{margin:6px 0}
  ol.num{margin:8px 0 0 0;padding-left:18px}
  ol.num li{margin:6px 0}
  ul.att{margin:0;padding-left:18px}
  ul.att li{margin:6px 0}
  a{color:var(--accent);text-decoration:none}
  @page { size: A4; margin: 10mm; }
</style>
</head>
<body>
<div class="page">

  <div class="top">
    <div class="brand">
      <div class="badge">CR</div>
      <div class="titles">
        <h1 class="h1">Change Request</h1>
        <div class="sub">${esc(projectTitle)}${projectCode ? ` <span class="code">(${esc(projectCode)})</span>` : ""} • ${esc(args.orgName || "Organisation")}${args.clientName ? ` • ${esc(args.clientName)}` : ""}</div>
      </div>
    </div>
    <div class="gen">
      <div class="lbl">Generated</div>
      <div class="val">${esc(generated || "")}</div>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="k">Reference</div><div class="v">${esc(ref)}</div></div>
    <div class="card"><div class="k">Status</div><div class="v">${esc(safeStr(cr.status || cr.approval_status || "—") || "—")}</div></div>
    <div class="card"><div class="k">Priority</div><div class="v">${esc(safeStr(cr.priority || "—") || "—")}</div></div>
    <div class="card"><div class="k">Owner</div><div class="v">${esc(safeStr(cr.owner_label || cr.owner || "—") || "—")}</div></div>
    <div class="card"><div class="k">Requester</div><div class="v">${esc(safeStr(cr.requester_name || "—") || "—")}</div></div>
  </div>

  <div class="section">
    <div class="sectionHead"><div class="t">Overview</div></div>
    <div class="sectionBody">
      <div class="kvGrid">
        ${kv("Submitted", submitted)}
        ${kv("Needed By", neededBy)}
        ${kv("Decision", safeStr(cr.decision_status || "—"))}
        ${kv("Project Code", projectCode || "—")}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="sectionHead"><div class="t">Impacts</div></div>
    <div class="sectionBody">
      <div class="kvGrid">
        ${kv("Cost Impact", safeStr(cr.cost_impact ?? cr.budget_impact ?? "—"))}
        ${kv("Schedule Impact", safeStr(cr.schedule_impact ?? cr.schedule_days ?? "—"))}
        ${kv("Risk Impact", safeStr(cr.risk_impact ?? "—"))}
        ${kv("Benefits", safeStr(cr.benefits || cr.benefit_summary || "—"))}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="sectionHead"><div class="t">Description</div></div>
    <div class="sectionBody"><div class="text">${esc(cr.description || cr.change_description || "—")}</div></div>
  </div>

  <div class="section">
    <div class="sectionHead"><div class="t">Proposed Change</div></div>
    <div class="sectionBody">${proposedHtml}</div>
  </div>

  <div class="section">
    <div class="sectionHead"><div class="t">Implementation Plan</div></div>
    <div class="sectionBody"><div class="text">${esc(cr.implementation_plan || cr.plan || "—")}</div></div>
  </div>

  <div class="section">
    <div class="sectionHead"><div class="t">Rollback Plan</div></div>
    <div class="sectionBody"><div class="text">${esc(cr.rollback_plan || cr.rollback || "—")}</div></div>
  </div>

  <div class="section">
    <div class="sectionHead"><div class="t">Assumptions & Dependencies</div></div>
    <div class="sectionBody">
      <div class="subhead">Assumptions</div>
      <div class="text">${esc(cr.assumptions || "—")}</div>
      <div class="subhead">Dependencies</div>
      <div class="text">${esc(cr.dependencies || "—")}</div>
    </div>
  </div>

  <div class="section">
    <div class="sectionHead"><div class="t">Attachments</div></div>
    <div class="sectionBody">${attachmentsHtml}</div>
  </div>

</div>
</body>
</html>`;
}

export default renderChangeRequestHtml;
