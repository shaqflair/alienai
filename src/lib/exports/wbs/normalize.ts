// src/lib/exports/wbs/normalize.ts
import type { NormalizedWbs, WbsNode } from "./types";
import { parseDateUTC, safeStr } from "./utils";

function toArray(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object") return [];

  if (Array.isArray(raw.items)) return raw.items;
  if (Array.isArray(raw.nodes)) return raw.nodes;
  if (Array.isArray(raw.rows)) return raw.rows;
  if (Array.isArray(raw.wbs)) return raw.wbs;
  if (Array.isArray(raw.work_items)) return raw.work_items;

  // common editor shapes
  if (raw.byId && typeof raw.byId === "object") return Object.values(raw.byId);
  if (raw.nodes && typeof raw.nodes === "object" && !Array.isArray(raw.nodes)) return Object.values(raw.nodes);

  return [];
}

function pickFirstString(obj: any, keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    const s = safeStr(v).trim();
    if (s) return s;
  }
  return "";
}

function pickDate(obj: any, keys: string[]): Date | null {
  for (const k of keys) {
    const d = parseDateUTC(obj?.[k]);
    if (d) return d;
  }
  return null;
}

function pickId(r: any): string {
  return pickFirstString(r, ["id", "key", "uid", "uuid"]);
}

export function normalizeWbs(contentJson: any): NormalizedWbs {
  const arr = toArray(contentJson);

  const nodes: WbsNode[] = [];

  for (const r of arr) {
    const id = pickId(r);
    if (!id) continue;

    // Prefer work_items fields first, then tolerate editor fields
    const name =
      pickFirstString(r, [
        "title",          // work_items
        "name",
        "label",
        "summary",
        "task_name",
        "text",
      ]) || "Untitled";

    const code =
      pickFirstString(r, [
        "wbs_code",       // work_items
        "wbsCode",
        "code",
        "ref",
        "number",
      ]) || null;

    const owner =
      pickFirstString(r, [
        "owner_label",    // work_items
        "owner_name",
        "owner",
        "assignee_label",
        "assignee",
      ]) || null;

    const status =
      pickFirstString(r, [
        "delivery_status", // work_items
        "status",
        "state",
        "health",
      ]) || null;

    const parentId =
      pickFirstString(r, ["parent_id", "parentId", "parent", "parent_key"]) || null;

    const start =
      pickDate(r, ["start_date", "start", "from", "planned_start", "baseline_start"]) || null;

    const end =
      pickDate(r, ["end_date", "end", "finish", "to", "due_date", "target_date", "planned_end", "baseline_end"]) ||
      null;

    const description =
      pickFirstString(r, ["description", "desc", "details", "notes"]) || null;

    nodes.push({
      id,
      parentId,
      code,
      name,
      description,
      owner,
      status,
      start,
      end,
      effort_hours: typeof r?.effort_hours === "number" ? r.effort_hours : typeof r?.effort === "number" ? r.effort : null,
      cost: typeof r?.cost === "number" ? r.cost : typeof r?.budget === "number" ? r.budget : null,
      tags: Array.isArray(r?.tags) ? r.tags.map((x: any) => safeStr(x)).filter(Boolean) : [],
    });
  }

  return { nodes };
}
