"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { 
  ChevronLeft, ChevronRight, Save, Plus, 
  Search, Filter, Calendar, Download, 
  Trash2, Copy, Link2, Info, Loader2,
  Maximize2, Minimize2, Settings2, Database
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  parseISODate, 
  addDays, 
  startOfWeekMonday, 
  iso, 
  fmtWeekHeader, 
  dayIndex,
  weekIndexFromISO,
  todayISO
} from "@/lib/date/utils";

/* -------------------------------------------------------------------------- */
/* TYPES                                   */
/* -------------------------------------------------------------------------- */

type ItemType = "milestone" | "task" | "deliverable";
type ItemStatus = "on_track" | "at_risk" | "delayed" | "done";

export type ScheduleItem = {
  id: string;
  phaseId: string;
  type: ItemType;
  name: string;
  start: string; 
  end?: string;
  status: ItemStatus;
  notes?: string;
  dependencies?: string[];
};

export type SchedulePhase = {
  id: string;
  name: string;
};

export type ScheduleDocV1 = {
  version: 1;
  type: "schedule";
  anchor_date?: string;
  phases: SchedulePhase[];
  items: ScheduleItem[];
};

/* -------------------------------------------------------------------------- */
/* MAIN COMPONENT                              */
/* -------------------------------------------------------------------------- */

export default function ScheduleGanttEditorLazy({
  projectId,
  artifactId,
  initialJson,
  readOnly = false,
  projectTitle,
  projectStartDate,
  projectFinishDate,
  latestWbsJson,
  wbsArtifactId,
}: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly?: boolean;
  projectTitle?: string | null;
  projectStartDate?: string | null;
  projectFinishDate?: string | null;
  latestWbsJson?: any | null;
  wbsArtifactId?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  
  // Persistence state
  const [doc, setDoc] = useState<ScheduleDocV1>(() => {
    return initialJson?.version === 1 ? initialJson : {
      version: 1,
      type: "schedule",
      phases: [{ id: "p1", name: "Implementation" }],
      items: []
    };
  });
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");

  // View State
  const [viewMode, setViewMode] = useState<"gantt" | "list">("gantt");
  const [zoom, setZoom] = useState<number>(12); // Weeks visible
  const [search, setSearch] = useState("");

  // Logic for scaling and layout
  const WEEK_WIDTH = 180;
  const DAY_WIDTH = WEEK_WIDTH / 7;
  const ROW_HEIGHT = 48;

  const handleSave = async () => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/artifacts/${artifactId}/content-json`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
             projectId,
             content_json: doc
          }),
        });
        if (res.ok) {
          setDirty(false);
          setMsg("Schedule saved successfully");
          setTimeout(() => setMsg(""), 3000);
        }
      } catch (e) {
        setMsg("Failed to save schedule");
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border rounded-xl overflow-hidden shadow-sm">
      {/* TOOLBAR */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex p-1 bg-slate-100 rounded-lg">
             <Button 
                variant={viewMode === "gantt" ? "white" : "ghost"} 
                size="sm" 
                className="text-xs h-8 px-3 shadow-none"
                onClick={() => setViewMode("gantt")}
             >
                Gantt
             </Button>
             <Button 
                variant={viewMode === "list" ? "white" : "ghost"} 
                size="sm" 
                className="text-xs h-8 px-3 shadow-none"
                onClick={() => setViewMode("list")}
             >
                List
             </Button>
          </div>
          <div className="h-6 w-[1px] bg-slate-200 mx-1" />
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Filter tasks..." 
              className="pl-9 h-9 w-64 bg-slate-50 border-none text-sm focus-visible:ring-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {msg && <span className="text-xs font-medium text-indigo-600 animate-pulse">{msg}</span>}
          <Button 
            variant="outline" 
            size="sm" 
            className="h-9 gap-2"
            onClick={() => {/* Trigger WBS Import Logic */}}
          >
            <Database className="h-4 w-4" />
            Import WBS
          </Button>
          <Button 
            disabled={!dirty || isPending}
            onClick={handleSave}
            size="sm" 
            className="h-9 gap-2 bg-indigo-600 hover:bg-indigo-700"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Schedule
          </Button>
        </div>
      </div>

      {/* GANTT AREA */}
      <div className="flex-1 overflow-auto relative">
        {viewMode === "gantt" ? (
          <div className="min-w-max h-full bg-white flex flex-col">
            {/* Timeline Header */}
            <div className="sticky top-0 z-20 flex bg-slate-50 border-b border-slate-200">
               <div className="w-64 p-3 font-semibold text-xs text-slate-500 uppercase border-r border-slate-200 sticky left-0 bg-slate-50">
                  Phases & Tasks
               </div>
               <div className="flex">
                  {/* Map over weeks based on doc.anchor_date */}
                  {Array.from({ length: zoom }).map((_, i) => (
                    <div key={i} className="w-[180px] p-3 text-center border-r border-slate-200 text-xs font-medium text-slate-600">
                        Week {i + 1}
                    </div>
                  ))}
               </div>
            </div>

            {/* Content Rows */}
            <div className="flex-1">
               {doc.phases.map(phase => (
                 <div key={phase.id} className="group">
                    <div className="flex bg-slate-50/50 border-b border-slate-100">
                        <div className="w-64 p-3 text-sm font-bold text-slate-700 border-r border-slate-200 sticky left-0 bg-white group-hover:bg-slate-50 transition-colors">
                           {phase.name}
                        </div>
                        <div className="flex-1 h-12" />
                    </div>
                    {/* Items within Phase */}
                    {doc.items.filter(it => it.phaseId === phase.id).map(item => (
                       <div key={item.id} className="flex border-b border-slate-100 relative h-12 hover:bg-slate-50/30">
                          <div className="w-64 p-3 pl-8 text-xs text-slate-600 border-r border-slate-200 sticky left-0 bg-white">
                             {item.name}
                          </div>
                          {/* THE GANTT BAR - Positioned absolutely based on date math */}
                          <div 
                            className="absolute h-6 top-3 rounded shadow-sm bg-indigo-500/20 border border-indigo-500/40 flex items-center px-2 cursor-pointer group/bar"
                            style={{ left: "300px", width: "120px" }}
                          >
                             <span className="text-[10px] font-bold text-indigo-700 truncate">{item.name}</span>
                          </div>
                       </div>
                    ))}
                 </div>
               ))}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500 italic">
            List view logic here...
          </div>
        )}
      </div>
    </div>
  );
}
