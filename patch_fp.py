import re

src = open('src/components/artifacts/FinancialPlanEditor.tsx', encoding='utf-8').read()
ok = []
miss = []

def patch(label, old, new):
    global src
    if old in src:
        src = src.replace(old, new, 1)
        ok.append(label)
    else:
        miss.append(label)

patch('1 useSearchParams import',
    'import { useState, useCallback, useEffect, useMemo, useTransition, useRef } from "react";',
    'import { useState, useCallback, useEffect, useMemo, useTransition, useRef } from "react";\nimport { useSearchParams } from "next/navigation";')

patch('2 URL-aware activeTab',
    '  const [activeTab, setActiveTab] = useState<FinancialPlanTab>("overview");\n  const [signals, setSignals]     = useState<Signal[]>([]);',
    '  const searchParams = useSearchParams();\n  const urlTab  = searchParams?.get("tab")  as FinancialPlanTab | null;\n  const urlCrId = searchParams?.get("crId") ?? null;\n  const validTabs: FinancialPlanTab[] = ["overview","budget","resources","monthly","changes","narrative","billing"];\n  const [activeTab, setActiveTab] = useState<FinancialPlanTab>(\n    () => (urlTab && validTabs.includes(urlTab)) ? urlTab : "overview"\n  );\n  const [highlightedCrId, setHighlightedCrId] = useState<string | null>(urlCrId);\n  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);\n  const [signals, setSignals]     = useState<Signal[]>([]);')

patch('3 scroll effect',
    '  const [heatmapPeopleCount, setHeatmapPeopleCount] = useState<number | null>(null);',
    '  useEffect(() => {\n    if (!highlightedCrId || activeTab !== "changes") return;\n    const t = setTimeout(() => {\n      highlightedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });\n    }, 400);\n    return () => clearTimeout(t);\n  }, [highlightedCrId, activeTab]);\n\n  const [heatmapPeopleCount, setHeatmapPeopleCount] = useState<number | null>(null);')

patch('4 highlight CR row',
    '                  <tr key={c.id} style={{ background: rowBg }}>',
    '                  <tr\n                    key={c.id}\n                    ref={\n                      (c.id === highlightedCrId || c.change_ref === highlightedCrId)\n                        ? (el: HTMLTableRowElement | null) => { highlightedRowRef.current = el; }\n                        : undefined\n                    }\n                    onClick={() => setHighlightedCrId(null)}\n                    style={{\n                      background: (c.id === highlightedCrId || c.change_ref === highlightedCrId) ? "#f0fdf4" : rowBg,\n                      outline: (c.id === highlightedCrId || c.change_ref === highlightedCrId) ? "2px solid #A0D0B8" : "none",\n                      outlineOffset: -2,\n                    }}\n                  >')

patch('5 Apply to budget button',
    '<option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option>\n                        </select>\n                      </td>\n                      <td style={{ ...cb, minWidth: 160 }}><input type="text" value={c.notes}',
    '<option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option>\n                        </select>\n                        {c.status === "approved" && c.cost_impact !== "" && Number(c.cost_impact) !== 0 && !readOnly && (\n                          <button\n                            type="button"\n                            title="Apply this approved CR cost impact to the Approved Budget"\n                            onClick={() => {\n                              const current = Number(content.total_approved_budget) || 0;\n                              const impact  = Number(c.cost_impact) || 0;\n                              updateField("total_approved_budget", current + impact);\n                              updateCE(c.id, { notes: (c.notes ? c.notes + " | " : "") + "Applied to budget: " + sym + Math.abs(impact).toLocaleString("en-GB") + " on " + new Date().toLocaleDateString("en-GB") });\n                            }}\n                            style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, cursor: "pointer", background: P.greenLt, border: "1px solid #A0D0B8", color: P.green }}\n                          >\n                            \u2713 Apply to budget\n                          </button>\n                        )}\n                      </td>\n                      <td style={{ ...cb, minWidth: 160 }}><input type="text" value={c.notes}')

patch('6 unapplied CR banner',
    '          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>\n            {[\n              { label: "Approved Exposure", value: fmt(approvedExposure, sym), color: P.navy },',
    '          {(() => {\n            const unapplied = content.change_exposure.filter(c => c.status === "approved" && Number(c.cost_impact) !== 0 && !String(c.notes || "").includes("Applied to budget"));\n            if (!unapplied.length) return null;\n            const total = unapplied.reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);\n            return (\n              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", background: P.greenLt, border: "1px solid #A0D0B8", marginBottom: 8, borderRadius: 4 }}>\n                <Check style={{ width: 13, height: 13, color: P.green, flexShrink: 0, marginTop: 1 }} />\n                <div style={{ fontFamily: P.mono, fontSize: 11, color: P.green }}>\n                  <strong>{unapplied.length} approved CR{unapplied.length !== 1 ? "s" : ""}</strong> ready to apply \u2014 click <strong>\u2713 Apply to budget</strong> on each row. Total: <strong>{sym}{Math.abs(total).toLocaleString()}</strong>\n                </div>\n              </div>\n            );\n          })()}\n          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>\n            {[\n              { label: "Approved Exposure", value: fmt(approvedExposure, sym), color: P.navy },')

open('src/components/artifacts/FinancialPlanEditor.tsx', 'w', encoding='utf-8').write(src)
print('OK:', ok)
print('MISS:', miss)
