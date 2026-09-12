# Task Board — split the prototype with friends

Work is split into **4 parallel lanes**. Anything in different lanes can be
done at the same time by different people. Inside a lane, tasks are ordered —
a task starts only after its **Depends on** tasks are merged.

```
Lane 1 (REAL DATA)      Lane 2 (BACKEND)        Lane 3 (FRONTEND)       Lane 4 (QUALITY)
T1.1 port loader        T2.1 login API          T3.1 tab states         T4.1 CI workflow
T1.2 weather loader     T2.2 response models    T3.2 responsive pass    T4.2 Docker stack
      \                 T2.3 error handling     T3.3 edit shipment      T4.3 frontend tests
   T1.3 retrain+eval          \                       (all independent)     (all independent)
   (needs T1.1+T1.2)     T2.4 frontend login
                         (needs T2.1)
```

## Ground rules (read first)

1. **One branch per task** (`t11-port-loader`, `t21-login-api`, …), one PR per task.
2. **Merge order inside a lane matters** (T1.1 → T1.3). Across lanes, merge anytime.
3. **Hot files — coordinate before touching:** `frontend/src/App.jsx`,
   `frontend/src/components/Sidebar.jsx`, `frontend/src/styles.css`,
   `backend/app/api/routes.py`. If two tasks touch the same hot file, the
   second person rebases onto the first person's merged branch.
4. Every PR must keep `python -m pytest -m "not slow"` green and
   `npm run build` green.

---

## Lane 1 — Real data (backend)

Goal: replace synthetic inputs with real sources, retrain, compare metrics.

### T1.1 — Port-activity loader
- **Depends on:** nothing. **Files:** `backend/core/data/loaders.py`,
  `backend/core/pipeline.py`, `docs/MODELS.md`.
- Build a loader for the Kaggle *Global Daily Port Activity and Trade
  Estimates* CSV (24 chokepoints: daily transit calls + trade volumes) into
  the pipeline's feature frame (port congestion / turnaround features).
- **Done when:** `prepare_ml_dataset()` accepts a `--source real|synthetic`
  flag path (or equivalent), unit-tested with a 50-row fixture, docs updated.

### T1.2 — ERA5 weather loader
- **Depends on:** nothing. **Files:** `backend/core/data/loaders.py`,
  `backend/core/features/node_features.py`.
- Pull storm/wind features for corridor coordinates via the Copernicus CDS
  API (`cdsapi`), cache to `data/raw/era5_*.parquet`, wire into the
  `weather_*` feature family.
- **Done when:** loader + cache + one test with a tiny cached fixture (no live
  API call in tests), `.env.example` gains `CDS_API_KEY`, docs updated.

### T1.3 — Retrain + evaluate on real data
- **Depends on:** T1.1, T1.2 (both merged). **Files:** `artifacts/` (local),
  `docs/MODELS.md`.
- Run full train + eval on the real-data pipeline, record metrics next to the
  synthetic baseline (ROC-AUC, PR-AUC, MAE, coverage).
- **Done when:** `docs/MODELS.md` has a synthetic-vs-real comparison table and
  all tests still pass on the new artifacts.

---

## Lane 2 — Backend hardening

Goal: production-grade API (auth, contracts, errors). No ML changes.

### T2.1 — Login endpoint
- **Depends on:** nothing. **Files:** `backend/app/api/routes.py`,
  `backend/app/schemas/models.py`, `backend/tests/test_api.py`.
- `POST /api/v1/login {username, password}` → signed token (JWT via env
  secret, 12 h expiry); default `admin/admin123` from env vars
  (`AUTH_USER`, `AUTH_PASS`, `AUTH_SECRET` in `.env.example`).
- **Done when:** correct creds → 200 + token, wrong creds → 401, new tests
  cover both. (Frontend keeps its current gate until T2.4.)

### T2.2 — Response models
- **Depends on:** nothing. **Files:** `backend/app/api/routes.py`,
  `backend/app/schemas/models.py`, `backend/tests/test_api.py`.
- Wire the existing (unused) Pydantic response models
  (`GetShipmentResponse`, `ExplanationResponse`, `HealthResponse`) into the
  endpoints via `response_model=`, add any missing ones.
- **Done when:** `/docs` shows typed responses for all 17 endpoints and tests
  assert response shapes.

### T2.3 — Error handling + request logging
- **Depends on:** nothing. **Files:** `backend/app/main.py`,
  `backend/core/logging_util.py`.
- Global exception handler returning uniform `{error, code}` JSON (no raw
  tracebacks to clients), request-id per call, 4xx/5xx log levels.
- **Done when:** forced 404/500 return the uniform shape; logs carry
  request-ids; tests cover both.

### T2.4 — Frontend uses backend login
- **Depends on:** T2.1 (merged). **Files:** `frontend/src/auth.js`,
  `frontend/src/api.js`, `frontend/src/pages/LoginView.jsx`.
- Replace client-side `validate()` with a call to `POST /login`; store the
  token, attach `Authorization: Bearer` on every API call, logout clears it.
- **Done when:** login works against the real backend, wrong password shows
  the error banner, refresh keeps the session, logout clears it.

---

## Lane 3 — Frontend UX

Goal: every tab handles loading/empty/error + small screens. Pure UI work —
no backend changes, safe to parallelise freely.

### T3.1 — Tab states (loading / empty / error)
- **Depends on:** nothing. **Files:** the 11 files in `frontend/src/pages/`,
  `frontend/src/styles.css`.
- Each tab today assumes data is present. Add: skeleton/spinner while
  `loading`, friendly empty copy when no shipment/data, error banner passthrough.
- **Done when:** with backend stopped, every tab shows a clean error/empty
  state instead of blanks or crashes (check all 11 tabs).

### T3.2 — Responsive pass
- **Depends on:** nothing. **Files:** `frontend/src/styles.css`,
  `frontend/src/components/RouteMap.jsx`.
- Sidebar already collapses under 768 px. Fix what breaks on narrow screens:
  KPI grid, tables (horizontal scroll), map aspect, forms, header controls.
- **Done when:** all 11 tabs usable at 390 px wide (phone) with no overlap or
  clipped controls; screenshots in the PR.

### T3.3 — Edit shipment
- **Depends on:** nothing. **Files:** `frontend/src/pages/ShipmentsView.jsx`,
  `frontend/src/shipments.js`.
- The registry has Add + Delete; add **Edit** (prefill the same form,
  keep the ID immutable, persist to localStorage).
- **Done when:** editing any field (except ID) updates the detail card,
  registry table and header dropdown after save.

---

## Lane 4 — Quality & automation

Goal: onboarding in minutes and green builds on every PR. All independent.

### T4.1 — CI workflow
- **Depends on:** nothing. **Files:** `.github/workflows/ci.yml` (new).
- GitHub Actions: Python 3.11 + Node 24 jobs running `pytest -m "not slow"`
  and `npm run build` on every push/PR.
- **Done when:** the workflow file is merged and shows green on its own PR.

### T4.2 — ~~Docker one-command stack~~ DROPPED (project decision: no Docker)
- **Depends on:** nothing. **Files:** `backend/Dockerfile`,
  `frontend/Dockerfile`, `docker-compose.yml` (new), `README.md`.
- `docker compose up` starts API (:8000) + dashboard (:5173, pointed at the
  API). New-friend onboarding target: under 10 minutes, documented in README.
- **Done when:** fresh clone → `docker compose up` → login → prediction
  renders, verified by a second person on their machine.

### T4.3 — Frontend tests
- **Depends on:** nothing. **Files:** `frontend/` (Vitest setup),
  `frontend/src/shipments.test.js`, `frontend/src/auth.test.js` (new).
- Repo has zero frontend tests. Set up Vitest, cover the pure logic first:
  shipment store (add/delete/persist/seed) and auth validate/session.
- **Done when:** `npm test` runs in CI (extend T4.1's workflow) with the store
  + auth suites green.

---

## Suggested splits

| People | Split |
|---|---|
| 2 | P1: Lane 1 · P2: Lane 2 → then both swarm Lanes 3–4 |
| 3 | P1: Lane 1 · P2: Lane 2 · P3: Lanes 3 + 4 |
| 4 | One lane each |

Start with **T4.1 (CI) + T4.2 (Docker)** in the first wave regardless of split —
everything after that gets easier to review and test.
