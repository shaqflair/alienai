const fs = require('fs');
const content = [
  'export default function ArtifactDetailLoading() {',
  '  return (',
  '    <main className="mx-auto w-full max-w-[1600px] px-6 py-6 space-y-6 bg-white text-gray-950">',
  '      <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />',
  '      <div className="h-8 w-72 bg-gray-100 rounded animate-pulse" />',
  '      <div className="border border-gray-200 rounded-3xl p-6">',
  '        <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />',
  '      </div>',
  '      <div className="border border-gray-200 rounded-3xl p-6 space-y-6">',
  '        <div className="h-6 w-40 bg-gray-100 rounded animate-pulse" />',
  '        <div className="h-64 bg-gray-100 rounded animate-pulse" />',
  '      </div>',
  '    </main>',
  '  );',
  '}',
].join('\n');
fs.writeFileSync('src/app/projects/[id]/artifacts/[artifactId]/loading.tsx', content, 'utf8');
console.log('done');
