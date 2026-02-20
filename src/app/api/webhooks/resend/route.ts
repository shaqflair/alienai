// src/app/api/webhooks/resend/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs"; // crypto needs node runtime (not edge)

function extractSignature(sigHeader: string): string {
  const s = (sigHeader || "").trim();
  if (!s) return "";

  // Accept raw hex
  if (/^[a-f0-9]{64}$/i.test(s)) return s.toLowerCase();

  // Accept "v1=...." or "t=...,v1=...."
  const parts = s.split(",").map((p) => p.trim());
  for (const p of parts) {
    const [k, v] = p.split("=").map((x) => x.trim());
    if ((k === "v1" || k === "sig" || k === "signature") && v) return v.toLowerCase();
  }

  // Fallback: if there's an equals, take RHS
  const eq = s.indexOf("=");
  if (eq !== -1) return s.slice(eq + 1).trim().toLowerCase();

  return s.toLowerCase();
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Missing RESEND_WEBHOOK_SECRET" }, { status: 500 });
  }

  const body = await req.text();

  // ? Next.js 16: headers() is async
  const h = await headers();
  const signatureHeader = h.get("resend-signature") ?? h.get("Resend-Signature") ?? "";
  const signature = extractSignature(signatureHeader);

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // Compute expected signature (HMAC SHA256 hex)
  const expected = createHmac("sha256", secret).update(body).digest("hex");

  // Constant-time compare
  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  const ok = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);

  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

// TODO: Persist delivery state using event.type + event.data?.id
return NextResponse.json({ ok: true });
}
