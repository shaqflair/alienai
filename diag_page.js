const fs = require('fs');
let page = fs.readFileSync('src/app/projects/[id]/artifacts/[artifactId]/page.tsx', 'utf8');

// Find approvalReadOnly definition
const idx = page.indexOf('approvalReadOnly');
console.log('approvalReadOnly context:', JSON.stringify(page.slice(Math.max(0,idx-50), idx+400)));
