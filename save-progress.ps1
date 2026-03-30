$ErrorActionPreference = "Stop"
Set-Location "C:\Users\User\Desktop\AI-ORCHESTRA"

git add -A
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "chore: auto-save $timestamp" --allow-empty
git push origin main

Write-Output "✅ GitHub 저장 완료: $timestamp"
