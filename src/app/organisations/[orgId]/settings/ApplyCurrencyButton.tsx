// src/app/organisations/[orgId]/settings/ApplyCurrencyButton.tsx
"use client";

import { useState } from "react";
import { applyOrgCurrencyToAllPlans } from "./apply-currency-action";

export default function ApplyCurrencyButton({
  organisationId,
  currency,
}: {
  organisationId: string;
  currency: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [count, setCount] = useState(0);
  const [err, setErr] = useState("");

  async function handleClick() {
    if (!confirm(`Update all existing financial plans to ${currency}? This cannot be undone.`)) return;
    setState("loading");
    try {
      const res = await applyOrgCurrencyToAllPlans(organisationId, currency);
      if (res.ok) {
        setCount(res.updated);
        setState("done");
      } else {
        setErr(res.error ?? "Failed");
        setState("error");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
      setState("error");
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "loading"}
        className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        {state === "loading" ? "Applying…" : `Apply ${currency} to all existing financial plans`}
      </button>
      {state === "done" && (
        <p className="text-sm text-green-700">
          ✓ Updated {count} financial plan{count !== 1 ? "s" : ""} to {currency}.
        </p>
      )}
      {state === "error" && (
        <p className="text-sm text-red-600">Error: {err}</p>
      )}
    </div>
  );
}
