const fs = require('fs');
let page = fs.readFileSync('src/app/projects/[id]/artifacts/[artifactId]/page.tsx', 'utf8');

// Get the full function containing the banner logic
const fnIdx = page.indexOf('if (approvalReadOnly)');
console.log('Function scope (500 chars back):', JSON.stringify(page.slice(Math.max(0,fnIdx-500), fnIdx+50)));
