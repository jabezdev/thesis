# TESTING.md — Integration & System Testing

This file covers tests that cross milestone boundaries. Each milestone's unit-level checklist lives in `milestones/MN_*.md`. Run those first. The tests below assume all relevant milestones are passing their unit checklists.

---

## Test Environment Setup

### Required services
- TimescaleDB running locally (Docker or bare metal)
- Fastify Ingestion API running locally (or staging server)
- Convex dev deployment
- Clerk development application

### Test data seed
Before running integration tests, run the DB seed script from M1 to create:
- 2 workspaces (workspace_a, workspace_b)
- 2 nodes per workspace (4 nodes total)
- 20 weather readings and 5 health readings per node

### Test ESP32 simulator
A Node.js script that mimics the Hardware Node's HTTP behavior:
- Builds a valid V1 binary packet (hardcoded sensor values)
- Sends `POST /api/v1/ingest` with a configurable `X-Node-Key`
- Reads and prints `X-Cmd` response headers
- Configurable packet type (weather/health), mode, and timestamp

---

## I1: Node → Ingestion API → TimescaleDB (Happy Path)

**Tests**: M3 + M2 + M1 together

### Procedure
1. Use the ESP32 simulator to send a valid V1 Weather packet for `node_1` (workspace_a).
2. Check TimescaleDB: `SELECT * FROM weather_readings WHERE node_id = 'node_1' ORDER BY time DESC LIMIT 1`.
3. Verify the row matches the packet values (de-scaled correctly).

### Checklist
- [ ] Row is present in `weather_readings` within 2 seconds of the POST
- [ ] `temperature_c` matches: simulator sent `temp_raw = 294` → DB row has `temperature_c = 29.4`
- [ ] `workspace_id` on the row matches workspace_a
- [ ] `packet_version = 1`
- [ ] `is_time_reconciled = false` (timestamp was valid)

---

## I2: Node → Ingestion API → TimescaleDB (Cold-Boot Epoch)

**Tests**: M3 timestamp reconciliation + M2 time reconciliation + M1 `is_time_reconciled` flag

### Procedure
1. Simulator sends a packet with `rtc_timestamp` set to `0` (Unix epoch, 1970) and `uptime_ms = 5000` (5 seconds since boot).
2. Check the inserted row.

### Checklist
- [ ] Row is inserted (not rejected)
- [ ] `is_time_reconciled = true`
- [ ] `time` column is approximately `now() - 5s` (reconciled from `uptime_ms`)
- [ ] The reconciled timestamp is within ±5 seconds of the expected value

---

## I3: Multi-Tenant Isolation

**Tests**: M1 RLS + M2 Historical API + M4 Clerk JWT workspace scoping

### Procedure
1. Insert 5 weather readings for `node_1` (workspace_a) and 5 for `node_3` (workspace_b).
2. Request `GET /api/v1/historical/node_1` with a Clerk JWT for workspace_a.
3. Request `GET /api/v1/historical/node_3` with a Clerk JWT for workspace_a.
4. Repeat step 3 with a JWT for workspace_b.

### Checklist
- [ ] Step 2: returns 5 rows (workspace_a data is accessible to workspace_a admin)
- [ ] Step 3: returns `403` or `0` rows (workspace_a admin cannot access workspace_b data)
- [ ] Step 4: returns 5 rows (workspace_b admin can access their own data)

---

## I4: Node Provisioning → Node Transmission

**Tests**: M4 Admin API node provisioning + M2 authentication + M1 node creation

### Procedure
1. Call `POST /api/v1/admin/nodes` with a Clerk JWT for workspace_a. Note the returned `api_key` and `node_id`.
2. Simulator sends a packet using the new `api_key` in `X-Node-Key`.
3. Check TimescaleDB for the new row.

### Checklist
- [ ] `POST /api/v1/admin/nodes` returns `201` with a 64-char hex `api_key`
- [ ] Simulator request with the new key returns `204`
- [ ] Row is inserted in `weather_readings` with the correct `node_id` and `workspace_id`
- [ ] Simulator request with an old random key returns `401`

---

## I5: OTA Command Pipeline (End-to-End)

**Tests**: M6 dashboard OTA trigger + M4 Convex + M2 X-Cmd delivery + M3 node response

### Procedure
1. Upload a test `.bin` file via `POST /api/v1/admin/firmware` (Clerk JWT).
2. In the Admin Dashboard, navigate to node_1's detail page and click "Push Firmware Update" with the returned URL.
3. Verify a `pendingCommands` doc exists in Convex for node_1.
4. Simulator sends a heartbeat ingest for node_1.
5. Verify response has `X-Cmd: ota=<url>`.
6. Verify `pendingCommands` doc is marked delivered.
7. Repeat step 4 — verify no `X-Cmd` on the second response.

### Checklist
- [ ] Step 1: firmware URL is returned; file is accessible via GET
- [ ] Step 2–3: `pendingCommands` doc exists with `status: pending`
- [ ] Step 4–5: ingest response contains `X-Cmd: ota=<url>` matching the staged URL
- [ ] Step 6: `pendingCommands` doc `status = delivered`
- [ ] Step 7: no `X-Cmd` header on subsequent ingest
- [ ] API restart between steps 3 and 4: pending command still delivered (persisted in Convex)

---

## I6: SD Card Sync (Extraction Tool → API → TimescaleDB)

**Tests**: M7 Extraction Tool sync + M2 Clerk JWT ingest path + M1 idempotent upsert

### Procedure
1. Create a test CSV file with 10 rows matching the M3 SD card format (valid CRC-8 per row, valid timestamps).
2. Open the Extraction Tool, select the CSV, authenticate with admin Clerk JWT, select node_1, click Sync.
3. Verify rows appear in TimescaleDB.
4. Click Sync again with the same CSV.

### Checklist
- [ ] Step 2: tool reports 10 rows synced, 0 faulted
- [ ] Step 3: 10 rows appear in `weather_readings` for node_1
- [ ] Step 4 (re-sync): tool reports 10 rows processed, 0 faulted; row count in DB remains 10 (no duplicates)
- [ ] Sync with a row that has a corrupted CRC: that row is skipped by the tool (not sent to API), reported in Faults tab

---

## I7: Offline Node Detection Alert

**Tests**: M2 ingestion logging + M4 Convex scheduled alert function + M6 dashboard alert display

### Procedure
1. Send a Nominal-mode weather reading for node_2.
2. Wait > 10 minutes (or simulate by directly triggering the Convex alert scheduler with a manipulated last-seen time).
3. Check the Admin Dashboard.

### Checklist
- [ ] An offline alert banner appears for node_2 in the dashboard
- [ ] The alert shows the last-seen timestamp
- [ ] Sending a new reading from node_2 within 1 TX interval resolves (dismisses) the alert automatically

---

## I8: Public PWA ↔ API ↔ DB (Data Visibility)

**Tests**: M5 PWA + M2 public endpoints + M1 materialized view

### Procedure
1. Insert a new weather reading for node_1 via the simulator.
2. Trigger a materialized view refresh: `REFRESH MATERIALIZED VIEW public_latest_readings`.
3. Open the PWA home page; check the node_1 card.

### Checklist
- [ ] Node_1 card shows the new reading after the materialized view refresh
- [ ] `GET /api/v1/public/latest/node_1` returns data not older than 1 minute (after refresh)
- [ ] The PWA does NOT expose any `workspace_id` data in its API responses

---

## I9: Service Worker Offline Fallback

**Tests**: M5 PWA service worker

### Procedure
1. Load the PWA in Chrome. Navigate to node_1 detail page (triggers 24h history cache write).
2. In DevTools → Network → check "Offline."
3. Refresh the node_1 detail page.
4. Verify the offline banner appears and data is shown.

### Checklist
- [ ] Page loads from service worker cache when offline
- [ ] Node_1 historical chart is visible (last 24h from cache)
- [ ] Offline banner is displayed: "Showing cached data — last updated [timestamp]"
- [ ] Home page also loads from cache (app shell)
- [ ] Re-enabling network causes the page to refresh with live data

---

## I10: In-Memory Queue Durability Under DB Outage

**Tests**: M2 in-memory queue + M1 TimescaleDB + M3 node behavior

### Procedure
1. Stop TimescaleDB (or block the DB connection).
2. Simulator sends 10 packets.
3. `GET /api/v1/health` — check queue depth.
4. Restart TimescaleDB.
5. Wait 15 seconds for the background flush worker.
6. Check DB row count.

### Checklist
- [ ] Steps 1–2: Ingestion API returns `204` for each packet (queued, not failed)
- [ ] Step 3: `queue_depth = 10`
- [ ] Step 5–6: all 10 queued rows are written to TimescaleDB within 15 seconds of DB reconnect
- [ ] `queue_depth` returns to `0` after flush
- [ ] If queue exceeds capacity (send 361 packets while DB is down): oldest packet is dropped; `dropped_packet_count` = 1

---

## System Performance Benchmarks

These are not pass/fail tests — they establish baseline numbers for the thesis documentation.

### P1: Ingestion Throughput
**Procedure**: Simulator sends 100 ingest requests sequentially with 1ms between each, measuring end-to-end latency.
**Target**: p95 latency < 100ms per ingest request under single-node load.
**Measure**: p50, p95, p99 ingest latency; error rate.

### P2: Historical Query Latency
**Procedure**: Request `GET /api/v1/historical/node_1?range=7d` with 50,000 rows in TimescaleDB for node_1.
**Target**: Response time < 500ms.
**Measure**: Response time; rows returned; query plan (ensure index scan, not seq scan).

### P3: Materialized View Freshness
**Procedure**: Insert a reading; measure time from insert to the reading appearing in `public_latest_readings` after a manual refresh.
**Target**: < 10 seconds with pg_cron refresh interval.
**Measure**: Staleness window.

### P4: Concurrent Node Simulation
**Procedure**: 5 simulator instances all sending at 1-minute High Alert intervals simultaneously for 10 minutes. Verify all readings land in TimescaleDB with no data loss.
**Target**: 0 missing rows; p95 latency < 200ms.
**Measure**: Total expected rows vs. actual rows; latency distribution.

### P5: SD Card Sync Speed
**Procedure**: Sync a 10,000-row CSV via the Extraction Tool.
**Target**: Complete in < 5 minutes (33 rows/sec).
**Measure**: Total sync time; rows/second; error rate.

---

## Regression Test Protocol

Before any new deployment:
1. Run all 10 integration test checklists (I1–I10) against the staging environment.
2. Run P1 (ingestion throughput) and verify p95 has not regressed by more than 20% from the recorded baseline.
3. Verify the materialized view is refreshing correctly (P3).
4. Confirm the OTA pipeline (I5) with a known-good test firmware file.
