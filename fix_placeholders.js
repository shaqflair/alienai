const fs = require('fs');
let src = fs.readFileSync('src/Video/AlienaPromoVideo.tsx', 'utf8');

// Replace Img in ScreenshotScene with a placeholder div
src = src.replace(
  `<Img
          src={staticFile(src)}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "left top" }}
        />`,
  `<div style={{ width: "100%", height: "100%", background: "#1E2D45", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "#5A7090", fontSize: 24, fontFamily: "system-ui" }}>{src}</div>
        </div>`
);

// Replace Img in applyBudget scene
src = src.replace(
  `<Img
                  src={staticFile(imgSrc)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />`,
  `<div style={{ width: "100%", height: "100%", background: "#1E2D45" }}/>`
);

// Replace Img in platform montage scene
src = src.replace(
  `<Img
                  src={staticFile(sc.src)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />`,
  `<div style={{ width: "100%", height: "100%", background: "#1E2D45" }}/>`
);

fs.writeFileSync('src/Video/AlienaPromoVideo.tsx', src, 'utf8');
console.log('Done');
