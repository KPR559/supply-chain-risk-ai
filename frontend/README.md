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
| `src/auth.js` | demo login gate (default creds + localStorage session) |
| `src/shipments.js` | shipment registry store (seed records + localStorage) |
| `src/pages/` \| 11 feature tabs, one per feature: Prediction Results, Route Map, Checkpoint Risk, Shipment Status, ETA Distribution, Deadline Risk, Critical Checkpoints, Risk Contributors, What-if Simulator, Route Comparison, Charts & Graphs
| `src/components/` \| 16 reusable components (route map, percentile chart, what-if panel, explanation bars...)
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

## Auth

Sign-in is verified by the backend (`POST /api/v1/login`) against the DuckDB
`users` table — passwords are PBKDF2-hashed, sessions are opaque bearer tokens
(12 h expiry) kept in the `sessions` table. The client stores only the token
(`localStorage` when "Keep me signed in" is checked, `sessionStorage`
otherwise) and re-validates it via `GET /api/v1/me` on startup; logout calls
`POST /api/v1/logout` and clears it. The form has **Sign in** and
**Create account** tabs — registration (`POST /api/v1/register`) validates
the username/password server-side and signs the new user straight in.
Default credentials:

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `admin123` |

Change them with `AUTH_USER` / `AUTH_PASS` in `.env` (seeded on first login).
Existing data endpoints currently stay open — login gates the UI, not the API.

## Shipments registry

The Shipments view keeps one independent record per shipment (ID, origin,
destination, type, transport mode, departure / expected-arrival / required
dates, priority, current location, status, plus the corridor route used for
prediction). The header's Shipment ID dropdown switches between records;
**+ Add shipment** creates a new one (ID must be unique), **Edit** modifies any
record in place (ID is immutable), Delete removes it.
Records are **isolated per account** (`scm.shipments.v1.<username>` in
`localStorage`, `src/shipments.js`) — switching accounts reloads that
account's own registry, so one user's edits never leak into another's.
A pre-existing shared registry is adopted once by whoever signs in first.

## Tab states

Every tab renders through a shared `TabState` component (`src/components/TabState.jsx`):
spinner while the engine loads, an error banner with **Retry** when the API is
unreachable, and a friendly empty notice when there is nothing to show yet.
`App.jsx` passes `loading`, `apiError` and `onRetry` to all views via `data` —
with the backend stopped, no tab ever shows a blank screen or crashes.

## Responsive

The sidebar hides at ≤ 768 px and a sticky `MobileNav` chip bar
(`src/components/MobileNav.jsx`) takes over navigation + logout. Below that
breakpoint tables scroll horizontally, the header controls stack full-width,
and padding/KPI type scale down (480 px tune). Verify phone-width (390 px) by
resizing — all 11 tabs must work with no overlap or clipped controls.

## Deadline risk

Each prediction sends the selected shipment's Required Delivery Date as
`deadline_date`. The Overview shows a **Deadline Miss Risk** KPI card (share
of Monte Carlo runs arriving after the required date), and the Shipments view
repeats it next to the required date. Shipments without a required date show
"—" / "No deadline set".

Production build inlines `VITE_API_BASE=https://shipment-delay-dashboard.vercel.app/api/v1`
(see `docs/DEPLOYMENT.md`).

## Deploy

Separate Vercel project (`shipment-delay-frontend`) with the static-build
preset: `npm run build`, output `dist/`. Redeploy after changing `VITE_API_BASE`:

```bash
vercel --prod --yes   # from frontend/
```
