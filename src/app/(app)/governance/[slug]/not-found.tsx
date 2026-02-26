import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">Governance article not found</h1>
      <p className="mt-2 text-neutral-600">
        This guidance page doesn’t exist.
      </p>

      <Link
        href="/governance"
        className="mt-6 inline-block rounded-lg border px-4 py-2 text-sm"
      >
        Back to Governance Hub
      </Link>
    </div>
  );
}