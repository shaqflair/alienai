const fs = require('fs');
const src = fs.readFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', 'utf8');

const searches = [
  'budgetLocked',
  'Approved — locked',
  'fpApprovalLocked',
  'stateText =',
];

for (const s of searches) {
  const idx = src.indexOf(s);
  if (idx >= 0) {
    console.log('\n=== ' + s + ' ===');
    console.log(JSON.stringify(src.slice(Math.max(0,idx-80), idx+250)));
  } else {
    console.log('NOT FOUND: ' + s);
  }
}
