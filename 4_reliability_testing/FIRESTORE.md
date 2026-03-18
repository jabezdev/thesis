# Firestore Access Guide

This folder uses the Firebase Firestore REST API directly from the ESP32 firmware in `esp-code/reliability_test/reliability_test.ino`.

## Project And Endpoint

- Firebase project: `panahon-live`
- Firestore base URL:

```text
https://firestore.googleapis.com/v1/projects/panahon-live/databases/(default)/documents
```

- API key is embedded in the firmware and the helper scripts in this folder.

## Collections

The firmware writes to two collections:

- `readings` for per-sample telemetry snapshots
- `heartbeats` for health/status updates

## Reading Data

Use Firestore document listing endpoints with the API key query parameter:

```text
GET https://firestore.googleapis.com/v1/projects/panahon-live/databases/(default)/documents/readings?key=API_KEY
GET https://firestore.googleapis.com/v1/projects/panahon-live/databases/(default)/documents/heartbeats?key=API_KEY
```

Pagination is handled with `pageSize` and `pageToken`.

Example:

```bash
curl "https://firestore.googleapis.com/v1/projects/panahon-live/databases/(default)/documents/readings?key=API_KEY&pageSize=10"
```

## Document Format

Firestore returns typed values, so each field is wrapped in a type object such as `integerValue`, `doubleValue`, `stringValue`, or `booleanValue`.

The helper script `esp-code/reliability_test/fetch_firebase_decode.py` already parses those typed values into normal Python values.

### `readings`

The firmware stores compact keys in each document:

- `ts`: Unix timestamp in seconds
- `t`: temperature in Celsius
- `h`: humidity in percent
- `bv`: battery voltage in volts
- `bi`: battery current in amps
- `soc`: battery state of charge in percent
- `ir`: battery internal resistance in milliohms

Document IDs are generated as:

```text
<station_id>_<unix_ts>_<hash>
```

For this firmware the station ID is `reliability_station_1`.

### `heartbeats`

Heartbeat documents use the station ID as the document ID and contain higher-level status fields:

- `station_id`
- `timestamp`
- `uptime_h`
- `batt_voltage`
- `http_2xx`
- `http_4xx`
- `http_5xx`
- `http_transport`
- `last_http`
- `pending_rows`
- `sd_fault`
- `sd_ok`
- `sd_remount_attempts`
- `sd_remount_success`
- `ntp_backoff_s`

## How To Process The Data

1. Fetch the target collection from Firestore.
2. Parse the typed Firestore fields into normal JSON values.
3. For `readings`, rename the compact keys into readable names and convert `ts` into an ISO UTC timestamp.
4. For `heartbeats`, keep the fields as-is and analyze counters over time.

Recommended script:

```bash
python3 esp-code/reliability_test/fetch_firebase_decode.py --collection readings --limit 200 --out firebase_readings.txt
python3 esp-code/reliability_test/fetch_firebase_decode.py --collection heartbeats --limit 200 --out firebase_heartbeats.txt
```

## Practical Notes

- `readings` is the live telemetry stream.
- `heartbeats` is the status stream for reliability analysis.
- If you need a richer time-series history, combine Firestore reads with the SD card logs described in `DECODING.md`.

## Status Monitor Stack

The Dockerized Bun + SPA monitor lives in `status-monitor/`.

- `status-monitor/backend/` loads Firestore, watches new documents, stores heartbeat history locally, and publishes the current report to Realtime Database.
- `status-monitor/frontend/` subscribes to Realtime Database and renders the researcher dashboard.
- `status-monitor/docker-compose.yml` runs both services together.