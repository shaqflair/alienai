const fs = require('fs');
let src = fs.readFileSync('src/Video/AlienaPromoVideo.tsx', 'utf8');

// Replace ALL Img tags with placeholder divs
// Pattern 1: ScreenshotScene Img (src prop)
src = src.replace(
  /<Img\s+src=\{staticFile\(src\)\}\s+style=\{\{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "left top" \}\}\s+\/>/g,
  '<div style={{ width: "100%", height: "100%", background: "#1E2D45", display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ color: "#5A7090", fontSize: 20, fontFamily: "system-ui" }}>Screenshot placeholder</div></div>'
);

// Pattern 2: applyBudget scene Img (imgSrc prop)
src = src.replace(
  /<Img\s+src=\{staticFile\(imgSrc\)\}\s+style=\{\{ width: "100%", height: "100%", objectFit: "cover" \}\}\s+\/>/g,
  '<div style={{ width: "100%", height: "100%", background: "#1E2D45" }}/>'
);

// Pattern 3: platform montage Img (sc.src prop)
src = src.replace(
  /<Img\s+src=\{staticFile\(sc\.src\)\}\s+style=\{\{ width: "100%", height: "100%", objectFit: "cover" \}\}\s+\/>/g,
  '<div style={{ width: "100%", height: "100%", background: "#1E2D45" }}/>'
);

// Also remove Img from imports since we no longer use it
src = src.replace('  Img,\n', '');

const remaining = (src.match(/<Img/g) || []).length;
console.log('Img tags remaining:', remaining);
console.log('Done - saving');
fs.writeFileSync('src/Video/AlienaPromoVideo.tsx', src, 'utf8');
