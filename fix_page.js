const fs = require('fs');
let page = fs.readFileSync('src/app/projects/[id]/artifacts/[artifactId]/page.tsx', 'utf8');

// Remove "approved" and "rejected" from approvalReadOnly — these are terminal states,
// not "in progress". Approved FP should be editable; rejected is handled separately.
page = page.replace(
  '"approved",\r\n      "rejected",\r\n    ].includes(status);',
  '].includes(status) && status !== "approved" && status !== "rejected";'
);

// Verify
const idx = page.indexOf('approvalReadOnly');
console.log('Result:', JSON.stringify(page.slice(idx, idx+350)));
fs.writeFileSync('src/app/projects/[id]/artifacts/[artifactId]/page.tsx', page, 'utf8');
