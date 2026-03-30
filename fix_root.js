const fs = require('fs');
const content = `import React from "react";
import { Composition } from "remotion";
import { registerRoot } from "remotion";
import { AlienaPromo90 } from "./Video/AlienaPromoVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AlienaPromo90"
        component={AlienaPromo90}
        durationInFrames={2700}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

registerRoot(RemotionRoot);
`;
fs.writeFileSync('src/Root.tsx', content, 'utf8');
console.log('Done');
