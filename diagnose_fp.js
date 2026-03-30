const fs = require('fs');
const src = fs.readFileSync('src/components/artifacts/FinancialPlanEditor.tsx', 'utf8');

// Find exact content around the 3 missed anchors
const checks = [
  { label: 'activeTab', search: 'useState<FinancialPlanTab>' },
  { label: 'signals state', search: 'useState<Signal[]>' },
  { label: 'approved option', search: 'value="approved">Approved' },
  { label: 'Approved Exposure', search: 'Approved Exposure' },
  { label: 'gridTemplateColumns.*repeat(3', search: 'gridTemplateColumns.*repeat' },
];

for (const c of checks) {
  const re = new RegExp(c.search);
  const m = re.exec(src);
  if (m) {
    const start = Math.max(0, m.index - 20);
    const end = Math.min(src.length, m.index + 200);
    console.log('\n=== ' + c.label + ' ===');
    console.log(JSON.stringify(src.slice(start, end)));
  } else {
    console.log('\n=== ' + c.label + ' NOT FOUND ===');
  }
}
