$ErrorActionPreference = "Stop"

$branch = "master"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$commitMessage = "build: update site output $timestamp"

Write-Host "Building the latest version..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
  throw "Build failed. Push cancelled."
}

Write-Host "Staging updated files..." -ForegroundColor Cyan
git add .

$pendingChanges = git status --porcelain

if (-not $pendingChanges) {
  Write-Host "No changes found after build. Nothing to commit or push." -ForegroundColor Yellow
  exit 0
}

Write-Host "Creating commit..." -ForegroundColor Cyan
git commit -m $commitMessage

if ($LASTEXITCODE -ne 0) {
  throw "Commit failed. Push cancelled."
}

Write-Host "Pushing to $branch..." -ForegroundColor Cyan
git push origin $branch

if ($LASTEXITCODE -ne 0) {
  throw "Push failed."
}

Write-Host "Build and push completed successfully." -ForegroundColor Green
