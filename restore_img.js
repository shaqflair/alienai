const fs = require('fs');
let src = fs.readFileSync('src/Video/AlienaPromoVideo.tsx', 'utf8');

// Restore Img import
if (!src.includes('  Img,')) {
  src = src.replace('  AbsoluteFill,', '  AbsoluteFill,\n  Img,');
}

// Restore ScreenshotScene Img
src = src.replace(
  '<div style={{ width: "100%", height: "100%", background: "#1E2D45", display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ color: "#5A7090", fontSize: 20, fontFamily: "system-ui" }}>Screenshot placeholder</div></div>',
  '<Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "left top" }}/>'
);

// Restore applyBudget Img — find the placeholder div and replace
src = src.replace(
  /<AbsoluteFill style=\{\{\s*opacity: ease\(lf, 0, 1\)[^}]*\}\}>\s*<div style=\{\{ width: "100%", height: "100%", background: "#1E2D45" \}\}\/>/,
  `<AbsoluteFill style={{ opacity: ease(lf, 0, 1), transform: \`scale(\${0.96 + ease(lf, 0, 3) * 0.04})\` }}>
                <Img src={staticFile(imgSrc)} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>`
);

// Restore platform montage Img
src = src.replace(
  /<AbsoluteFill style=\{\{\s*opacity: ease\(segFrame, 0, 0\.5\)[^}]*\}\}>\s*<div style=\{\{ width: "100%", height: "100%", background: "#1E2D45" \}\}\/>/,
  `<AbsoluteFill style={{ opacity: ease(segFrame, 0, 0.5), transform: \`scale(\${0.96 + ease(segFrame, 0, 2) * 0.04})\` }}>
                <Img src={staticFile(sc.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>`
);

const imgCount = (src.match(/<Img/g) || []).length;
console.log('Img tags restored:', imgCount, '(should be 3)');
fs.writeFileSync('src/Video/AlienaPromoVideo.tsx', src, 'utf8');
