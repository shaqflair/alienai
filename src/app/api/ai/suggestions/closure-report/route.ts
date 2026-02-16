"use client";
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * Project Closure Report Editor (v3.5 – AI Suggestions with Apply + Dismiss)
 * Stores JSON in artifacts.content_json
 * Supports read-only mode
 */

type Rag = "green" | "amber" | "red";
type Achieved = "yes" | "partial" | "no";
type Money = number | null;

type KeyStakeholder = { name: string; role: string };
type Achievement = { text: string };
type SuccessCriterion = { text: string; achieved: Achieved };
type DeliveredItem = { deliverable: string; accepted_by: string; accepted_on: string | null };
type OutstandingItem = { item: string; owner: string; status: string; target: string };
type BudgetRow = { category: string; budget: Money; actual: Money };
type LessonItem = { text: string; action?: string };
type RiskIssueRow = {
  id: string;
  description: string;
  severity: "high" | "medium" | "low";
  owner: string;
  status: string;
  next_action: string;
};
type TeamMove = { person: string; change: string; date: string | null };
type LinkItem = { label: string; url: string };
type AttachmentItem = {
  label?: string | null;
  url: string;
  path?: string | null;
  bucket?: string | null;
  filename?: string | null;
  size_bytes?: number | null;
  uploaded_at?: string | null;
};

type ClosureDocV1 = {
  version: 1;
  project: { project_name: string; project_code: string; client_name: string; sponsor: string; pm: string };
  health: { rag: Rag; overall_health: "good" | "watch" | "critical"; summary: string };
  stakeholders: { key: KeyStakeholder[] };
  achievements: { key_achievements: Achievement[] };
  success: { criteria: SuccessCriterion[] };
  deliverables: {
    delivered: DeliveredItem[];
    outstanding: OutstandingItem[];
    acceptance_checklist: { sponsor_signed: boolean; bau_accepted: boolean; knowledge_transfer_done: boolean };
    sponsor_signoff_name: string;
    sponsor_signoff_date: string | null;
  };
  financial_closeout: { budget_rows: BudgetRow[]; roi: { annual_benefit: string; payback_achieved: string; payback_planned: string; npv: string } };
  lessons: { went_well: LessonItem[]; didnt_go_well: LessonItem[]; surprises_risks: LessonItem[] };
  handover: {
    risks_issues: RiskIssueRow[];
    team_moves: TeamMove[];
    knowledge_transfer: { docs_handed_over: boolean; final_demo_done: boolean; support_model_doc: boolean; runbook_finalised: boolean; notes: string };
    support_model: { primary_support: string; escalation: string; hypercare_end: string | null };
  };
  recommendations: { items: { text: string; owner?: string; due?: string | null }[] };
  links: { items: LinkItem[] };
  attachments: { items: AttachmentItem[] };
  signoff: {
    sponsor_name: string;
    sponsor_date: string | null;
    sponsor_decision: "" | "approved" | "conditional" | "rejected";
    pm_name: string;
    pm_date: string | null;
    pm_approved: boolean;
  };
};

type AiSuggestion = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  reason: string;
  action_type: "flag_section" | "require_confirmation" | "add_text" | "update_field";
  action_payload?: any;
  ruleName?: string; // Added for traceability
};

function uid(prefix = "ri") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try { return JSON.parse(String(x)); } catch { return null; }
}

function asMoney(v: string): Money {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function updateArray<T>(arr: T[], idx: number, mut: (item: T) => T): T[] {
  const next = [...arr];
  next[idx] = mut(next[idx]);
  return next;
}

function makeDefaultDoc(): ClosureDocV1 {
  return {
    version: 1,
    project: { project_name: "", project_code: "", client_name: "", sponsor: "", pm: "" },
    health: { rag: "green", overall_health: "good", summary: "" },
    stakeholders: { key: [] },
    achievements: { key_achievements: [] },
    success: { criteria: [] },
    deliverables: {
      delivered: [],
      outstanding: [],
      acceptance_checklist: { sponsor_signed: false, bau_accepted: false, knowledge_transfer_done: false },
      sponsor_signoff_name: "",
      sponsor_signoff_date: null,
    },
    financial_closeout: {
      budget_rows: [{ category: "Total", budget: null, actual: null }],
      roi: { annual_benefit: "", payback_achieved: "", payback_planned: "", npv: "" },
    },
    lessons: { went_well: [], didnt_go_well: [], surprises_risks: [] },
    handover: {
      risks_issues: [],
      team_moves: [],
      knowledge_transfer: { docs_handed_over: false, final_demo_done: false, support_model_doc: false, runbook_finalised: false, notes: "" },
      support_model: { primary_support: "", escalation: "", hypercare_end: null },
    },
    recommendations: { items: [] },
    links: { items: [] },
    attachments: { items: [] },
    signoff: { sponsor_name: "", sponsor_date: null, sponsor_decision: "", pm_name: "", pm_date: null, pm_approved: false },
  };
}

/* ─────────────────────────────────────────────── UI Primitives ────────────────────────────────────────────── */
function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-gray-600">{label}</div>
      {children}
    </div>
  );
}

function RowGrid({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`grid grid-cols-1 gap-4 md:grid-cols-3 ${className}`}>{children}</div>;
}

const inputBase = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60 disabled:bg-gray-50 dark:bg-white dark:text-gray-900 dark:border-gray-300";
const textareaBase = "w-full min-h-[90px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60 disabled:bg-gray-50 dark:bg-white dark:text-gray-900 dark:border-gray-300";
const selectBase = "w-full min-h-[40px] rounded-lg border border-gray-300 bg-white text-gray-900 px-3 py-2 text-sm leading-5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60 disabled:bg-gray-50 [color-scheme:light] [&>option]:bg-white [&>option]:text-gray-900";

const smallBtn = "inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";
const dangerBtn = "inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

function ragPill(r: Rag) {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border";
  if (r === "green") return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  if (r === "amber") return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  return `${base} border-red-200 bg-red-50 text-red-800`;
}

function overallPill(v: "good" | "watch" | "critical") {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border";
  if (v === "good") return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  if (v === "watch") return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  return `${base} border-red-200 bg-red-50 text-red-800`;
}

function ragSelectAccent(r: Rag) {
  if (r === "green") return "border-l-4 border-l-emerald-500";
  if (r === "amber") return "border-l-4 border-l-amber-500";
  return "border-l-4 border-l-red-500";
}

function overallSelectAccent(v: "good" | "watch" | "critical") {
  if (v === "good") return "border-l-4 border-l-emerald-500";
  if (v === "watch") return "border-l-4 border-l-amber-500";
  return "border-l-4 border-l-red-500";
}

/* ─────────────────────────────────────────────── Main Component ────────────────────────────────────────────── */
export default function ProjectClosureReportEditor({
  artifactId,
  projectId,
  readOnly = false,
  initialJson,
}: {
  artifactId: string;
  projectId?: string | null;
  readOnly?: boolean;
  initialJson?: any;
}) {
  const isReadOnly = !!readOnly;
  const canEdit = !isReadOnly;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refProjectSummary = useRef<HTMLDivElement>(null);
  const refLessons = useRef<HTMLDivElement>(null);
  const refFinancial = useRef<HTMLDivElement>(null);
  const refOutstanding = useRef<HTMLDivElement>(null);
  const refSignoff = useRef<HTMLDivElement>(null);

  const [doc, setDoc] = useState<ClosureDocV1>(() => {
    const parsed = safeJson(initialJson);
    return parsed?.version === 1 ? parsed as ClosureDocV1 : makeDefaultDoc();
  });

  useEffect(() => {
    const parsed = safeJson(initialJson);
    if (parsed?.version === 1) setDoc(parsed as ClosureDocV1);
  }, [initialJson]);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [dlBusy, setDlBusy] = useState<"pdf" | "docx" | null>(null);
  const [dlMsg, setDlMsg] = useState<string | null>(null);
  const [attBusy, setAttBusy] = useState<string | null>(null);

  // ── AI Suggestions ────────────────────────────────────────────────────────
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSheetOpen, setAiSheetOpen] = useState(false);

  // Dismissed suggestions (persist across sessions)
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`dismissed-ai-${artifactId}`);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(`dismissed-ai-${artifactId}`, JSON.stringify(dismissedIds));
    }
  }, [dismissedIds, artifactId]);

  const loadAiSuggestions = useCallback(async () => {
    if (!artifactId) return;
    setAiLoading(true);
    try {
      const res = await fetch(`/api/ai/suggestions/closure-report?artifact_id=${artifactId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (json.ok && Array.isArray(json.suggestions)) {
        // Filter out dismissed ones
        const filtered = json.suggestions.filter((s: AiSuggestion) => !dismissedIds.includes(s.id));
        setAiSuggestions(filtered);
      } else {
        setAiSuggestions([]);
      }
    } catch {
      setAiSuggestions([]);
    } finally {
      setAiLoading(false);
    }
  }, [artifactId, dismissedIds]);

  useEffect(() => {
    if (artifactId) {
      const timer = setTimeout(loadAiSuggestions, 1000);
      return () => clearTimeout(timer);
    }
  }, [artifactId, loadAiSuggestions]);

  const handleSheetOpenChange = (open: boolean) => {
    setAiSheetOpen(open);
    if (open && aiSuggestions.length === 0 && !aiLoading) {
      loadAiSuggestions();
    }
  };

  const handleDismiss = (id: string) => {
    setDismissedIds(prev => [...prev, id]);
    setAiSuggestions(prev => prev.filter(s => s.id !== id));
  };

  const highlightSection = (el: HTMLDivElement | null) => {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-amber-400", "ring-offset-2", "bg-amber-50/50");
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-amber-400", "ring-offset-2", "bg-amber-50/50");
    }, 3000);
  };

  const handleSuggestionClick = (s: AiSuggestion) => {
    const section = s.action_payload?.section;
    if (section === "summary") highlightSection(refProjectSummary.current);
    if (section === "lessons_learned") highlightSection(refLessons.current);
    if (section === "financial_summary" || section === "financial_closeout") highlightSection(refFinancial.current);
    if (section === "outstanding_items") highlightSection(refOutstanding.current);
    if (section === "signoff") highlightSection(refSignoff.current);
  };

  // Apply function for Lessons Learned suggestion
  const applyLessonsSuggestion = () => {
    setDoc(prev => ({
      ...prev,
      lessons: {
        ...prev.lessons,
        went_well: [
          ...prev.lessons.went_well,
          { text: "Stakeholder communication was clear and timely throughout the project.", action: "Continue regular status updates." }
        ]
      }
    }));
    // Optional: dismiss the suggestion after apply
    const lessonsSuggestion = aiSuggestions.find(s => s.title.includes("Lessons Learned missing"));
    if (lessonsSuggestion) handleDismiss(lessonsSuggestion.id);
    highlightSection(refLessons.current);
  };

  const sortedSuggestions = useMemo(() => {
    const order = { critical: 0, warning: 1, info: 2 };
    return [...aiSuggestions].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [aiSuggestions]);

  const hasCriticalSuggestions = sortedSuggestions.some(s => s.severity === "critical");

  const financialTotals = useMemo(() => {
    const rows = doc.financial_closeout.budget_rows || [];
    const budget = rows.reduce((sum, r) => sum + (r.budget ?? 0), 0);
    const actual = rows.reduce((sum, r) => sum + (r.actual ?? 0), 0);
    const variance = actual - budget;
    const pct = budget ? (variance / budget) * 100 : null;
    return { budget, actual, variance, pct };
  }, [doc.financial_closeout.budget_rows]);

  // ── Save with auto-refresh ────────────────────────────────────────────────
  async function handleSave() {
    if (isReadOnly) return;
    if (hasCriticalSuggestions) {
      setSaveMsg("Please address critical AI suggestions before saving.");
      setTimeout(() => setSaveMsg(null), 5000);
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveBestEffort();
      setSaveMsg("Saved.");
      loadAiSuggestions(); // Auto-refresh suggestions after save
    } catch (e: any) {
      setSaveMsg(`Save failed: ${e?.message || e}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 4000);
    }
  }

  // ── Paste your existing mutation helpers, upload, download, etc. here ──
  // For brevity, assuming you have them already. Example placeholder:

  const addLesson = (key: keyof ClosureDocV1["lessons"]) =>
    setDoc(d => ({ ...d, lessons: { ...d.lessons, [key]: [...d.lessons[key], { text: "", action: "" }] } }));

  // ... all your other add/remove functions ...

  return (
    <div className="space-y-6" data-closure-report>
      <style jsx global>{`
        [data-closure-report] select {
          color-scheme: light;
          background-color: #ffffff;
          color: #111827;
        }
        [data-closure-report] select option {
          background-color: #ffffff;
          color: #111827;
        }
      `}</style>

      {/* AI Suggestions Button + Sheet */}
      <div className="flex justify-end mb-4">
        <Sheet open={aiSheetOpen} onOpenChange={handleSheetOpenChange}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              disabled={aiLoading}
            >
              {aiLoading ? "Loading..." : (
                <>
                  AI Suggestions
                  {sortedSuggestions.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
                      {sortedSuggestions.length}
                    </span>
                  )}
                </>
              )}
            </button>
          </SheetTrigger>

          <SheetContent side="right" className="w-full max-w-lg sm:max-w-xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>AI Suggestions</SheetTitle>
              <p className="text-sm text-gray-500 mt-1">Review and address items for your closure report.</p>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              {aiLoading ? (
                <div className="text-center py-10 text-gray-500">Loading suggestions...</div>
              ) : sortedSuggestions.length === 0 ? (
                <div className="text-center py-10 text-gray-600">No active suggestions.</div>
              ) : (
                sortedSuggestions.map((s) => (
                  <div
                    key={s.id}
                    className="p-4 border rounded-lg hover:bg-gray-50 transition-colors relative"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                          {s.title}
                          {s.ruleName && (
                            <span className="text-xs text-gray-500 font-normal">({s.ruleName})</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-700 mt-1">{s.description}</div>
                        {s.reason && (
                          <div className="text-xs text-gray-500 mt-2 italic">
                            Reason: {s.reason}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            s.severity === "critical"
                              ? "bg-red-100 text-red-800"
                              : s.severity === "warning"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {s.severity}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-gray-500 hover:text-gray-700"
                          onClick={() => handleDismiss(s.id)}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>

                    {/* Apply button for Lessons Learned */}
                    {s.title.includes("Lessons Learned missing") && (
                      <button
                        type="button"
                        className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
                        onClick={applyLessonsSuggestion}
                      >
                        Apply Suggestion
                      </button>
                    )}

                    <button
                      type="button"
                      className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
                      onClick={() => handleSuggestionClick(s)}
                    >
                      Jump to section →
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-8 flex justify-between items-center border-t pt-4">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
                onClick={() => setAiSheetOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
                onClick={loadAiSuggestions}
                disabled={aiLoading}
              >
                {aiLoading ? "Refreshing..." : "Refresh Suggestions"}
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Critical warning */}
      {hasCriticalSuggestions && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Critical AI suggestions detected.</strong> Please review and address them before saving.
        </div>
      )}

      {/* PROJECT SUMMARY */}
      <div ref={refProjectSummary}>
        <Section
          title="Project Summary"
          right={
            <div className="flex items-center gap-3">
              <span className={ragPill(doc.health.rag)}>RAG: {doc.health.rag.toUpperCase()}</span>
              <span className={overallPill(doc.health.overall_health)}>Overall: {doc.health.overall_health}</span>
            </div>
          }
        >
          <RowGrid>
            <Field label="Project Name">
              <input className={inputBase} value={doc.project.project_name} disabled={isReadOnly} onChange={e => setDoc(d => ({ ...d, project: { ...d.project, project_name: e.target.value } }))} />
            </Field>
            {/* ... all other project fields ... */}
          </RowGrid>
          {/* ... RAG, Overall Health, Summary ... */}
        </Section>
      </div>

      {/* STAKEHOLDERS, ACHIEVEMENTS, SUCCESS CRITERIA, DELIVERABLES, FINANCIAL, LESSONS, HANDOVER, RECOMMENDATIONS, LINKS, ATTACHMENTS, EXPORT, SIGNOFF */}
      {/* Paste your full existing sections here – they remain unchanged */}

      {/* SAVE */}
      <div className="flex justify-end pt-6">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isReadOnly || saving || hasCriticalSuggestions}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save Project Closure Report"}
        </button>
        {saveMsg && (
          <span className={`ml-4 self-center text-sm ${saveMsg.toLowerCase().includes("failed") ? "text-red-600" : "text-green-600"}`}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}