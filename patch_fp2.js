const fs = require('fs');
let src = fs.readFileSync('src/components/artifacts/FinancialPlanEditor.tsx', 'utf8');
const ok = [], miss = [];

function patch(label, old, neu) {
  if (src.includes(old)) { src = src.replace(old, neu); ok.push(label); }
  else miss.push(label);
}

// 2 - URL-aware activeTab (CRLF version, scroll effect already inserted)
patch('2 URL-aware activeTab',
  'ab, setActiveTab] = useState<FinancialPlanTab>("overview");\r\n  const [signals, setSignals]     = useState<Signal[]>([]);',
  'ab, setActiveTab] = useState<FinancialPlanTab>(\r\n    () => (urlTab && validTabs.includes(urlTab)) ? urlTab : "overview"\r\n  );\r\n  const [highlightedCrId, setHighlightedCrId] = useState<string | null>(urlCrId);\r\n  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);\r\n  const [signals, setSignals]     = useState<Signal[]>([]);');

// Also insert the searchParams lines before the activeTab line
patch('2b searchParams setup',
  '  const [activeTab, setActiveTab] = useState<FinancialPlanTab>(\r\n    () => (urlTab && validTabs.includes(urlTab)) ? urlTab : "overview"',
  '  const searchParams = useSearchParams();\r\n  const urlTab  = searchParams?.get("tab")  as FinancialPlanTab | null;\r\n  const urlCrId = searchParams?.get("crId") ?? null;\r\n  const validTabs: FinancialPlanTab[] = ["overview","budget","resources","monthly","changes","narrative","billing"];\r\n  const [activeTab, setActiveTab] = useState<FinancialPlanTab>(\r\n    () => (urlTab && validTabs.includes(urlTab)) ? urlTab : "overview"');

// 5 - Apply to budget button (CRLF version)
patch('5 Apply to budget',
  '<option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option>\r\n                        </select>\r\n                        {c.status === "appr',
  '<option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option>\r\n                        </select>\r\n                        {c.status === "approved" && c.cost_impact !== "" && Number(c.cost_impact) !== 0 && !readOnly && (\r\n                          <button\r\n                            type="button"\r\n                            title="Apply this approved CR cost impact to the Approved Budget"\r\n                            onClick={() => {\r\n                              const current = Number(content.total_approved_budget) || 0;\r\n                              const impact  = Number(c.cost_impact) || 0;\r\n                              updateField("total_approved_budget", current + impact);\r\n                              updateCE(c.id, { notes: (c.notes ? c.notes + " | " : "") + "Applied to budget: " + sym + Math.abs(impact).toLocaleString("en-GB") + " on " + new Date().toLocaleDateString("en-GB") });\r\n                            }}\r\n                            style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, cursor: "pointer", background: P.greenLt, border: "1px solid #A0D0B8", color: P.green }}\r\n                          >\r\n                            \u2713 Apply to budget\r\n                          </button>\r\n                        )}\r\n                        {c.status === "appr');

// 6 - unapplied CR banner — find the changes tab grid specifically
// The changes tab grid uses repeat(3, 1fr) — find it via the label text
const changesGridIdx = src.indexOf('{ label: "Approved Exposure", value: fmt(approvedExposure, sym), color: P.navy }');
if (changesGridIdx >= 0) {
  // Find the opening <div style= before it
  const searchBack = src.lastIndexOf('<div style={{ display: "grid"', changesGridIdx);
  if (searchBack >= 0 && changesGridIdx - searchBack < 200) {
    const divLine = src.slice(searchBack, changesGridIdx + 80);
    console.log('Found changes grid at index', searchBack);
    console.log(JSON.stringify(divLine.slice(0, 120)));
    
    // Build the exact old string from what we found
    const oldGrid = src.slice(searchBack, changesGridIdx + '{ label: "Approved Exposure", value: fmt(approvedExposure, sym), color: P.navy },'.length);
    const newGrid = '          {(() => {\r\n            const unapplied = content.change_exposure.filter(c => c.status === "approved" && Number(c.cost_impact) !== 0 && !String(c.notes || "").includes("Applied to budget"));\r\n            if (!unapplied.length) return null;\r\n            const total = unapplied.reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);\r\n            return (\r\n              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", background: P.greenLt, border: "1px solid #A0D0B8", marginBottom: 8, borderRadius: 4 }}>\r\n                <Check style={{ width: 13, height: 13, color: P.green, flexShrink: 0, marginTop: 1 }} />\r\n                <div style={{ fontFamily: P.mono, fontSize: 11, color: P.green }}>\r\n                  <strong>{unapplied.length} approved CR{unapplied.length !== 1 ? "s" : ""}</strong> ready \u2014 click <strong>\u2713 Apply to budget</strong>. Total: <strong>{sym}{Math.abs(total).toLocaleString()}</strong>\r\n                </div>\r\n              </div>\r\n            );\r\n          })()}\r\n' + oldGrid;
    src = src.replace(oldGrid, newGrid);
    ok.push('6 unapplied CR banner');
  } else {
    miss.push('6 unapplied CR banner - could not find opening div');
  }
} else {
  miss.push('6 unapplied CR banner - Approved Exposure label not found in changes tab');
}

fs.writeFileSync('src/components/artifacts/FinancialPlanEditor.tsx', src, 'utf8');
console.log('OK:', ok);
console.log('MISS:', miss);
