const fs = require('fs');
let src = fs.readFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', 'utf8');
const ok = [], miss = [];
function patch(label, old, neu) {
  if (src.includes(old)) { src = src.replace(old, neu); ok.push(label); }
  else miss.push(label);
}

// Gate collaboration banner in FP block - currently unconditional
patch('gate FP collaboration banner',
  '<ArtifactCollaborationBanner\n          readOnly={effectiveReadOnly}\n          approvalLocked={false}',
  '{showCollaborationBanner && <ArtifactCollaborationBanner\n          readOnly={effectiveReadOnly}\n          approvalLocked={false}');

// Close the conditional after the banner closing tag
patch('close FP banner conditional',
  'currentDraftRev={currentDraftRev}\n        />\n\n        <EditorStatusBar',
  'currentDraftRev={currentDraftRev}\n        />}\n\n        <EditorStatusBar');

// For FP: showOverlay should NOT show when approved (only when another editor has lock AND we are not in approved state)
patch('FP showOverlay fix',
  'const showOverlay = hasActiveOtherEditorLock;',
  'const showOverlay = hasActiveOtherEditorLock && !(isFinancialPlan && approvalStatusLower === "approved");');

fs.writeFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', src, 'utf8');
console.log('OK:', ok);
console.log('MISS:', miss);
