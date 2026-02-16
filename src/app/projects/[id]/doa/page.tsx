import "server-only";
import HolidayCoverPanel from "@/components/approvals/HolidayCoverPanel";

export default async function DoaHolidayCoverPage({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params;
  const projectId = String(id ?? "").trim();

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">DOA · Holiday cover</h1>
        <p className="text-sm opacity-70">Delegate approvals from one approver to another for a time window.</p>
      </header>

      <HolidayCoverPanel projectId={projectId} />
    </main>
  );
}
