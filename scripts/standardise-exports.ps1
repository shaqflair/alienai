param(
  [switch]$DryRun = $true
)

$ErrorActionPreference = "Stop"

function Say([string]$msg) { Write-Host $msg }

function RunStep([string]$msg, [scriptblock]$action) {
  if ($DryRun) {
    Say "DRYRUN: $msg"
  } else {
    Say $msg
    & $action
  }
}

function FirstExistingPath([string[]]$paths) {
  foreach ($p in $paths) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

# Repo root = current directory (run from C:\dev\alienai)
$root = (Get-Location).Path

$srcExports = Join-Path $root "src\lib\exports"
$sharedDir  = Join-Path $srcExports "_shared"
$charterDir = Join-Path $srcExports "charter"

Say ""
Say "=== Standardise exports ==="
Say "Root:   $root"
Say "DryRun: $DryRun"
Say ""

# Ensure folders exist
RunStep "Ensure src\lib\exports exists" { New-Item -ItemType Directory -Force -Path $srcExports | Out-Null }
RunStep "Ensure src\lib\exports\_shared exists" { New-Item -ItemType Directory -Force -Path $sharedDir  | Out-Null }
RunStep "Ensure src\lib\exports\charter exists" { New-Item -ItemType Directory -Force -Path $charterDir | Out-Null }

# Shared helper: fileResponse.ts
$sharedFileResponse = Join-Path $sharedDir "fileResponse.ts"
if (-not (Test-Path $sharedFileResponse)) {
  $content = @"
import { NextResponse } from "next/server";

export function fileResponse(buffer: Buffer, filename: string, contentType: string) {
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
"@
  RunStep "Create _shared\fileResponse.ts" { Set-Content -Path $sharedFileResponse -Value $content -Encoding UTF8 }
} else {
  Say "OK: _shared\fileResponse.ts exists"
}

# -------------------------------------------------------------------
# Charter migration
# Your repo (per screenshot) has:
#   src\lib\exports\charter\exportCharterDocx.ts
#   src\lib\exports\charter\exportCharterPdf.ts
# But we also support the old root-level locations if they exist.
# -------------------------------------------------------------------

$legacyPdfCandidates = @(
  (Join-Path $srcExports "exportCharterPdf.ts"),
  (Join-Path $charterDir "exportCharterPdf.ts")
)

$legacyDocxCandidates = @(
  (Join-Path $srcExports "exportCharterDocx.ts"),
  (Join-Path $charterDir "exportCharterDocx.ts")
)

$legacyCharterPdf  = FirstExistingPath $legacyPdfCandidates
$legacyCharterDocx = FirstExistingPath $legacyDocxCandidates

$charterPdfNew  = Join-Path $charterDir "pdf.ts"
$charterDocxNew = Join-Path $charterDir "docx.ts"
$charterIndex   = Join-Path $charterDir "index.ts"

# Copy implementation into charter/pdf.ts (only if pdf.ts missing)
if ($legacyCharterPdf) {
  RunStep "Copy legacy Charter PDF -> charter\pdf.ts (if missing)" {
    if (-not (Test-Path $charterPdfNew)) { Copy-Item $legacyCharterPdf $charterPdfNew -Force }
  }

  # Rewrite legacy file as wrapper re-export (keeps existing imports working)
  $wrapperPdf = @"
export * from "@/lib/exports/charter/pdf";
"@
  RunStep "Rewrite legacy Charter PDF file as wrapper ($legacyCharterPdf)" {
    Set-Content -Path $legacyCharterPdf -Value $wrapperPdf -Encoding UTF8
  }
} else {
  Say "WARN: Charter PDF legacy file not found. Looked for:"
  $legacyPdfCandidates | ForEach-Object { Say " - $_" }
}

# Copy implementation into charter/docx.ts (only if docx.ts missing)
if ($legacyCharterDocx) {
  RunStep "Copy legacy Charter DOCX -> charter\docx.ts (if missing)" {
    if (-not (Test-Path $charterDocxNew)) { Copy-Item $legacyCharterDocx $charterDocxNew -Force }
  }

  # Rewrite legacy file as wrapper re-export
  $wrapperDocx = @"
export * from "@/lib/exports/charter/docx";
"@
  RunStep "Rewrite legacy Charter DOCX file as wrapper ($legacyCharterDocx)" {
    Set-Content -Path $legacyCharterDocx -Value $wrapperDocx -Encoding UTF8
  }
} else {
  Say "WARN: Charter DOCX legacy file not found. Looked for:"
  $legacyDocxCandidates | ForEach-Object { Say " - $_" }
}

# Write charter barrel
$indexContent = @"
export * from "./pdf";
export * from "./docx";
"@
RunStep "Write charter\index.ts barrel" { Set-Content -Path $charterIndex -Value $indexContent -Encoding UTF8 }

Say ""
Say "Done."
Say ""
Say "Next:"
Say "1) Confirm src\lib\exports\charter\pdf.ts + docx.ts exist."
Say "2) Update Charter API routes to import from '@/lib/exports/charter'."
Say ""
