const fs = require('fs');

// Fix 1: ArtifactDetailClientHost — allow editing when FP is approved even if server says not editable
let src = fs.readFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', 'utf8');
src = src.replace(
  '(!isEditable && !isApproverReviewMode)',
  '(!isEditable && !isApproverReviewMode && approvalStatusLower !== "approved")'
);
fs.writeFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', src, 'utf8');
console.log('Host fix:', src.includes('approvalStatusLower !== "approved"'));

// Fix 2: page.tsx — suppress the yellow banner for approved financial plans
let page = fs.readFileSync('src/app/projects/[id]/artifacts/[artifactId]/page.tsx', 'utf8');
const before = page.length;

// Find the banner text and its condition
const bannerIdx = page.indexOf('approval in progress');
if (bannerIdx >= 0) {
  console.log('Banner context:', JSON.stringify(page.slice(Math.max(0, bannerIdx-200), bannerIdx+200)));
} else {
  console.log('Banner not found directly, searching cannot be edited...');
  const idx2 = page.indexOf('cannot be edited in its current');
  if (idx2 >= 0) console.log('Context:', JSON.stringify(page.slice(Math.max(0, idx2-200), idx2+200)));
}
