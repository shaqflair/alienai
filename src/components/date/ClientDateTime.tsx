"use client";

import React from "react";
import { formatDateAuto, formatDateTimeAuto } from "@/lib/date/format";

export function ClientDate({
  value,
}: {
  value: string | Date | null | undefined;
}) {
  return <span>{formatDateAuto(value)}</span>;
}

export function ClientDateTime({
  value,
}: {
  value: string | Date | null | undefined;
}) {
  return <span>{formatDateTimeAuto(value)}</span>;
}
