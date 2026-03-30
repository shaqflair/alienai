const fs = require('fs');
const src = fs.readFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', 'utf8');

// Find FinancialPlanEditorHost JSX usage (not the function definition)
const idx1 = src.indexOf('<FinancialPlanEditorHost');
console.log('\n=== <FinancialPlanEditorHost ===');
console.log(JSON.stringify(src.slice(Math.max(0,idx1-100), idx1+500)));

// Find EditorStatusBar in the FP return block
const idx2 = src.indexOf('<EditorStatusBar');
console.log('\n=== <EditorStatusBar ===');
console.log(JSON.stringify(src.slice(Math.max(0,idx2-50), idx2+600)));

// Find isApproverMode (the old variable name)
const idx3 = src.indexOf('isApproverMode');
console.log('\n=== isApproverMode ===');
console.log(JSON.stringify(src.slice(Math.max(0,idx3-50), idx3+200)));
