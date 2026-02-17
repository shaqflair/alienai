import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { acceptInvitesForCurrentUser } from "@/app/actions/accept-invites";

export const runtime = "nodejs";

export async function POST() {
  try {
    await acceptInvitesForCurrentUser();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

