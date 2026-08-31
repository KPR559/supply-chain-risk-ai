# Frankfurt -> India Shipment Delay Prediction - dev runner (Windows)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "==> Installing python deps"
pip install -r requirements.txt -q

Write-Host "==> Generating data + training + evaluating"
python -m core.train --generate-only
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python -m core.train --train-only
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python -m core.train --eval-only
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Running tests"
python -m pytest -q

Write-Host "==> Building frontend (if dependencies missing, run npm install first)"
if (-not (Test-Path "$root\frontend\node_modules")) {
    Push-Location "$root\frontend"
    npm install --no-audit --no-fund
    Pop-Location
}

Write-Host "==> Starting API on http://127.0.0.1:8000"
$api = Start-Process python -ArgumentList "-m","uvicorn","backend.main:app","--host","127.0.0.1","--port","8000" -WorkingDirectory $root -PassThru -WindowStyle Hidden

Write-Host "==> Starting dashboard on http://127.0.0.1:5173"
$vite = "$root\frontend\node_modules\.bin\vite.cmd"
$web = Start-Process cmd -ArgumentList "/c","`"$vite`" --host 127.0.0.1 --port 5173" -WorkingDirectory "$root\frontend" -PassThru -WindowStyle Hidden

Write-Host "Dashboard: http://127.0.0.1:5173  API docs: http://127.0.0.1:8000/docs"
Write-Host "Press Ctrl+C to stop. (PIDs: API $($api.Id), web $($web.Id))"

try {
    while ($true) { Start-Sleep -Seconds 5 }
} finally {
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue
}