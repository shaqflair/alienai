const fs = require('fs');
let src = fs.readFileSync('src/Video/AlienaPromoVideo.tsx', 'utf8');

// Find all remaining placeholder divs and show context
const lines = src.split('\n');
lines.forEach((line, i) => {
  if (line.includes('background: "#1E2D45"')) {
    console.log('Line', i+1, ':', line.trim());
  }
});
