import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ops = body?.ops ?? [];

    for (const op of ops) {
      if (op.type === "wbs_sync") {
        // Orchestrating the sync to the specific artifact endpoint
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/wbs/${op.payload.artifactId}/sync`, {
          method: "POST",
          body: JSON.stringify(op.payload),
          headers: { "Content-Type": "application/json" },
        });
      }
      // You can add more 'else if' blocks here for raid_sync, etc.
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Sync Route Error:", e);
    return NextResponse.json({ error: "sync failed" }, { status: 500 });
  }
}