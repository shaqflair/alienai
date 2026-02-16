import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeForm from "@/components/change/ChangeForm";
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

export default function NewChangePage({
  searchParams,
}: {
  searchParams: { projectId?: string; artifactId?: string; pid?: string; aid?: string };
}) {
  const projectId = safeStr(searchParams?.projectId || searchParams?.pid).trim();
  const artifactId = safeStr(searchParams?.artifactId || searchParams?.aid).trim();

  return (
    <main className="crPage">
      <ChangeHeader title="New Change Request" subtitle="Create a clean, decision-ready CR" />

      <ChangeForm
        mode="create"
        projectId={projectId || undefined}
        artifactId={artifactId || undefined}
      />
    </main>
  );
}
