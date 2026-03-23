# M2: Ingestion API

**Depends on**: M1 (Database Schema)
**Required by**: M3 (Hardware Node), M4 (Admin Backend), M5 (Public PWA), M7 (Extraction Tool)

---

## What This Milestone Delivers

A running Fastify (Node.js) HTTP server that receives binary packets from hardware nodes, authenticates them, validates packet integrity and sensor ranges, writes to TimescaleDB, and delivers management commands via response headers. This is the central data-path component.

---

## Requirements

### Stack
- **Runtime**: Node.js
- **Framework**: Fastify
- **DB client**: `pg` (node-postgres) with a connection pool

### Endpoints

#### `POST /api/v1/ingest`
The primary ingest path.

**Authentication**: Reads `X-Node-Key` header. Performs `SELECT node_id, workspace_id FROM nodes WHERE api_key = $1` to resolve the node. Rejects with `401` if not found. Authentication completes before any packet body is parsed.

**Packet validation**:
1. Read byte 0 (version byte).
2. Look up expected struct size for that version from a dispatch table (e.g., `{ 1: 20, 2: 24 }`). Unknown versions → `400`.
3. Validate `buffer.length === expected_size`. Mismatch → `400`.
4. Validate CRC-8 checksum. Failure → `400`.

**Parsing**: Parse the binary buffer using Little-Endian `Buffer.readInt16LE()` / `Buffer.readUInt16LE()` calls matching the ESP32 struct layout. De-scale integers to floating-point (e.g., `rawTemp / 10.0`).

**Timestamp sanity check**: If `rtc_timestamp < DEPLOYMENT_EPOCH` (configurable), apply time reconciliation:
```
true_timestamp = Date.now() - (node_uptime_ms_at_arrival - packet_uptime_ms) / 1000
```
Set `is_time_reconciled = true` on the record.

**Range validation**: Check each sensor value against the configured thresholds from `sensor_thresholds` for this node. Out-of-range → reject with `400`, log to `sensor_fault_events`.

**Write**: Parameterized `INSERT ... ON CONFLICT DO NOTHING` into the appropriate hypertable based on packet type.

**Command delivery**: After a successful write, perform a Convex action call to check `pendingCommands` for this node. If a command exists:
- Set `X-Cmd: ota=<url>` or `X-Cmd: ntp_sync` on the response.
- Clear the pending command document in Convex.
Normal responses (no pending command) return no `X-Cmd` header.

**Also accepts Clerk JWT** (for SD card sync from Extraction Tool): If no `X-Node-Key` header is present but a valid `Authorization: Bearer <clerk_jwt>` is present, authenticate as an admin operation. The `node_id` must be provided explicitly via `X-Node-ID` header in this case.

**Status codes**:
- `204 No Content` — success, no pending command
- `400 Bad Request` — malformed packet, unknown version, CRC failure, range rejection
- `401 Unauthorized` — API key not found or JWT invalid
- `500 Internal Server Error` — DB write failure (packet queued)

#### `GET /api/v1/health`
No authentication. Returns:
```json
{
  "status": "ok",
  "db_reachable": true,
  "queue_depth": 0,
  "queue_capacity": 360
}
```

#### `GET /api/v1/public/latest/:node_id`
No authentication. Queries the `public_latest_readings` materialized view via the `public_reader` DB role. Applies `Cache-Control: public, max-age=60` response header. Rate-limited at the Fastify level.

#### `GET /api/v1/public/history/:node_id`
No authentication. Queries the materialized view or a public-safe historical view for the last N readings for the given node. Rate-limited.

#### `GET /api/v1/historical/:node_id`
Clerk JWT required. Validates the JWT via Clerk's JWKS endpoint (fetch+cache the JWKS). Sets `SET LOCAL app.workspace_id = $1` in the DB transaction before querying `weather_readings`.

#### `GET /api/v1/historical/aggregate`
Clerk JWT required. Workspace-scoped aggregated queries.

#### `POST /api/v1/admin/nodes`
Clerk JWT required. Creates a node record in `nodes`, generates a random 32-byte hex API key, returns the key in the response body. This is the only time the key is returned in plaintext.

#### `GET /api/v1/admin/nodes/:node_id`
Clerk JWT required. Returns node metadata from TimescaleDB.

#### `PUT /api/v1/admin/nodes/:node_id`
Clerk JWT required. Updates `label`, `barangay`, `location_name`, `hardware_version`, `sensor_thresholds` for the given node.

### In-Memory Packet Buffer
- When a TimescaleDB write fails (connection error, timeout), enqueue the packet in a bounded in-memory queue.
- Queue capacity: ~360 entries (30 min × 12 packets/min at High Alert rate, both payload types).
- Overflow policy: drop the oldest entry and increment a `dropped_packet_count` counter.
- Expose queue depth and dropped count via `/api/v1/health`.
- Background worker attempts to flush the queue every 10 seconds when the DB is reachable.

### Rate Limiting
- Public endpoints: max 60 req/min per IP.
- Ingest endpoint: max 120 req/min per `node_id`.

### Structured Logging
Log every ingest request as a JSON line:
```json
{
  "event": "ingest",
  "node_id": "...",
  "packet_version": 1,
  "packet_type": "weather",
  "timestamp": "...",
  "is_time_reconciled": false,
  "validation_result": "ok",
  "latency_ms": 12
}
```
Log auth failures separately with `event: "auth_failure"`.

### Cloudflare Cache Purge (optional)
When a node transitions to High Alert (mode 1), call the Cloudflare Cache Purge API for the LGU's public endpoint. Debounce: max 1 call per `workspace_id` per 90 seconds. Only active when `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` env vars are set.

### Process Management
The server must run under **PM2** (development) or **systemd** (production) with a restart-on-crash policy. Document the startup command in the deployment README.

---

## Interactions

| Interacts With | Direction | How |
|----------------|-----------|-----|
| M1 TimescaleDB | writes + reads → | Parameterized SQL inserts, threshold lookups, node auth lookups |
| M3 Hardware Node | ← receives from | Accepts binary packets over HTTPS |
| M4 Convex | reads ↔ | Reads `pendingCommands` on ingest; clears on delivery |
| M4 Clerk | validates → | JWKS-based JWT validation for admin and historical endpoints |
| M5 Public PWA | ← serves | Public and historical endpoints |
| M6 Admin Dashboard | ← serves | Historical and admin endpoints |
| M7 Extraction Tool | ← receives from | Accepts ingest calls with Clerk JWT auth |

---

## Testing Checklist

### Authentication
- [ ] `POST /api/v1/ingest` with a valid `X-Node-Key` returns `204`
- [ ] `POST /api/v1/ingest` with an unknown `X-Node-Key` returns `401`
- [ ] `POST /api/v1/ingest` with no auth header returns `401`
- [ ] `POST /api/v1/ingest` with a valid Clerk JWT + `X-Node-ID` header returns `204`
- [ ] `POST /api/v1/admin/nodes` with a valid Clerk JWT returns `201` with the generated API key
- [ ] `POST /api/v1/admin/nodes` with no JWT returns `401`

### Packet Validation
- [ ] Valid V1 packet (correct size, correct CRC) → `204`, row in `weather_readings`
- [ ] V1 packet with wrong buffer size → `400`
- [ ] V1 packet with corrupted CRC → `400`
- [ ] Packet with unknown version byte (e.g., `0xFF`) → `400`
- [ ] Packet with out-of-range temperature (e.g., 9999) → `400`, row in `sensor_fault_events`

### Timestamp Reconciliation
- [ ] Packet with `rtc_timestamp` before deployment epoch → row inserted with `is_time_reconciled = true`, timestamp approximately equal to server time
- [ ] Packet with valid `rtc_timestamp` → row inserted with `is_time_reconciled = false`

### Command/Response Protocol
- [ ] When no `pendingCommands` exist for a node: ingest response has no `X-Cmd` header
- [ ] When a `pendingCommands` OTA entry exists for a node: ingest response has `X-Cmd: ota=<url>`
- [ ] After command delivery, the pending command document is cleared in Convex
- [ ] `X-Cmd: ntp_sync` is returned when the node's incoming timestamp deviates beyond the drift threshold

### In-Memory Queue
- [ ] When TimescaleDB is unreachable: ingest returns `204`, packet is queued (health endpoint shows `queue_depth > 0`)
- [ ] When TimescaleDB recovers: background worker flushes queued packets into the DB
- [ ] When queue is at capacity and a new packet arrives: oldest packet is dropped, `dropped_packet_count` increments
- [ ] Health endpoint correctly reports `queue_depth` and `db_reachable`

### Public Endpoints
- [ ] `GET /api/v1/public/latest/:node_id` returns the latest reading from the materialized view
- [ ] Response includes `Cache-Control: public, max-age=60` header
- [ ] Rate limiting: >60 req/min from same IP returns `429`

### Historical Endpoints
- [ ] `GET /api/v1/historical/:node_id` with a valid Clerk JWT returns data only for the workspace in the JWT
- [ ] `GET /api/v1/historical/:node_id` with a JWT from workspace A cannot access data from workspace B

### Logging
- [ ] Each successful ingest produces a structured JSON log line with `node_id`, `packet_version`, `validation_result`
- [ ] Each auth failure produces a separate log line with `event: "auth_failure"`
