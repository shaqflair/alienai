const fs = require('fs');
let page = fs.readFileSync('src/app/projects/[id]/artifacts/[artifactId]/page.tsx', 'utf8');

// Find artifactLocked banner condition
const idx = page.indexOf('artifact locked');
console.log('artifactLocked context:', JSON.stringify(page.slice(Math.max(0,idx-300), idx+200)));
