# scripts/pdf-puppeteer-setup.ps1
# Local Windows setup for Puppeteer PDF export (Chrome/Edge).
# Run from repo root:  powershell -ExecutionPolicy Bypass -File .\scripts\pdf-puppeteer-setup.ps1

$ErrorActionPreference = "Stop"

Write-Host "== Installing PDF dependencies (puppeteer-core + sparticuz) ==" -ForegroundColor Cyan
npm i puppeteer-core @sparticuz/chromium

Write-Host ""
Write-Host "== Optional: full puppeteer (downloads Chromium) ==" -ForegroundColor Cyan
Write-Host "If you prefer full puppeteer (larger install), run:" -ForegroundColor Yellow
Write-Host "  npm i puppeteer" -ForegroundColor Yellow

Write-Host ""
Write-Host "== Detecting local browsers ==" -ForegroundColor Cyan

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (!(Test-Path $edge)) { $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" }

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (!(Test-Path $chrome)) { $chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" }

Write-Host "Edge  : $edge" -ForegroundColor Gray
Write-Host "Chrome: $chrome" -ForegroundColor Gray

Write-Host ""
Write-Host "== Add ONE of these to your .env.local ==" -ForegroundColor Cyan

if (Test-Path $edge) {
  Write-Host "PUPPETEER_EXECUTABLE_PATH=$edge" -ForegroundColor Green
}
if (Test-Path $chrome) {
  Write-Host "PUPPETEER_EXECUTABLE_PATH=$chrome" -ForegroundColor Green
}

Write-Host ""
Write-Host "Alternative (use full puppeteer):" -ForegroundColor Yellow
Write-Host "PDF_USE_FULL_PUPPETEER=true" -ForegroundColor Yellow

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
