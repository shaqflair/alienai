const fs = require('fs');
let src = fs.readFileSync('src/Video/AlienaPromoVideo.tsx', 'utf8');
const lines = src.split('\n');

// Print lines 488-500 so we see the exact strings
for (let i = 487; i < 502; i++) {
  console.log(i+1 + ': ' + lines[i]);
}
