const fs = require('fs');
let src = fs.readFileSync('src/Video/AlienaPromoVideo.tsx', 'utf8');
const lines = src.split('\n');

// Line 424 — applyBudget placeholder
lines[423] = '                <Img src={staticFile(imgSrc)} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>';

// Line 487 — platform montage placeholder  
lines[486] = '                <Img src={staticFile(sc.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>';

const result = lines.join('\n');
const count = (result.match(/<Img/g) || []).length;
console.log('Img tags:', count, '(should be 3)');
fs.writeFileSync('src/Video/AlienaPromoVideo.tsx', result, 'utf8');
