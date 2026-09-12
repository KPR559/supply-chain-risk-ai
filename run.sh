#!/usr/bin/env bash
# Frankfurt -> India Shipment Delay Prediction - dev runner (macOS / Linux)
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Installing python deps"
pip install -r requirements.txt -q

echo "==> Generating data + training + evaluating"
python -m backend.core.train --generate-only
python -m backend.core.train --train-only
python -m backend.core.train --eval-only

echo "==> Running tests"
python -m pytest -q

if [ ! -d frontend/node_modules ]; then
    echo "==> Installing frontend deps"
    (cd frontend && npm install --no-audit --no-fund)
fi

echo "==> Starting API on http://127.0.0.1:8000"
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
API_PID=$!

echo "==> Starting dashboard on http://127.0.0.1:5173"
(cd frontend && npx vite --host 127.0.0.1 --port 5173) &
WEB_PID=$!

trap "kill $API_PID $WEB_PID 2>/dev/null || true" EXIT
echo "Dashboard: http://127.0.0.1:5173  API docs: http://127.0.0.1:8000/docs"
wait