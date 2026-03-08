// src/app/projects/[id]/artifacts/[artifactId]/loading.tsx
// This Suspense boundary prevents the React streaming reconciler ($RS) from
// crashing when the user navigates away while the page is still loading.
// Without this, $RS tries to splice DOM nodes that no longer exist → parentNode crash.

export default function ArtifactDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-6 py-6 space-y-6 bg-white text-gray-950">
      <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
      <div className="h-8 w-72 bg-gray-100 rounded animate-pulse" />
      <div className="border border-gray-200 rounded-3xl p-6 space-y-4">
        <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />
        <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
      </div>
      <div className="border border-gray-200 rounded-3xl p-6 space-y-6">
        <div className="h-6 w-40 bg-gray-100 rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-20 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-gray-100 rounded animate-pulse" />
      </div>
    </main>
  );
}