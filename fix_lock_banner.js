const fs = require('fs');
let page = fs.readFileSync('src/app/projects/[id]/artifacts/[artifactId]/page.tsx', 'utf8');
const ok = [], miss = [];
function patch(label, old, neu) {
  if (page.includes(old)) { page = page.replace(old, neu); ok.push(label); }
  else miss.push(label);
}

// Skip artifactLocked banner when approved (stale lock)
patch('skip artifactLocked when approved',
  'if (args.artifactLocked) {',
  'if (args.artifactLocked && status !== "approved") {');

// Skip lockedByAnotherUser banner when approved
patch('skip lockedByOther when approved',
  'if (isLockedByAnotherUser) {',
  'if (isLockedByAnotherUser && status !== "approved") {');

fs.writeFileSync('src/app/projects/[id]/artifacts/[artifactId]/page.tsx', page, 'utf8');
console.log('OK:', ok);
console.log('MISS:', miss);
