// src/app/projects/[id]/change/request/page.tsx
import "server-only";

import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeForm from "@/components/change/ChangeForm";
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";

export default async function ChangeRequestPage({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params;
  const projectId = String(id ?? "").trim();

  return (
    <main className="crPage">
      <ChangeHeader title="New Change Request" subtitle="Capture the change, then assess impact" />
      <ChangeForm mode="create" projectId={projectId as any} />
    </main>
  );
}
