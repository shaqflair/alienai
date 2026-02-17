import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { runOrchestrator } from "@/lib/orchestrator";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { projectId, artifactId } = body;

  const supabase = createClient();

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
    artifactType: artifact.type,
    artifactJson: artifact.json,
  });

  return NextResponse.json(result);
}


