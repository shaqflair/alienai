// src/lib/exports/schedule/normalize.ts
import type { NormalizedSchedule, Phase, Item, ItemType } from "./types";
import { clamp01, parseDateUTC, safeStr, startOfDayUTC } from "./utils";

function normType(t: any): ItemType {
  const s = safeStr(t).trim().toLowerCase();
  if (s === "m" || s === "milestone" || s === "mile") return "milestone";
  if (s === "d" || s === "deliverable" || s === "del") return "deliverable";
  return "task";
}

function normProgress(v: any): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v > 1) return clamp01(v / 100);
  return clamp01(v);
}

function normPhaseId(it: any): string | null {
  const v = it?.phaseId ?? it?.phase_id ?? it?.laneId ?? it?.lane_id ?? null;
  if (v === null || v === undefined) return null;
  const s = safeStr(v).trim();
  return s ? s : null;
}

function normDate(it: any): Date | null {
  return (
    parseDateUTC(it?.start) ||
    parseDateUTC(it?.date) ||
    parseDateUTC(it?.at) ||
    parseDateUTC(it?.when) ||
    null
  );
}

// ✅ MUST be a named export (not default)
export function normalizeSchedule(contentJson: any): NormalizedSchedule {
  const raw = contentJson && typeof contentJson === "object" ? contentJson : {};

  const phasesRaw = Array.isArray(raw.phases)
    ? raw.phases
    : Array.isArray(raw.lanes)
      ? raw.lanes
      : [];

  const itemsRaw = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.tasks)
      ? raw.tasks
      : [];

  const phases: Phase[] = phasesRaw
    .map((p: any, idx: number) => ({
      id: safeStr(p?.id ?? p?.key ?? `phase_${idx}`),
      name: safeStr(p?.name ?? p?.label ?? p?.title ?? `Phase ${idx + 1}`),
    }))
    .filter((p: Phase) => p.id && p.name);

  const phaseIds = new Set(phases.map((p) => p.id));

  const items: Item[] = [];
  for (const r of itemsRaw) {
    const id = safeStr(r?.id ?? r?.key ?? "").trim();
    if (!id) continue;

    const type = normType(r?.type ?? r?.kind);
    const start = normDate(r);
    if (!start) continue;

    const end = parseDateUTC(r?.end ?? r?.finish ?? r?.to ?? null);

    const name = safeStr(r?.name ?? r?.title ?? "Untitled").trim() || "Untitled";
    const phaseIdRaw = normPhaseId(r);
    const phaseId = phaseIdRaw && phaseIds.has(phaseIdRaw) ? phaseIdRaw : phaseIdRaw ? phaseIdRaw : null;

    items.push({
      id,
      phaseId,
      type,
      name,
      start: startOfDayUTC(start),
      end: end ? startOfDayUTC(end) : null,
      status: r?.status ? safeStr(r.status) : null,
      progress: normProgress(r?.progress ?? r?.percent_complete ?? r?.pct),
      dependencies: Array.isArray(r?.dependencies) ? r.dependencies.map((x: any) => safeStr(x)) : [],
      notes: r?.notes ? safeStr(r.notes) : r?.description ? safeStr(r.description) : null,
    });
  }

  // derive phases if missing
  if (phases.length === 0) {
    const ids = Array.from(new Set(items.map((i) => i.phaseId).filter(Boolean) as string[]));
    for (const id of ids) phases.push({ id, name: id });
  }

  // ensure unknown phase IDs are included
  const known = new Set(phases.map((p) => p.id));
  for (const it of items) {
    if (it.phaseId && !known.has(it.phaseId)) {
      phases.push({ id: it.phaseId, name: it.phaseId });
      known.add(it.phaseId);
    }
  }

  if (phases.length === 0) phases.push({ id: "default", name: "Schedule" });

  // ensure each item has a phase
  for (const it of items) {
    if (!it.phaseId) it.phaseId = phases[0].id;
  }

  return { phases, items };
}
