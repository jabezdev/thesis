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

## Run With Docker

```bash
docker compose up --build
```

The frontend is available on port `8080` and the Bun service health endpoint is available on port `3001`.

## Firebase Rules

- [firestore.rules](firestore.rules)
- [database.rules.json](database.rules.json)

The Firestore rules keep the `readings` and `heartbeats` collections writable for the ESP32 firmware and deny everything else by default. The Realtime Database rules expose the published status read-only for the SPA.
