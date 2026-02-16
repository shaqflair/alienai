"use client";

function errText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export default function SettingsError({ error, reset }: { error: any; reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="rounded-lg border bg-white p-5 space-y-2">
        <div className="text-sm font-medium text-red-700">Something went wrong</div>
        <div className="text-sm whitespace-pre-wrap">{errText(error)}</div>

        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
