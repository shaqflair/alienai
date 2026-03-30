const fs = require('fs');
let src = fs.readFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', 'utf8');
const ok = [], miss = [];
function patch(label, old, neu) {
  if (src.includes(old)) { src = src.replace(old, neu); ok.push(label); }
  else miss.push(label);
}

// 1. Add isInApprovalReviewState + isApproverReviewMode + fpApprovalLocked variables
patch('add FP variables',
  'const approvalStatusIsTerminal =\n    approvalStatusLower === "approved" || approvalStatusLower === "rejected";',
  'const approvalStatusIsTerminal =\n    approvalStatusLower === "approved" || approvalStatusLower === "rejected";\n\n  const isInApprovalReviewState =\n    approvalStatusLower === "submitted" ||\n    approvalStatusLower === "submitted_for_approval" ||\n    approvalStatusLower === "pending_approval" ||\n    approvalStatusLower === "in_review" ||\n    approvalStatusLower === "awaiting_approval";\n\n  const isApproverReviewMode =\n    !!isApprover && !!approvalEnabled && isInApprovalReviewState && !approvalStatusIsTerminal;\n\n  const fpApprovalLocked = isFinancialPlan && isApprovalLockedStatus(approvalStatus);');

// 2. Fix effectiveReadOnly for financial plan
patch('effectiveReadOnly',
  'const effectiveReadOnly = isFinancialPlan\n    ? !isEditable || lockLayout || collaboration.isReadOnly || approvalStatusIsTerminal',
  'const effectiveReadOnly = isFinancialPlan\n    ? (isInApprovalReviewState && !isApproverReviewMode) ||\n      approvalStatusLower === "rejected" ||\n      (!isEditable && !isApproverReviewMode)');

// 3. Fix budgetLocked prop at the FinancialPlanEditorHost call site
patch('budgetLocked prop',
  'readOnly={effectiveReadOnly}\n        budgetLocked={budgetLocked}',
  'readOnly={effectiveReadOnly && !isApproverReviewMode}\n        budgetLocked={\n          (isInApprovalReviewState && !isApproverReviewMode) ||\n          approvalStatusLower === "approved"\n        }');

// 4. Fix EditorStatusBar approved text
patch('approved status text',
  'stateText = "Approved — locked";',
  'stateText = isFinancialPlan ? "Approved — budget locked (amend via CR)" : "Approved — locked";');

// 5. Add approved FP banner + gate "In approval" banner to review state only
// Find the isFinancialPlan return block and add banners
patch('FP approved banner + gate in-approval',
  '{fpApprovalLocked && (',
  '{approvalStatusLower === "approved" && isFinancialPlan && (\n          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm">\n            <div className="font-semibold text-emerald-800">\u2713 Financial Plan approved</div>\n            <div className="mt-1 text-emerald-700">The plan is approved and baselined. Cost lines, resources, and monthly phasing remain editable. The <strong>Approved Budget</strong> field is locked \u2014 raise a Change Request to amend it.</div>\n          </div>\n        )}\n        {fpApprovalLocked && isInApprovalReviewState && (');

fs.writeFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', src, 'utf8');
console.log('OK:', ok);
console.log('MISS:', miss);
