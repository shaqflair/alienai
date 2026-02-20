"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { debounce } from "lodash";

/* -------------------------------------------------------------------------- */
/* TYPES & UTILS                               */
/* -------------------------------------------------------------------------- */
type RaidType = "Risk" | "Assumption" | "Issue" | "Dependency";
const STATUS_ORDER = ["Open", "In Progress", "Mitigated", "Closed", "Invalid"];

function safeStr(x: unknown) { return typeof x === "string" ? x : ""; }
function statusToken(s: any) { return safeStr(s).toLowerCase().replace(/\s/g, "").replace("_", "") || "open"; }

const THEMES: any = {
  open: { bg: "bg-[#c4c4c4]", grad: "from-[#d4d4d4] to-[#b0b0b0]", text: "text-white" },
  inprogress: { bg: "bg-[#579bfc]", grad: "from-[#6babff] to-[#4785e8]", text: "text-white" },
  mitigated: { bg: "bg-[#00c875]", grad: "from-[#0dd885] to-[#00b86b]", text: "text-white" },
  closed: { bg: "bg-[#0086c0]", grad: "from-[#0095d4] to-[#0077b0]", text: "text-white" },
  invalid: { bg: "bg-[#9d9d9d]", grad: "from-[#adadad] to-[#8d8d8d]", text: "text-white" },
  low: { bg: "bg-[#9d9d9d]", grad: "from-[#adadad] to-[#8d8d8d]", text: "text-white" },
  medium: { bg: "bg-[#579bfc]", grad: "from-[#6babff] to-[#4785e8]", text: "text-white" },
  high: { bg: "bg-[#ffcb00]", grad: "from-[#ffd633] to-[#e6c200]", text: "text-white" },
  critical: { bg: "bg-[#e2445c]", grad: "from-[#f05a70] to-[#d63a52]", text: "text-white" },
};

const TYPE_STYLES: any = {
  Risk: { color: "#e2445c", label: "Risks" },
  Assumption: { color: "#ffcb00", label: "Assumptions" },
  Issue: { color: "#ff8c00", label: "Issues" },
  Dependency: { color: "#579bfc", label: "Dependencies" },
};

/* -------------------------------------------------------------------------- */
/* MAIN COMPONENT                              */
/* -------------------------------------------------------------------------- */
export default function RaidClient({ projectId, projectTitle, initialItems }: any) {
  // 1. DATA STATE
  const [items, setItems] = useState<any[]>(initialItems ?? []);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hotRowId, setHotRowId] = useState("");
  
  // 2. UI STATE
  const [searchTerm, setSearchTerm] = useState("");
  const [activePicker, setActivePicker] = useState<any>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // 3. AI & HISTORY STATE
  const [aiHistOpenId, setAiHistOpenId] = useState("");
  const [aiRunsById, setAiRunsById] = useState<Record<string, any[]>>({});
  const [aiCompare, setAiCompare] = useState<{ a: string; b: string } | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  // 4. DIGEST & EXPORT STATE
  const [showDigest, setShowDigest] = useState(false);
  const [digestData, setDigestData] = useState<any>(null);

  const updateQueue = useRef<Record<string, number>>({});

  /* -------------------------- ACTIONS & PATCHING -------------------------- */
  
  const onPatch = useCallback(async (id: string, patch: any) => {
    const timestamp = Date.now();
    updateQueue.current[id] = timestamp;
    const previousItems = [...items];
    
    // Optimistic Update
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch, updated_at: new Date().toISOString() } : it));

    try {
      const current = previousItems.find(x => x.id === id);
      const res = await fetch(`/api/raid/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, expected_updated_at: current?.updated_at }),
      });
      const data = await res.json();
      
      if (updateQueue.current[id] !== timestamp) return;
      if (!res.ok) throw new Error(data.message || "Concurrency Conflict");
      
      setItems(prev => prev.map(it => it.id === id ? { ...it, ...data.item } : it));
      setMsg("Saved");
      setTimeout(() => setMsg(""), 2000);
    } catch (e: any) {
      setItems(previousItems);
      setErr(e.message);
    }
  }, [items]);

  const debouncedPatch = useMemo(() => debounce(onPatch, 800), [onPatch]);

  /* -------------------------- KEYBOARD SHORTCUTS -------------------------- */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hotRowId || ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
      
      const item = items.find(x => x.id === hotRowId);
      if (!item) return;

      if (e.key.toLowerCase() === "s") {
        const curIdx = STATUS_ORDER.indexOf(item.status);
        onPatch(item.id, { status: STATUS_ORDER[(curIdx + 1) % STATUS_ORDER.length] });
      }
      if (e.key.toLowerCase() === "p") {
        const priorities = ["Low", "Medium", "High", "Critical"];
        const curIdx = priorities.indexOf(item.priority);
        onPatch(item.id, { priority: priorities[(curIdx + 1) % priorities.length] });
      }
      if (e.key === "Escape") setHotRowId("");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotRowId, items, onPatch]);

  /* -------------------------- AI HISTORY ENGINE -------------------------- */
  const openHistory = async (id: string) => {
    setAiHistOpenId(id);
    setIsAiLoading(true);
    try {
      const res = await fetch(`/api/raid/${id}/ai-history`);
      const data = await res.json();
      if (data.runs) {
        setAiRunsById(prev => ({ ...prev, [id]: data.runs }));
        if (data.runs.length >= 2) setAiCompare({ a: data.runs[0].id, b: data.runs[1].id });
      }
    } catch (e) {
      setErr("Failed to load history");
    } finally {
      setIsAiLoading(false);
    }
  };

  /* -------------------------- EXPORT & BULK -------------------------- */
  const exportCSV = () => {
    const headers = ["ID", "Type", "Description", "Status", "Priority", "Owner", "Due Date"];
    const csv = [headers, ...items.map(it => [it.public_id || it.id, it.type, `"${it.description}"`, it.status, it.priority, it.owner_label, it.due_date])]
      .map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `RAID_Export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleBulkStatus = (status: string) => {
    selectedIds.forEach(id => onPatch(id, { status }));
    setSelectedIds([]);
  };

  /* -------------------------- RENDER LOGIC -------------------------- */
  const filteredGroups = useMemo(() => {
    const groups: any = { Risk: [], Assumption: [], Issue: [], Dependency: [] };
    items.filter(it => it.description.toLowerCase().includes(searchTerm.toLowerCase()))
         .forEach(it => groups[it.type]?.push(it));
    return groups;
  }, [items, searchTerm]);

  const gridTemplate = `50px 40px 1fr 140px 140px 180px 160px`;

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-[#323338] font-sans selection:bg-blue-100">
      {/* GLOBAL NOTIFICATIONS */}
      {err && <div className="fixed top-20 right-8 z-[100] bg-red-600 text-white px-6 py-3 rounded-lg shadow-2xl animate-in slide-in-from-right font-bold flex items-center gap-3">
        <span>⚠️ {err}</span>
        <button onClick={() => setErr("")}>✕</button>
      </div>}

      {/* HEADER */}
      <header className="sticky top-0 z-[60] bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold tracking-tight">{projectTitle}</h1>
          <div className="h-6 w-[1px] bg-gray-200" />
          <div className="flex gap-2">
            <button onClick={() => setShowDigest(true)} className="text-[10px] font-black bg-purple-50 text-purple-600 border border-purple-100 px-3 py-1.5 rounded uppercase hover:bg-purple-100 transition-all">✨ AI Digest</button>
            <button onClick={exportCSV} className="text-[10px] font-black bg-gray-50 text-gray-500 border border-gray-200 px-3 py-1.5 rounded uppercase hover:bg-gray-100 transition-all">📥 Export</button>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative">
            <input 
              className="px-10 py-2 text-sm border border-gray-200 rounded-full bg-gray-50 outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white w-80 transition-all shadow-inner"
              placeholder="Filter by description or owner..."
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="absolute left-4 top-2.5 text-gray-400">🔍</span>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="max-w-[1800px] mx-auto p-10 relative">
        <DragDropContext onDragEnd={(res) => res.destination && onPatch(res.draggableId, { type: res.destination.droppableId })}>
          {Object.entries(filteredGroups).map(([type, groupItems]: any) => (
            <div key={type} className="mb-16">
              <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-3">
                  <h3 style={{ color: TYPE_STYLES[type].color }} className="font-black text-sm uppercase tracking-widest">{TYPE_STYLES[type].label}</h3>
                  <span className="bg-white border text-gray-400 text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm">{groupItems.length}</span>
                </div>
                <button className="text-blue-500 text-xs font-bold hover:underline">+ Add {type}</button>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-[0_4px_20px_rgba(0,0,0,0.03)] overflow-visible">
                <div className="grid h-11 bg-gray-50/50 border-b text-[10px] uppercase font-black text-gray-400 items-center px-4" style={{ gridTemplateColumns: gridTemplate }}>
                  <div className="flex justify-center"><input type="checkbox" onChange={(e) => {
                    const ids = groupItems.map((it: any) => it.id);
                    setSelectedIds(e.target.checked ? [...new Set([...selectedIds, ...ids])] : selectedIds.filter(id => !ids.includes(id)));
                  }} /></div>
                  <div />
                  <div className="px-4">Item Details</div>
                  <div className="text-center">Status</div>
                  <div className="text-center">Priority</div>
                  <div className="px-6">Owner / Stakeholder</div>
                  <div className="px-6">Due Date</div>
                </div>

                <Droppable droppableId={type}>
                  {(prov) => (
                    <div {...prov.droppableProps} ref={prov.innerRef} className="bg-gray-200 flex flex-col gap-[1px]">
                      {groupItems.map((item: any, idx: number) => (
                        <Draggable key={item.id} draggableId={item.id} index={idx}>
                          {(dProv) => (
                            <div
                              ref={dProv.innerRef} {...dProv.draggableProps}
                              onClick={() => setHotRowId(item.id)}
                              className={`grid h-14 bg-white items-center group/row relative transition-all ${hotRowId === item.id ? 'bg-blue-50/50 z-10' : 'hover:bg-gray-50/50'}`}
                              style={{ ...dProv.draggableProps.style, gridTemplateColumns: gridTemplate }}
                            >
                              <div className="flex justify-center">
                                <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => {
                                  setSelectedIds(prev => prev.includes(item.id) ? prev.filter(x => x !== item.id) : [...prev, item.id]);
                                }} />
                              </div>
                              <div className="h-full relative flex items-center justify-center">
                                <div style={{ backgroundColor: TYPE_STYLES[type].color }} className="absolute left-0 w-1.5 h-full" />
                                <div {...dProv.dragHandleProps} className="opacity-0 group-hover/row:opacity-100 text-gray-300">⋮⋮</div>
                              </div>

                              <div className="px-4 flex flex-col">
                                <input 
                                  defaultValue={item.description} 
                                  className="w-full bg-transparent outline-none text-sm font-semibold text-[#323338]"
                                  onChange={(e) => debouncedPatch(item.id, { description: e.target.value })}
                                />
                                <div className="flex gap-2 mt-1">
                                  <span onClick={() => openHistory(item.id)} className="text-[9px] text-blue-500 font-bold cursor-pointer hover:underline">AI Audit Logs</span>
                                  <span className="text-[9px] text-gray-300">•</span>
                                  <span className="text-[9px] text-gray-400">ID: {item.public_id || '—'}</span>
                                </div>
                              </div>

                              <div className="h-full relative">
                                <button 
                                  onClick={() => setActivePicker({ id: item.id, type: 'status' })}
                                  className={`w-full h-full relative flex items-center justify-center ${THEMES[statusToken(item.status)]?.bg}`}
                                >
                                  <div className={`absolute inset-0 bg-gradient-to-b ${THEMES[statusToken(item.status)]?.grad} opacity-30`} />
                                  <span className="relative z-10 text-white text-[11px] font-black">{item.status}</span>
                                </button>
                                {activePicker?.id === item.id && activePicker.type === 'status' && (
                                  <div className="absolute top-14 left-0 z-[100] bg-white p-2 shadow-2xl border rounded-xl grid gap-1 w-48 animate-in zoom-in-95">
                                    {STATUS_ORDER.map(s => (
                                      <button key={s} onClick={() => { onPatch(item.id, { status: s }); setActivePicker(null); }} className={`h-10 rounded text-white text-[10px] font-black ${THEMES[statusToken(s)]?.bg}`}>{s}</button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="h-full border-l border-white">
                                <button onClick={() => setActivePicker({ id: item.id, type: 'priority' })} className={`w-full h-full ${THEMES[statusToken(item.priority)]?.bg || 'bg-gray-100'}`}>
                                  <span className="text-white text-[10px] font-black uppercase tracking-wider">{item.priority || "—"}</span>
                                </button>
                              </div>

                              <div className="px-6 flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-indigo-500 text-white font-bold flex items-center justify-center shadow-inner">
                                  {item.owner_label?.[0]?.toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-bold text-gray-700">{item.owner_label}</span>
                                  <span className="text-[10px] text-gray-400">Stakeholder</span>
                                </div>
                              </div>

                              <div className="px-6">
                                <input type="date" defaultValue={item.due_date?.split('T')[0]} className="text-[11px] font-black text-gray-400 bg-gray-50 px-2 py-1 rounded" onChange={e => onPatch(item.id, { due_date: e.target.value })} />
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {prov.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            </div>
          ))}
        </DragDropContext>
      </main>

      {/* BULK ACTION BAR */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] bg-[#323338] text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-8 animate-in slide-in-from-bottom">
          <span className="text-sm font-bold">{selectedIds.length} items selected</span>
          <div className="h-8 w-[1px] bg-gray-600" />
          <div className="flex gap-4">
            <button onClick={() => handleBulkStatus("Mitigated")} className="text-xs font-black hover:text-green-400">Mark Mitigated</button>
            <button onClick={() => handleBulkStatus("Closed")} className="text-xs font-black hover:text-blue-400">Archive</button>
            <button onClick={() => setSelectedIds([])} className="text-xs font-black text-gray-400 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {/* AI HISTORY SIDE PANEL */}
      {aiHistOpenId && (
        <div className="fixed inset-y-0 right-0 w-[550px] bg-white shadow-[-20px_0_60px_rgba(0,0,0,0.15)] z-[110] flex flex-col animate-in slide-in-from-right duration-500">
           <div className="p-10 border-b bg-gray-50 flex justify-between items-center">
             <div>
               <h2 className="text-xl font-bold">AI Intelligence Audit</h2>
               <p className="text-xs text-blue-500 font-bold uppercase tracking-widest mt-1">Audit Trail & Version History</p>
             </div>
             <button onClick={() => setAiHistOpenId("")} className="text-3xl text-gray-300 hover:text-gray-900">✕</button>
           </div>
           <div className="flex-1 overflow-y-auto p-10">
             {isAiLoading ? <p className="animate-pulse text-gray-400">Scanning neural history...</p> : (
               <div className="space-y-12">
                 {/* This would contain the comparison cards for AI runs */}
                 <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
                    <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">Current Run Analysis</h4>
                    <p className="text-sm text-indigo-900 leading-relaxed italic">"Risk probability increased by 15% due to timeline shifts in Dependency #402..."</p>
                 </div>
               </div>
             )}
           </div>
        </div>
      )}
    </div>
  );
}