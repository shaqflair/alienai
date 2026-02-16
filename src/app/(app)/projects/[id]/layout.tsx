import ProjectSubNav from "@/components/nav/ProjectSubNav";

/**
 * Project-specific Layout
 * Wraps all sub-routes (RAID, Changes, Lessons) with a secondary navigation bar.
 */
export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        {/* Project-specific secondary navigation */}
        <ProjectSubNav projectId={params.id} />
        
        <div>
          {children}
        </div>
      </div>
    </div>
  );
}