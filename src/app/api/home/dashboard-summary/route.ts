// src/app/api/home/dashboard-summary/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createClient } from "@/utils/supabase/server";
import {
  type DashboardSummaryPayload,
  type PortfolioFilters,
  canonicalizeFilters,
  loadDashboardSummaryData,
  normalizeDays,
  normalizeFilters,
  parseFiltersFromSearchParams,
} from "@/lib/server/home/loadDashboardSummary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUMMARY_TTL_SECONDS = 45;

const memoryCache = new Map<
  string,
  { expiresAt: number; payload: DashboardSummaryPayload }
>();
const inFlight = new Map<string, Promise<DashboardSummaryPayload>>();

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function sha1(input: string) {
  return createHash("sha1").update(input).digest("hex");
}

function makeSummaryCacheKey(input: {
  userId: string;
  days: 7 | 14 | 30 | 60;
  dueDays: 7 | 14 | 30 | 60;
  filters: PortfolioFilters;
}) {
  const canonical = {
    userId: input.userId,
    days: input.days,
    dueDays: input.dueDays,
    filters: canonicalizeFilters(input.filters),
  };
  return sha1(stableJson(canonical));
}

function jsonNoStore(payload: unknown, extraHeaders?: Record<string, string>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      ...(extraHeaders ?? {}),
    },
  });
}

function safeErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown dashboard summary error";
  }
}

function makeFailurePayload(input: {
  days: 7 | 14 | 30 | 60;
  dueDays: 7 | 14 | 30 | 60;
  filters: PortfolioFilters;
  cacheKey: string;
  error: unknown;
}) {
  const message = safeErrorMessage(input.error);

  return {
    ok: false,
    days: input.days,
    dueDays: input.dueDays,
    filters: canonicalizeFilters(input.filters),
    error: "Dashboard summary failed",
    detail: message,
    integrity: {
      status: "error",
      completeness: "empty",
      reason: "DASHBOARD_SUMMARY_ROUTE_FAILURE",
    },
    cache: {
      key: input.cacheKey,
      hit: false,
      ttlSeconds: SUMMARY_TTL_SECONDS,
      scope: "none",
    },
    portfolioHealth: null,
    milestonesDue: null,
    raidPanel: null,
    financialPlanSummary: null,
    recentWins: null,
    resourceActivity: null,
    aiBriefing: null,
    dueDigest: null,
    executiveBriefing: null,
    insights: [],
  };
}

function attachCacheMeta(
  payload: DashboardSummaryPayload | Record<string, unknown>,
  cache: {
    key: string;
    hit: boolean;
    ttlSeconds: number;
    scope: "memory" | "none";
  },
) {
  return {
    ...payload,
    cache,
  };
}

async function loadSummarySafely(args: {
  req: NextRequest;
  userId: string;
  days: 7 | 14 | 30 | 60;
  dueDays: 7 | 14 | 30 | 60;
  filters: PortfolioFilters;
  cacheKey: string;
}) {
  try {
    return await loadDashboardSummaryData(args.req, {
      userId: args.userId,
      days: args.days,
      dueDays: args.dueDays,
      filters: args.filters,
      cacheKey: args.cacheKey,
    });
  } catch (error) {
    return makeFailurePayload({
      days: args.days,
      dueDays: args.dueDays,
      filters: args.filters,
      cacheKey: args.cacheKey,
      error,
    });
  }
}

async function handleDashboardSummary(
  req: NextRequest,
  input: { days?: unknown; dueDays?: unknown; dueWindowDays?: unknown; filters?: any },
  opts?: { enableMemoryCache?: boolean },
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return jsonNoStore(
      {
        ok: false,
        error: "Unauthorized",
        detail: authError.message,
        integrity: {
          status: "error",
          completeness: "empty",
          reason: "AUTH_ERROR",
        },
      },
      {
        "x-dashboard-cache": "BYPASS",
        "x-dashboard-cache-key": "none",
      },
      401,
    );
  }

  if (!user) {
    return jsonNoStore(
      {
        ok: false,
        error: "Unauthorized",
        integrity: {
          status: "error",
          completeness: "empty",
          reason: "NO_USER",
        },
      },
      {
        "x-dashboard-cache": "BYPASS",
        "x-dashboard-cache-key": "none",
      },
      401,
    );
  }

  const days = normalizeDays(input?.days);
  const dueDays = normalizeDays(input?.dueWindowDays ?? input?.dueDays);
  const filters = canonicalizeFilters(normalizeFilters(input?.filters));

  const cacheKey = makeSummaryCacheKey({
    userId: user.id,
    days,
    dueDays,
    filters,
  });

  const useMemoryCache = opts?.enableMemoryCache === true;

  if (useMemoryCache) {
    const now = Date.now();
    const cached = memoryCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return jsonNoStore(
        attachCacheMeta(cached.payload, {
          key: cacheKey,
          hit: true,
          ttlSeconds: SUMMARY_TTL_SECONDS,
          scope: "memory",
        }),
        {
          "x-dashboard-cache": "HIT",
          "x-dashboard-cache-key": cacheKey,
        },
      );
    }

    const existingPromise = inFlight.get(cacheKey);
    if (existingPromise) {
      const payload = await existingPromise;
      return jsonNoStore(
        attachCacheMeta(payload, {
          key: cacheKey,
          hit: true,
          ttlSeconds: SUMMARY_TTL_SECONDS,
          scope: "memory",
        }),
        {
          "x-dashboard-cache": "COALESCED",
          "x-dashboard-cache-key": cacheKey,
        },
      );
    }

    const promise = loadSummarySafely({
      req,
      userId: user.id,
      days,
      dueDays,
      filters,
      cacheKey,
    });

    inFlight.set(cacheKey, promise);

    try {
      const payload = await promise;
      memoryCache.set(cacheKey, {
        expiresAt: Date.now() + SUMMARY_TTL_SECONDS * 1000,
        payload: payload as DashboardSummaryPayload,
      });

      return jsonNoStore(
        attachCacheMeta(payload, {
          key: cacheKey,
          hit: false,
          ttlSeconds: SUMMARY_TTL_SECONDS,
          scope: "memory",
        }),
        {
          "x-dashboard-cache": "MISS",
          "x-dashboard-cache-key": cacheKey,
        },
      );
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  const payload = await loadSummarySafely({
    req,
    userId: user.id,
    days,
    dueDays,
    filters,
    cacheKey,
  });

  return jsonNoStore(
    attachCacheMeta(payload, {
      key: cacheKey,
      hit: false,
      ttlSeconds: SUMMARY_TTL_SECONDS,
      scope: "none",
    }),
    {
      "x-dashboard-cache": "BYPASS",
      "x-dashboard-cache-key": cacheKey,
    },
  );
}

export async function GET(req: NextRequest) {
  const filters = parseFiltersFromSearchParams(req.nextUrl.searchParams);
  const days = normalizeDays(req.nextUrl.searchParams.get("days"));
  const dueDays = normalizeDays(req.nextUrl.searchParams.get("dueDays"));

  return handleDashboardSummary(
    req,
    {
      days,
      dueDays,
      filters,
    },
    { enableMemoryCache: true },
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handleDashboardSummary(req, body ?? {}, { enableMemoryCache: false });
}