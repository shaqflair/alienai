import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const base = new URL(request.url).origin;
  const isMonday = new Date().getDay() === 1;

  const paths = [
    "/api/cron/project-health/generate",
    ...(isMonday ? ["/api/cron/raid-digest/generate"] : []),
  ];

  const results = await Promise.allSettled(
    paths.map((path) =>
      fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
    )
  );

  const summary = results.map((r, i) => ({
    path: paths[i],
    status: r.status === "fulfilled" ? r.value.status : "error",
  }));

  return NextResponse.json({ summary });
}