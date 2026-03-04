import { getQueue, clearQueue } from "./queue";

export async function syncNow() {
  const queue = await getQueue();
  if (!queue.length) return;

  try {
    const res = await fetch("/api/offline/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ops: queue }),
    });

    if (res.ok) {
      await clearQueue();
    }
  } catch {
    console.warn("Offline sync failed");
  }
}