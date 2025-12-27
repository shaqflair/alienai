import { notFound } from "next/navigation";
import ArtifactsSidebar from "./ArtifactsSidebar";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id?: string }>;
}) {
  // ✅ Next.js 16: params is async
  const { id } = await params;

  const projectId = typeof id === "string" ? id.trim() : "";
  if (!projectId || projectId === "undefined" || projectId === "null") {
    notFound();
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      <ArtifactsSidebar projectId={projectId} />
      <section className="flex-1 overflow-auto p-6">
        {children}
      </section>
    </div>
  );
}
