# Launch OpenWA WhatsApp Gateway
$env:Path = "C:\Users\manga\tools\node;" + $env:Path
Set-Location -Path "$PSScriptRoot\openwa"
Write-Host "Starting OpenWA Gateway on http://localhost:2785 ..." -ForegroundColor Green
node dist/main.js
