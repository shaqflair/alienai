import "server-only";
import { safeStr } from "./filenames";

export async function fetchLogoBytes(url: string): Promise<Uint8Array | null> {
  const u = safeStr(url).trim();
  if (!u || !(u.startsWith("http://") || u.startsWith("https://"))) return null;

  try {
    const res = await fetch(u);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    if (bytes.byteLength > 3_000_000) return null;
    return bytes;
  } catch {
    return null;
  }
}
