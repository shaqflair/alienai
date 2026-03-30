const fs = require('fs');
const src = fs.readFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', 'utf8');

const searches = [
  'FinancialPlanEditorHost\n',
  'readOnly={effectiveReadOnly',
  'fpApprovalLocked',
  'isFinancialPlan) {\n    return',
];

for (const s of searches) {
  const idx = src.indexOf(s);
  if (idx >= 0) {
    console.log('\n=== ' + JSON.stringify(s) + ' ===');
    console.log(JSON.stringify(src.slice(Math.max(0,idx-50), idx+400)));
  } else {
    console.log('NOT FOUND: ' + JSON.stringify(s));
  }
}
