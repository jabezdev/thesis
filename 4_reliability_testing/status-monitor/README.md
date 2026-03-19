# Reliability Status Monitor

This folder contains two Dockerized apps:

- `backend/`: a Bun service that loads Firestore readings, listens for new readings and heartbeat updates, computes a status report, stores heartbeat history locally, and publishes the current state to Firebase Realtime Database.
- `frontend/`: a Vite React SPA that subscribes directly to Realtime Database and renders the live dashboard.

## Data Flow

1. The Bun service reads every document currently available in Firestore.
2. It subscribes to the `readings` collection and the overwrite-style heartbeat document.
3. It computes the report and writes it to Realtime Database under `status/current`.
4. It also publishes the stored heartbeat history under `status/heartbeat-history`.
5. The SPA reads Realtime Database only. It does not talk to the Bun service.

## What The Dashboard Shows

- total packet count
- estimated packet loss and other discrepancies
- the latest packet and elapsed time since it arrived
- simplified charts for temperature, humidity, battery voltage, battery current, state of charge, and internal resistance
- the latest heartbeat and a local heartbeat history view

The monitor infers the sampling interval from the Firestore sample timestamps and only falls back to the configured default when the dataset is too small to estimate a stable interval.

## Required Environment Variables

Copy `.env.example` to `.env` and fill in the values for your Firebase project.

Backend requirements:

- `FIREBASE_PROJECT_ID` must be set (for example `panahon-live`).
- Set one credential source: `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`, `FIREBASE_SERVICE_ACCOUNT_JSON`, or `FIREBASE_SERVICE_ACCOUNT_PATH` (mounted JSON file).
- If the service account file path is configured but the file is not mounted, backend falls back to application default credentials, which usually fails in local Docker unless `FIREBASE_PROJECT_ID` and valid ADC are available.

Dokploy (no file secret upload support):

- Generate one-line base64 from your service account JSON locally:
	- `base64 -w 0 firebase-service-account.json` (Linux)
	- `base64 firebase-service-account.json | tr -d '\n'` (macOS)
- Set Dokploy environment variables for backend:
	- `FIREBASE_PROJECT_ID=panahon-live`
	- `FIREBASE_DATABASE_URL=<your rtdb url>`
	- `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=<output from command above>`
	- `FIREBASE_SERVICE_ACCOUNT_PATH=`
	- `FIREBASE_SERVICE_ACCOUNT_JSON=`

Local Docker quick setup (file-based):

- Create `status-monitor/secrets/firebase-service-account.json` with your Firebase service account key JSON.
- Keep `FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-service-account.json` in `.env`.
- Start with `docker compose up --build` from `status-monitor/`.

## Run With Docker

```bash
docker compose up --build
```

The frontend is available on port `18080` and the Bun service health endpoint is available on port `3001`.

## Firebase Rules

- [firestore.rules](firestore.rules)
- [database.rules.json](database.rules.json)

The Firestore rules keep the `readings` and `heartbeats` collections writable for the ESP32 firmware and deny everything else by default. The Realtime Database rules expose the published status read-only for the SPA.
