const fs = require('fs');
const src = fs.readFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', 'utf8');

const searches = [
  'effectiveReadOnly = isFinancialPlan',
  'budgetLocked=',
  'fpApprovalLocked &&',
  'isInApprovalReviewState',
];

for (const s of searches) {
  const idx = src.indexOf(s);
  if (idx >= 0) {
    console.log('\n=== ' + s + ' ===');
    console.log(JSON.stringify(src.slice(Math.max(0,idx-50), idx+200)));
  } else {
    console.log('\n=== NOT FOUND: ' + s + ' ===');
  }
}
