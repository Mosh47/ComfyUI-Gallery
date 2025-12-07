# Navigate to the custom node folder
Set-Location "c:\Users\micha\OneDrive\Documents\ComfyUI\custom_nodes\ComfyUI-GalleryGood"

# Check if .git exists, if not initialize
if (-not (Test-Path ".git")) {
    Write-Host "Initializing git repository..."
    git init
    git remote add origin https://github.com/Mosh47/ComfyUI-Gallery.git
}

# Show current status
Write-Host "`n=== Current Status ===" -ForegroundColor Cyan
git status

# Stage all changes
Write-Host "`n=== Staging Changes ===" -ForegroundColor Cyan
git add -A

# Show what will be committed
Write-Host "`n=== Files to Commit ===" -ForegroundColor Cyan
git status --short

# Commit
Write-Host "`n=== Committing ===" -ForegroundColor Cyan
git commit -m "feat: High-performance search, folder deletion fix, README update"

# Push (force to overwrite)
Write-Host "`n=== Pushing to GitHub ===" -ForegroundColor Cyan
git branch -M main
git push -u origin main --force

Write-Host "`n=== Done! ===" -ForegroundColor Green
