// src/app/api/orchestrator/run/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { runOrchestrator } from "@/lib/orchestrator";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const projectId = String(body?.projectId ?? "").trim();
    const artifactId = String(body?.artifactId ?? "").trim();

    if (!projectId || !artifactId) {
      return NextResponse.json(
        { ok: false, error: "Missing projectId or artifactId" },
        { status: 400 }
      );
    }

    // FIX: Ensure createClient is awaited - it returns a Promise<SupabaseClient>
    const supabase = await createClient();

    const { data: artifact, error } = await supabase
      .from("artifacts")
      .select("*")
      .eq("id", artifactId)
      .single();

    if (error || !artifact) {
      return NextResponse.json(
        { ok: false, error: "Artifact not found" },
        { status: 404 }
      );
    }

    const result = await runOrchestrator({
      projectId,
      artifactId,
      artifactType: (artifact as any).type,
      artifactJson: (artifact as any).json ?? (artifact as any).content_json ?? null,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Orchestrator failed" },
      { status: 500 }
    );
  }
}