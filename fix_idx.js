const fs = require('fs');
let src = fs.readFileSync('src/Video/AlienaPromoVideo.tsx', 'utf8');

// Clamp idx to always be >= 0
src = src.replace(
  'const idx      = Math.min(Math.floor(lf / segLen), screens.length - 1);',
  'const idx      = Math.min(Math.max(0, Math.floor(lf / segLen)), screens.length - 1);'
);

// Also fix applyBudget scene — lf can be negative too
src = src.replace(
  'const showUpdated  = lf > f(4.5);',
  'const showUpdated  = lf > f(4.5) && lf >= 0;'
);

console.log('idx fix:', src.includes('Math.max(0, Math.floor'));
fs.writeFileSync('src/Video/AlienaPromoVideo.tsx', src, 'utf8');
