// src/app/projects/[id]/artifacts/ArtifactsSidebarClient.tsx
"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  LayoutGrid, 
  Plus, 
  GitPullRequest,
  FileText,
  MoreHorizontal
} from "lucide-react";

interface Artifact {
  id: string;
  title: string;
  effectiveType: string;
  rawType: string;
  submitted: boolean;
  href: string;
  isChangeRequest: boolean;
}

interface ArtifactsSidebarClientProps {
  projectId: string;
  projectTitle: string;
  projectCode: string;
  artifacts: Artifact[];
  currentArtifactId?: string;
}

export function ArtifactsSidebarClient({
  projectId,
  projectTitle,
  projectCode,
  artifacts,
  currentArtifactId,
}: ArtifactsSidebarClientProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  const isCurrentArtifact = (artifactId: string) => {
    return currentArtifactId === artifactId;
  };

  return (
    <>
      {/* Sidebar Container */}
      <aside
        className={`
          relative shrink-0 bg-white border-r border-gray-200/80 
          transition-all duration-300 ease-in-out h-screen sticky top-0
          ${isCollapsed ? "w-[60px]" : "w-[320px]"}
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Collapse Toggle Button */}
        <button
          onClick={toggleCollapse}
          className={`
            absolute -right-3 top-6 z-50
            w-6 h-6 rounded-full bg-white border border-gray-200 
            shadow-sm hover:shadow-md hover:border-gray-300
            flex items-center justify-center
            transition-all duration-200
            ${isHovered || isCollapsed ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"}
          `}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-3 h-3 text-gray-600" />
          ) : (
            <ChevronLeft className="w-3 h-3 text-gray-600" />
          )}
        </button>

        {/* Header Section */}
        <div className={`
          border-b border-gray-200/80 transition-all duration-300
          ${isCollapsed ? "p-3" : "p-5"}
        `}>
          {/* Project Info */}
          <div className={`
            transition-all duration-300 overflow-hidden
            ${isCollapsed ? "opacity-0 h-0" : "opacity-100"}
          `}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Project
              </span>
            </div>
            <h2 className="text-sm font-bold text-gray-900 leading-tight mb-1 line-clamp-2">
              {projectTitle}
            </h2>
            <code className="text-[11px] text-gray-500 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
              {projectCode}
            </code>
          </div>

          {/* Collapsed State - Just Icon */}
          <div className={`
            transition-all duration-300 flex justify-center
            ${isCollapsed ? "opacity-100" : "opacity-0 h-0 overflow-hidden"}
          `}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
              {projectTitle.charAt(0).toUpperCase()}
            </div>
          </div>

          {/* Action Buttons */}
          <div className={`
            flex gap-2 mt-4 transition-all duration-300
            ${isCollapsed ? "flex-col mt-3 opacity-0 h-0 overflow-hidden" : "flex-row opacity-100"}
          `}>
            <Link
              href={`/projects/${projectId}/artifacts`}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 
                rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 
                text-xs font-medium text-gray-700 transition-colors"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Board</span>
            </Link>
            <Link
              href={`/projects/${projectId}/artifacts/new`}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 
                rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 
                text-xs font-medium text-indigo-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </Link>
          </div>

          {/* Collapsed Action Icons */}
          <div className={`
            flex flex-col gap-2 mt-2 transition-all duration-300
            ${isCollapsed ? "opacity-100" : "opacity-0 h-0 overflow-hidden"}
          `}>
            <Link
              href={`/projects/${projectId}/artifacts`}
              className="w-10 h-10 mx-auto rounded-lg bg-gray-50 hover:bg-gray-100 
                border border-gray-200 flex items-center justify-center text-gray-600 
                transition-colors"
              title="Artifact Board"
            >
              <LayoutGrid className="w-4 h-4" />
            </Link>
            <Link
              href={`/projects/${projectId}/artifacts/new`}
              className="w-10 h-10 mx-auto rounded-lg bg-indigo-50 hover:bg-indigo-100 
                border border-indigo-200 flex items-center justify-center text-indigo-600 
                transition-colors"
              title="New Artifact"
            >
              <Plus className="w-4 h-4" />
            </Link>
          </div>

          {/* Change Requests Quick Access */}
          <div className={`
            transition-all duration-300
            ${isCollapsed ? "mt-3 opacity-100" : "mt-3 opacity-100"}
          `}>
            <Link
              href={`/projects/${projectId}/change`}
              className={`
                group flex items-center gap-2 rounded-lg border border-amber-200 
                bg-amber-50/50 hover:bg-amber-50 transition-all duration-200
                ${isCollapsed ? "justify-center p-2 mx-auto w-10 h-10" : "px-3 py-2"}
              `}
              title="Change Requests board (legacy)"
            >
              <GitPullRequest className={`
                text-amber-600 transition-transform group-hover:scale-110
                ${isCollapsed ? "w-4 h-4" : "w-3.5 h-3.5"}
              `} />
              {!isCollapsed && (
                <span className="text-xs font-medium text-amber-800">
                  Change Requests
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Artifacts List */}
        <div className={`
          overflow-y-auto transition-all duration-300
          ${isCollapsed ? "p-2" : "p-4"}
          ${isCollapsed ? "h-[calc(100vh-140px)]" : "h-[calc(100vh-220px)]"}
        `}>
          {/* Section Header */}
          <div className={`
            flex items-center justify-between mb-3 transition-all duration-300
            ${isCollapsed ? "opacity-0 h-0 overflow-hidden" : "opacity-100"}
          `}>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Artifacts
            </h3>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
              {artifacts.length}
            </span>
          </div>

          {/* Artifacts Navigation */}
          {artifacts.length > 0 ? (
            <nav className="space-y-1">
              {artifacts.map((artifact) => {
                const isCurrent = isCurrentArtifact(artifact.id);
                
                return (
                  <Link
                    key={artifact.id}
                    href={artifact.href}
                    className={`
                      group relative flex items-center gap-3 rounded-xl border 
                      transition-all duration-200
                      ${isCollapsed 
                        ? "justify-center p-2 w-10 h-10 mx-auto" 
                        : "px-3 py-2.5"
                      }
                      ${isCurrent 
                        ? "bg-indigo-50 border-indigo-200 shadow-sm" 
                        : "bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/80"
                      }
                    `}
                    title={artifact.isChangeRequest ? "Change Requests board" : artifact.title}
                  >
                    {/* Current Indicator Badge */}
                    {isCurrent && !isCollapsed && (
                      <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1.5 h-8 
                        bg-indigo-500 rounded-r-full" />
                    )}

                    {/* Icon */}
                    <div className={`
                      shrink-0 rounded-lg flex items-center justify-center
                      transition-colors duration-200
                      ${isCurrent 
                        ? "bg-indigo-100 text-indigo-600" 
                        : "bg-gray-100 text-gray-500 group-hover:bg-gray-200"
                      }
                      ${isCollapsed ? "w-6 h-6" : "w-8 h-8"}
                    `}>
                      {artifact.isChangeRequest ? (
                        <GitPullRequest className={isCollapsed ? "w-3 h-3" : "w-4 h-4"} />
                      ) : (
                        <FileText className={isCollapsed ? "w-3 h-3" : "w-4 h-4"} />
                      )}
                    </div>

                    {/* Content - Hidden when collapsed */}
                    {!isCollapsed && (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`
                            text-sm font-medium truncate
                            ${isCurrent ? "text-indigo-900" : "text-gray-900"}
                          `}>
                            {artifact.title}
                          </span>
                          {isCurrent && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-indigo-100 
                              text-[9px] font-bold text-indigo-700 uppercase tracking-wider">
                              Current
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-gray-500 font-mono">
                            {artifact.effectiveType}
                          </span>
                          <span className={`
                            text-[10px] px-1.5 py-0.5 rounded-full border
                            ${artifact.submitted 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                              : "bg-gray-50 text-gray-600 border-gray-200"
                            }
                          `}>
                            {artifact.submitted ? "Submitted" : "Draft"}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Collapsed Current Indicator */}
                    {isCollapsed && isCurrent && (
                      <div className="absolute -right-0.5 -top-0.5 w-2.5 h-2.5 
                        bg-indigo-500 rounded-full border-2 border-white" />
                    )}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <div className={`
              text-center transition-all duration-300
              ${isCollapsed ? "opacity-0" : "opacity-100"}
            `}>
              <div className="p-4 rounded-xl bg-gray-50 border border-dashed border-gray-200">
                <p className="text-sm text-gray-500">No artifacts yet</p>
                <p className="text-xs text-gray-400 mt-1">or no access</p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Gradient Fade */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />
      </aside>
    </>
  );
}