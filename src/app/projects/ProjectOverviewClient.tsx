"use client";

import Link from "next/link";
import useSWR from "swr";

type Project = {
  id: string;
  title: string;
  client_name?: string | null;
  role?: string | null;
};

type Resp =
  | { ok: true; projects: Project[] }
  | { ok: false; error: string };

async function fetcher(url: string): Promise<Resp> {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
}

export default function ProjectOverviewClient() {
  const { data, isLoading } = useSWR<Resp>("/api/projects/overview", fetcher);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white px-6 py-10">
        <h1 className="text-2xl font-semibold text-gray-900">Project Overview</h1>
        <p className="text-gray-500 mt-2">Loading projects…</p>
      </div>
    );
  }

  if (!data || (data as any).ok === false) {
    const err = (data as any)?.error ?? "Failed to load";
    return (
      <div className="min-h-screen bg-white px-6 py-10">
        <h1 className="text-2xl font-semibold text-gray-900">Project Overview</h1>
        <p className="text-red-600 mt-2">{err}</p>
      </div>
    );
  }

  const projects = (data as any).projects as Project[];

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-900">Project Overview</h1>
          <p className="text-sm text-gray-500">Jump into delivery areas</p>
        </div>

        {/* Grid */}
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="group block bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:border-blue-400 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {p.title}
                </div>
                <div className="text-gray-400 group-hover:text-blue-500 transition-colors" aria-hidden>
                  ↗
                </div>
              </div>

              <div className="text-sm text-gray-500 mb-4">
                Open RAID • Changes • Lessons • Reporting
              </div>

              {p.client_name ? (
                <div className="text-sm text-gray-600 font-medium">
                  {p.client_name}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}