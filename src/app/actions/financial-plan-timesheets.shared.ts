// src/app/actions/financial-plan-timesheets.shared.ts

import type { TimesheetEntry } from "@/components/artifacts/computeActuals";

export type FetchTimesheetResult =
  | { ok: true; entries: TimesheetEntry[] }
  | { ok: false; error: string };
