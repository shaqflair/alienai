const fs = require('fs');
let src = fs.readFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', 'utf8');
const ok = [], miss = [];
function patch(label, old, neu) {
  if (src.includes(old)) { src = src.replace(old, neu); ok.push(label); }
  else miss.push(label);
}

// 1. Fix readOnly and budgetLocked on FinancialPlanEditorHost
patch('budgetLocked + readOnly props',
  'readOnly={effectiveReadOnly}\n            budgetLocked={approvalLocked}',
  'readOnly={effectiveReadOnly && !isApproverReviewMode}\n            budgetLocked={\n              (isInApprovalReviewState && !isApproverReviewMode) ||\n              approvalStatusLower === "approved"\n            }');

// 2. Add isApproverReviewMode to EditorStatusBar
patch('EditorStatusBar isApproverReviewMode',
  'isFinancialPlan={true}\n        />',
  'isFinancialPlan={true}\n          isApproverReviewMode={isApproverReviewMode}\n        />');

// 3. Add approved banner + in-approval banner before the editor div
patch('approved banner + in-approval banner',
  '<div className="relative w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">\n          <FinancialPlanEditorHost',
  `{approvalStatusLower === "approved" && isFinancialPlan && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm">
            <div className="font-semibold text-emerald-800">\u2713 Financial Plan approved</div>
            <div className="mt-1 text-emerald-700">The plan is approved and baselined. Cost lines, resources, and monthly phasing remain editable. The <strong>Approved Budget</strong> field is locked \u2014 raise a Change Request to amend it.</div>
          </div>
        )}
        {fpApprovalLocked && isInApprovalReviewState && (
          <div>
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm mb-2">
              <span className="font-semibold text-blue-800">{isApproverReviewMode ? "In approval \u2014 review enabled" : "In approval"}</span>
              <span className="text-blue-700"> \u2014 this financial plan has been submitted for approval.{isApproverReviewMode ? " Content is readable for review." : " The approved budget field is locked."}</span>
            </div>
          </div>
        )}
        <div className="relative w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <FinancialPlanEditorHost`);

fs.writeFileSync('src/components/artifacts/ArtifactDetailClientHost.tsx', src, 'utf8');
console.log('OK:', ok);
console.log('MISS:', miss);
