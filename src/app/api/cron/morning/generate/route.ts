import { NextResponse } from "next/server";

const CRONS = [
  "/api/cron/exec-intel/generate",
  "/api/cron/raid-intel/generate",
  "/api/cron/schedule-intel/generate",
  "/api/cron/decision-intel/generate",
];

export async function GET(request: Request) {
  const base = new URL(request.url).origin;

  const results = await Promise.allSettled(
    CRONS.map((path) =>
      fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
    )
  );

  const summary = results.map((r, i) => ({
    path: CRONS[i],
    status: r.status === "fulfilled" ? r.value.status : "error",
  }));

  return NextResponse.json({ summary });
}