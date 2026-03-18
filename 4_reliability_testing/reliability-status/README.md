# Reliability Status App

Mobile-first web app for reliability monitoring that:

- continuously polls Firestore from the deployed firmware data source
- stores packets locally in SQLite
- shows latest status + elapsed timers for researchers
- renders trend graphs from server-side aggregated buckets (no raw full-history download)
- protects access with session-based authentication
- provides CSV exports for readings and chart aggregates
- computes anomaly flags for packet cadence and heartbeat freshness

## Stack

- Docker Compose
- Bun runtime (backend and frontend build)
- Vite + React + TypeScript + TailwindCSS (frontend)
- SQLite (backend persistence)

## Firestore Source

The backend defaults are aligned with the deployed firmware in the reliability test sketch:

- project: `panahon-live`
- API key: same key from firmware
- station: `reliability_station_1`
- collection: `readings`
- heartbeat doc: `heartbeats/reliability_station_1`

On first boot with an empty database, the app ingests only the **latest** reading and then tails newer readings, preventing old historical backfill.

## Run with Docker

From this folder:

```bash
docker compose up -d --build
```

For Dokploy/VPS deployment, set these environment variables in your app settings:

- `AUTH_PASSWORD` (required, strong password)
- `SESSION_SECRET` (required, long random secret)
- `AUTH_USERNAME` (optional, default `researcher`)
- `COOKIE_SECURE` (use `true` on HTTPS)
- `EXPECTED_PACKET_INTERVAL_SEC` (default `60`)
- `PACKET_TOLERANCE_SEC` (default `25`)
- `MAX_CSV_ROWS` (default `50000`)

Open:

- Web UI (Dokploy domain): `https://<your-domain>`

Notes for Dokploy + Cloudflare:

- This compose file does not publish a host port for frontend; traffic should come through Dokploy's reverse proxy.
- Use the `frontend` service as the public service in Dokploy.
- Cloudflare commonly proxies standard HTTP/HTTPS ports; avoiding custom origin ports prevents 404/hanging behavior caused by edge routing.

## Local Development

### Backend

```bash
cd backend
bun install
bun run dev
```

Run backend smoke tests:

```bash
bun run test
```

### Frontend

```bash
cd frontend
bun install
bun run dev
```

## API Summary

Access model:

- Public: `/api/health`, `/api/auth/session`, `/api/latest`, `/api/charts`
- Auth required: `/api/export/readings.csv`, `/api/export/charts.csv`, `/api/auth/logout`

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/latest`
  - latest packet fields
  - packet timestamp and packet age
  - backend receive timestamp and elapsed since receive
  - latest heartbeat snapshot
  - anomaly flags:
    - `packet_stale`
    - `long_packet_gap`
    - `cadence_irregular`
    - `heartbeat_stale`
  - `heartbeatSingleDocMode: true` because firmware updates one heartbeat document instead of inserting new rows
- `GET /api/charts?hours=24&bucketMinutes=5`
  - pre-aggregated per-metric series for `t`, `h`, `bv`, `bi`, `soc`, `ir`
  - each point includes `avg`, `min`, `max` per bucket
- `GET /api/export/readings.csv?hours=24`
- `GET /api/export/charts.csv?hours=24&bucketMinutes=5`

Troubleshooting ingestion:

- Open `/api/health` and check `poller.lastError` and `poller.lastSuccessAt`.
- If `readingsStored` stays `0` and `lastError` is non-null, the backend cannot pull Firestore from your deployment environment.
- Common causes: blocked outbound DNS/HTTPS from VPS container network, missing/overridden `FIREBASE_API_KEY`, or wrong `FIREBASE_PROJECT_ID`.

## Persistence

SQLite DB path in container: `/data/reliability.db`

Docker volume name: `sqlite_data`

## Internal Architecture

- Frontend
  - API transport: `frontend/src/lib/http.ts`
  - API endpoints: `frontend/src/api/reliabilityApi.ts`
  - Dashboard state/polling orchestration: `frontend/src/hooks/useReliabilityDashboard.ts`
  - Presentation shell: `frontend/src/App.tsx`
- Backend
  - App router entry: `backend/src/app.ts`
  - Public routes: `backend/src/routes/publicRoutes.ts`
  - Session-protected routes: `backend/src/routes/protectedRoutes.ts`
  - Payload/CSV builders: `backend/src/services/payloads.ts`
  - HTTP response helpers: `backend/src/http.ts`
