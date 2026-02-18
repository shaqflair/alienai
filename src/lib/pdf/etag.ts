import "server-only";
import crypto from "crypto";

export function sha256Hex(input: string | Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function makeEtag(payload: any) {
  const json = JSON.stringify(payload, (_k, v) => (v instanceof Date ? v.toISOString() : v));
  return `"${sha256Hex(json)}"`;
}
