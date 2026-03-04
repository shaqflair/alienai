import { loadLocal, saveLocal } from "./storage";

const QUEUE_KEY = "offline_queue";

export type OfflineOp = {
  id: string;
  type: "wbs_sync" | "raid_sync";
  payload: any;
};

export async function enqueue(op: OfflineOp) {
  const q = (await loadLocal<OfflineOp[]>(QUEUE_KEY)) || [];
  q.push(op);
  await saveLocal(QUEUE_KEY, q);
}

export async function getQueue(): Promise<OfflineOp[]> {
  return (await loadLocal<OfflineOp[]>(QUEUE_KEY)) || [];
}

export async function clearQueue() {
  await saveLocal(QUEUE_KEY, []);
}