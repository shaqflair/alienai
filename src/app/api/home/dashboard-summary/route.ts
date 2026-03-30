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

function jsonNoStore(payload: unknown, extraHeaders?: Record<string, string>) {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      ...(extraHeaders ?? {}),
    },
  });
}

async function handleDashboardSummary(
  req: NextRequest,
  input: { days?: unknown; dueDays?: unknown; dueWindowDays?: unknown; filters?: any },
  opts?: { enableMemoryCache?: boolean },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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
        {
          ...cached.payload,
          cache: {
            key: cacheKey,
            hit: true,
            ttlSeconds: SUMMARY_TTL_SECONDS,
            scope: "memory",
          },
        },
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
        {
          ...payload,
          cache: {
            key: cacheKey,
            hit: true,
            ttlSeconds: SUMMARY_TTL_SECONDS,
            scope: "memory",
          },
        },
        {
          "x-dashboard-cache": "COALESCED",
          "x-dashboard-cache-key": cacheKey,
        },
      );
    }

    const promise = loadDashboardSummaryData(req, {
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
        payload,
      });

      return jsonNoStore(payload, {
        "x-dashboard-cache": "MISS",
        "x-dashboard-cache-key": cacheKey,
      });
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  const payload = await loadDashboardSummaryData(req, {
    userId: user.id,
    days,
    dueDays,
    filters,
    cacheKey,
  });

  return jsonNoStore(payload, {
    "x-dashboard-cache": "BYPASS",
    "x-dashboard-cache-key": cacheKey,
  });
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