# Frontend — Shipment Delay Dashboard (React)

React 18 + Vite single-page dashboard for the Frankfurt → India corridor:
route map, risk views, ETA percentiles, what-if simulator, explanations,
reports and data-source health.

Live: <https://shipment-delay-frontend.vercel.app>

## Tech

- React 18, Vite 5, plain CSS (`src/styles.css`, dark "LOGIX" theme)
- No UI framework; SVG-based map and charts

## Layout

| Path | Purpose |
|---|---|
| `index.html` | SPA entry |
| `vite.config.js` | dev server on `:5173`, proxies `/api` → `127.0.0.1:8000` |
| `src/main.jsx` | React root |
| `src/App.jsx` | shell: view switcher, route/shipment selection, global state |
| `src/api.js` | API client over `/api/v1` (base from `VITE_API_BASE`) |
| `src/pages/` | 10 views: Overview, Route Map, Risk Radar, Simulator, Shipments, Alerts, Analytics, Reports, Data Sources, Settings |
| `src/components/` | 17 reusable components (RouteMap, PercentileChart, WhatIfPanel, Explanation, …) |
| `src/utils/helpers.js` | risk thresholds/colors, formatting, resilience score |

## Run

```bash
cd frontend
npm install
npm run dev      # http://127.0.0.1:5173 (needs backend on :8000)
npm run build    # production build -> dist/
```

## Env

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE` | backend base URL (build-time) | `/api/v1` (dev proxy) |

Production build inlines `VITE_API_BASE=https://shipment-delay-dashboard.vercel.app/api/v1`
(see `docs/DEPLOYMENT.md`).

## Deploy

Separate Vercel project (`shipment-delay-frontend`) with the static-build
preset: `npm run build`, output `dist/`. Redeploy after changing `VITE_API_BASE`:

```bash
vercel --prod --yes   # from frontend/
```
