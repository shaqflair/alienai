import "server-only";
import HolidayCoverPanel from "@/components/approvals/HolidayCoverPanel";

export default async function ApprovalsSettingsPage({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params;
  const projectId = String(id ?? "").trim();

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Approvals</h1>
      <div style={{ opacity: 0.8, marginBottom: 16 }}>Holiday cover and approver substitutions.</div>

      <HolidayCoverPanel projectId={projectId} />
    </main>
  );
}
