import "server-only";
import type { PortfolioScopeResult } from "@/lib/server/portfolio-scope";

export function buildScopeMeta(
  scope: PortfolioScopeResult,
  effectiveProjectCount: number,
  completeness: "full" | "partial" | "empty",
  extra?: Record<string, unknown>,
) {
  return {
    completeness,
    reason: scope.reason,
    scope_mode: scope.mode,
    strict_project_count: scope.meta.strictProjectCount,
    fail_open_project_count: scope.meta.failOpenProjectCount,
    returned_project_count: scope.meta.returnedProjectCount,
    effective_project_count: effectiveProjectCount,
    used_fallback: scope.meta.usedFallback,
    had_scope_rows: scope.meta.hadScopeRows,
    active_only: scope.meta.activeOnly,
    ...(extra ?? {}),
  };
}
