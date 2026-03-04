const DB = "alienai_offline";

function key(k: string) {
  return `${DB}:${k}`;
}

export async function saveLocal(k: string, data: any) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key(k), JSON.stringify(data));
}

export async function loadLocal<T = any>(k: string): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(key(k));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}