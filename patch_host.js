const fs = require('fs');
let src = fs.readFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', 'utf8');
const ok = [], miss = [];
function patch(label, old, neu) {
  if (src.includes(old)) { src = src.replace(old, neu); ok.push(label); }
  else miss.push(label);
}

// 1. Fix effectiveReadOnly — approved should NOT lock the whole plan
patch('effectiveReadOnly',
  'const effectiveReadOnly = isFinancialPlan\n    ? approvalStatusIsTerminal || (!isEditable && !isApproverReviewMode)',
  'const effectiveReadOnly = isFinancialPlan\n    ? (isInApprovalReviewState && !isApproverReviewMode) ||\n      approvalStatusLower === "rejected" ||\n      (!isEditable && !isApproverReviewMode)');

// 2. Fix budgetLocked — lock when in review OR approved (not just when fpApprovalLocked)
patch('budgetLocked prop',
  'budgetLocked={fpApprovalLocked && !isApproverReviewMode}',
  'budgetLocked={\n              (isInApprovalReviewState && !isApproverReviewMode) ||\n              approvalStatusLower === "approved"\n            }');

// 3. Fix "In approval" banner — only show during active review, not when approved
patch('In approval banner condition',
  '{fpApprovalLocked && (\n          <div>\n            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm mb-2">',
  '{fpApprovalLocked && isInApprovalReviewState && (\n          <div>\n            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm mb-2">');

// 4. Fix EditorStatusBar approved text
patch('approved status text',
  'stateText = "Approved — locked";',
  'stateText = isFinancialPlan ? "Approved — budget locked (amend via CR)" : "Approved — locked";');

// 5. Add approved-but-editable banner for financial plans
patch('approved FP banner',
  '{fpApprovalLocked && isInApprovalReviewState && (\n          <div>',
  `{approvalStatusLower === "approved" && isEditable && isFinancialPlan && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm" style={{ marginBottom: 8 }}>
            <div className="font-semibold text-emerald-800">✓ Financial Plan approved</div>
            <div className="mt-1 text-emerald-700">
              The plan is approved and baselined. Cost lines, resources, and monthly phasing remain editable.
              The <strong>Approved Budget</strong> field is locked — raise a Change Request to amend it.
            </div>
          </div>
        )}
        {fpApprovalLocked && isInApprovalReviewState && (
          <div>`);

fs.writeFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', src, 'utf8');
console.log('OK:', ok);
console.log('MISS:', miss);
