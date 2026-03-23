# EXTENSIONS.md — Second-Pass Audit Decisions

Issues found after the REENGINEER.md changes were applied. Mark your decision for each before implementation.

---

## Section A: New Problems Introduced by the Changes

---

### A.1 Versioned Packet Breaks the Length Validation Logic

**Problem:** The Ingestion API validates that buffer length is an exact multiple of "the expected packet structure size." Adding a version byte means V1 and V2+ packets have different sizes. A single fixed-multiple check no longer works — the API must read the version byte first, then validate length against the version-specific size.

| Option | Description |
|--------|-------------|
| `[x]` **1** | Read version byte first, look up the expected struct size for that version from a dispatch table, then validate length against that size. Unknown versions are rejected with a `400` before any further parsing. |
| `[ ]` **2** | Keep V1 validation as-is (fixed multiple check). Add a note: multi-version length validation is deferred until a V2 packet format is actually defined. The version byte is reserved but unused for now. |
| `[ ]` **3** | Validate length as a minimum (≥ minimum struct size for the given version) rather than exact multiple. More lenient but avoids tight coupling between the validator and the exact byte count of each version. |

---

### A.2 High Alert Triggered by "Extreme Battery Drain" Contradicts Itself

**Problem:** Mode 1 (High Alert) lists "extreme battery drain" as a trigger, but High Alert transmits every 1 minute — the most power-hungry cadence. Triggering the highest-drain mode when the battery is already failing is wrong. This looks like a copy error from the original spec.

| Option | Description |
|--------|-------------|
| `[x]` **1** | Remove "extreme battery drain" from the High Alert trigger entirely. High Alert is rainfall-only. Battery drain goes to Power Saving or Critical Shutdown — never High Alert. |
| `[ ]` **2** | Clarify the intent: "extreme battery drain during an active storm" means the node is already in High Alert due to rain, and the battery drain is being monitored closely — not that battery drain alone triggers High Alert. Rewrite the trigger description to reflect this. |
| `[ ]` **3** | Add a combined condition: rainfall interrupt while battery is healthy → High Alert. Rainfall interrupt while battery is low → a new "Storm + Low Power" sub-mode with 5-minute TX instead of 1-minute, balancing data capture and battery survival. |

---

### A.3 Mermaid Diagram Has a Backwards Arrow

**Problem:** `IA -- "Clerk JWT validation" --> D [Admin Dashboard SPA]` implies the API pushes to the dashboard. It should be the dashboard querying the API with a Clerk JWT.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Fix the arrow direction only. One-line documentation fix. |
| `[ ]` **2** | Fix the arrow and add the missing metadata write path (admin dashboard → TimescaleDB) to the diagram at the same time. |
| `[x]` **3** | Redraw the diagram to include all currently missing paths: corrected Clerk JWT arrow, metadata write path, OTA flow, and WiFi as an alternate node connection. |

---

### A.4 WiFi and Operational Modes Are Not Reconciled

**Problem:** The adaptive modes are designed around minimizing LTE modem wake cycles as the primary battery constraint. When a node is on WiFi, the LTE modem is off entirely — the rationale for the mode timing changes. The document adds WiFi without addressing how modes should behave when WiFi is the active link.

| Option | Description |
|--------|-------------|
| `[x]` **1** | Keep the same transmission intervals on WiFi for data consistency. Add a note: "When WiFi is the active link, the LTE modem remains in deep sleep. Transmission intervals are unchanged; the power-saving rationale no longer applies but intervals are kept consistent for predictable data resolution." |
| `[ ]` **2** | On WiFi, ignore the adaptive interval floor — transmit on a fixed short interval (e.g., every 60 seconds) regardless of mode. Keep the same *sampling and SD logging* cadence. WiFi is treated as a high-bandwidth path, not a constrained one. |
| `[ ]` **3** | Define WiFi as a transport-only swap with no behavioral changes. Explicitly document that mode optimization for WiFi-connected nodes is future work. |

---

### A.5 NTP Sync May Require a Dedicated LTE Wake in Power Saving Mode

**Problem:** NTP is scheduled every 6 hours. In Power Saving mode, the LTE modem wakes only every 30 minutes for data transmission. A 6-hour NTP sync may fall between transmission windows, requiring an extra modem wake just for NTP.

| Option | Description |
|--------|-------------|
| `[x]` **1** | Piggyback NTP sync on the next scheduled transmission window after the sync interval expires. Accept that NTP may be delayed by up to 30 minutes in Power Saving mode. No dedicated NTP-only modem wake. |
| `[ ]` **2** | In Power Saving mode, extend the NTP interval to 24 hours (from 6) to minimize dedicated wakes. In Nominal and High Alert, keep 6 hours. |
| `[ ]` **3** | Check if the next scheduled transmission falls within 30 minutes of the NTP due time. If so, defer NTP to that window. If not, allow a dedicated NTP-only wake (adds ~1–2 KB LTE overhead per occurrence). |

---

### A.6 TLS Certificate Verification on the ESP32 Is Unaddressed

**Problem:** The security model claims bearer keys are protected by HTTPS / TLS, but ESP32 TLS requires explicit configuration of a root CA bundle to actually verify the server's identity. Without it, the node encrypts traffic but cannot authenticate the server, leaving it vulnerable to MITM attacks — which also exposes the bearer key.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Bundle the server's root CA certificate into the firmware. The ESP32 verifies the server cert against this CA on every connection. Requires an OTA update if the CA changes. |
| `[ ]` **2** | Use certificate pinning: embed the server's public key fingerprint in firmware. The ESP32 rejects any connection where the fingerprint doesn't match. Most secure; requires OTA on every certificate renewal. |
| `[x]` **3** | Document as a known trade-off: TLS provides encryption but server identity is not verified at the application layer. Acceptable for a thesis deployment on a controlled network; note as a hardening item before production use. |

---

## Section B: Specification Gaps

---

### B.1 Node ID Is Never Specified in the Request

**Problem:** The Ingestion API must know which node sent a packet to validate the bearer API key. The node ID must come from either the request header or the packet payload, but neither is specified. If it's in the payload, the API must parse before authenticating — which means an unauthenticated packet triggers parsing.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Node ID in the request header (`X-Node-ID`), alongside the API key (`X-Node-Key`). API validates key against the stored key for that node ID *before* parsing the packet body. |
| `[x]` **2** | The API key IS the node identifier. The key lookup table maps `api_key → node_id`. No separate node ID header. The API looks up the node from the key alone before parsing. |
| `[ ]` **3** | Node ID as the second field in the binary packet payload (after version byte). API does a minimal partial parse to extract node ID, looks up and validates the key, then proceeds with full parsing. |

---

### B.2 Node Provisioning Workflow Is Missing

**Problem:** "Each node is provisioned with a bearer API key at deployment time." There is no API endpoint, CLI tool, or described workflow for registering a new node. Deploying a node requires a defined path.

| Option | Description |
|--------|-------------|
| `[x]` **1** | Add a provisioning endpoint to the admin API: `POST /api/v1/admin/nodes` (Clerk JWT required). Creates the node record in TimescaleDB and returns the generated API key. Admin enters this key into the node firmware before field deployment. |
| `[ ]` **2** | Manual provisioning: admin inserts the node record directly into TimescaleDB via a provided SQL script and generates a key via a CLI tool bundled with the API codebase. No HTTP endpoint required for a thesis with few nodes. |
| `[ ]` **3** | "First contact" protocol: an unregistered node sends a provisioning request with a one-time setup code (generated at flash time, printed on the hardware label). The API auto-creates the node record and returns the permanent key on first contact. |

---

### B.3 Metadata Write Path from Admin Dashboard to TimescaleDB Is Unspecified

**Problem:** TimescaleDB is declared the write master for node metadata, but the write path from the Admin Dashboard is never described. When an admin edits a node's location, where does the write go, and through what path does it reach TimescaleDB?

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Admin Dashboard → Convex mutation → Convex action → Fastify Admin API endpoint → TimescaleDB. Single write path through the Fastify API. Convex acts as the trigger, not the store. |
| `[x]` **2** | Admin Dashboard queries the Fastify Historical/Admin API directly (Clerk JWT) for both reads and writes to node metadata. Convex is out of the metadata path entirely — it reads via action when needed. |
| `[ ]` **3** | Admin Dashboard → Convex mutation (instant local update for responsive UI) → Convex action propagates to TimescaleDB immediately (not via CRON). Convex holds a cached copy for fast admin reads; TimescaleDB is the durable store. No reconciliation CRON needed — the action runs synchronously. |

---

### B.4 OTA Command State Storage Is Unspecified

**Problem:** An admin issues an OTA push from the dashboard. The node is not always connected — it checks in on its next heartbeat. Something must persist the "pending OTA for node X" between the admin action and the node's next check-in. Where is this state stored?

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Store pending commands in a `node_commands` table in TimescaleDB (columns: `node_id`, `command_type`, `payload`, `status: pending/delivered/acknowledged`). The Ingestion API queries this table on each heartbeat receive. Persists across API restarts. |
| `[x]` **2** | Store pending commands in Convex (a `pendingCommands` document per node). The Ingestion API reads this via a Convex action on heartbeat receive. Survives API restarts via Convex's own persistence. |
| `[ ]` **3** | In-process Map in the Ingestion API: `node_id → pending command`. Lost on restart; admin must re-issue if the API restarts before the node checks in. Acceptable for a thesis with few nodes and infrequent OTA. |

---

### B.5 Node Response to a 400 (Range Validation Rejection) Is Undefined

**Problem:** The server rejects out-of-range sensor values with a `400`. What does the node do with this? If it retries indefinitely, it wastes LTE data on a permanently invalid reading. If it silently discards, the operator never knows.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Node treats `400` as non-retriable. Discards the packet and continues. The raw value is already on the SD card and reviewable during extraction. A fault counter in the System Health payload tracks total rejected packets. |
| `[ ]` **2** | Node logs the rejection to SD card (with rejected value and timestamp) as a fault event, then discards. Extraction Tool surfaces these fault events separately from normal readings. |
| `[x]` **3** | Node retries once after a 30-second delay. If the second attempt also returns `400`, logs and discards. Guards against transient server-side misconfigurations (e.g., threshold set wrong) without infinite retry. |

---

### B.6 Command/Response Protocol for Node Management Is Undefined

**Problem:** Two node management operations (OTA flag, NTP re-sync command) rely on the API response to an ingest POST. The format of that response body is never specified. The ESP32 must be able to parse it.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Define a simple JSON response body: `{"ok": true, "cmd": null}` for normal operation, `{"ok": true, "cmd": {"type": "ota", "url": "..."}}` or `{"ok": true, "cmd": {"type": "ntp_sync"}}` for management operations. Node parses the `cmd` field after each successful transmission. |
| `[x]` **2** | Use HTTP response headers for commands: `X-Cmd: ota=<url>` or `X-Cmd: ntp_sync`. Simpler to parse on the ESP32 without a JSON library. Normal responses return no `X-Cmd` header. |
| `[ ]` **3** | Response body is always empty (`204 No Content`) for normal ingest. Commands are delivered via a separate endpoint the node polls only when a flag is set in a previous `X-Has-Command: 1` response header. Keeps the hot ingest path minimal. |

---

### B.7 Mode Transition Hysteresis Is Unspecified

**Problem:** The document describes when each mode is entered but not when it is exited. Without hysteresis, a node could oscillate rapidly between High Alert and Nominal during intermittent rain.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Fixed cooldown timer: node remains in High Alert for a minimum of 15 minutes after the last detected rainfall event before transitioning back to Nominal. |
| `[ ]` **2** | Rate-based exit: node exits High Alert when the rainfall accumulation rate drops below the minimum detectable threshold for two consecutive 10-second measurement intervals. |
| `[x]` **3** | Event-count based: if fewer than N rainfall tips occur in the last M minutes, downgrade mode. Example: fewer than 2 tips in the last 5 minutes → revert to Nominal. Simple to configure and tune. |

---

### B.8 Row-Level Security for Unauthenticated Public Reads

**Problem:** RLS policies on TimescaleDB require a `workspace_id` context to filter data. Public read endpoints are unauthenticated — the database has no JWT to derive workspace from. The mechanism for setting the RLS context on a public query is unspecified.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Public endpoints bypass RLS entirely. The Fastify API uses a read-only DB role that can access a `nodes_meta` lookup table (without RLS) to resolve `node_id → workspace_id`, then filters sensor data with an explicit `WHERE workspace_id = $1 AND node_id = $2` in the query. Security: public endpoints can only return data for the specific node_id in the URL. |
| `[ ]` **2** | The Fastify API sets a session-level RLS variable before each public query: `SET LOCAL app.workspace_id = (SELECT workspace_id FROM nodes_meta WHERE node_id = $1)`. The public DB role has access to `nodes_meta` for this lookup, and RLS applies to all subsequent queries in the transaction. |
| `[x]` **3** | Public endpoints use a separate DB role that only has access to a pre-computed materialized view of public-facing data (latest reading per node, no workspace column exposed). RLS is not needed for this role — the view enforces scope at the schema level. |

---

### B.9 SD Card Sync Requires the Node's API Key — Held by Whom?

**Problem:** The Extraction Tool optionally syncs SD data to TimescaleDB via the Ingestion API, which requires a bearer API key. The tool must authenticate as the node. Where is the node's key held for this purpose?

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Store the node's API key in a metadata file on the SD card itself (`node.cfg`). The Extraction Tool reads it automatically during extraction. Trade-off: physical SD card access exposes the key. |
| `[x]` **2** | Add a separate upload permission tier: SD sync uses an admin Clerk JWT instead of the node's key. This is an admin-authenticated operation, not a node operation. The Ingestion API accepts either auth method on the ingest endpoint. |
| `[ ]` **3** | The operator inputs the node's API key manually into the Extraction Tool (or via a local config file on their computer). The key is never on the SD card. Slightly more friction for the operator but no key exposure risk from a lost SD card. |

---

### B.10 "Lightweight GUI" Technology Is Unspecified

**Problem:** The Electron app was dropped for being too heavy. The replacement is described as a "lightweight GUI application" with no technology specified. If this ends up as Electron, the original problem is recreated.

| Option | Description |
|--------|-------------|
| `[x]` **1** | **Tauri** (Rust + WebView2/WebKit): ships as a small native binary (~3–10 MB), uses the OS's built-in webview. Frontend is standard HTML/JS — compatible with the existing web stack. No Chromium bundled. |
| `[ ]` **2** | **Local web server + browser**: the tool runs a lightweight HTTP server (Node or Python) and opens `localhost` in the default browser. No native GUI framework at all. Works on any OS with a browser. Simplest to build given the existing stack. |
| `[ ]` **3** | **Python + tkinter/PySimpleGUI**: minimal dependencies, ships as a script or small `.exe` via PyInstaller. No web tech needed. Best for field operators on Windows with no developer toolchain. |

---

### B.11 Ingestion API Process Down Is Not a Documented Failure Mode

**Problem:** The failure table covers TimescaleDB down and Cloudflare unreachable, but not the Ingestion API process itself crashing or restarting. From the node's perspective these look the same, but the mitigations differ — a DB outage preserves the in-memory queue; an API restart loses it.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Add to the failure modes table: "Ingestion API process down — nodes cannot transmit, data accumulates on SD card — mitigation: nodes retry with exponential backoff (configurable max interval), process manager (PM2/systemd) auto-restarts the API within seconds." |
| `[ ]` **2** | Treat it as subsumed by the TimescaleDB down mitigation (both cause the same node behavior: data to SD card, retry on reconnect). Add only a note that a process manager ensures fast restart. No new table row needed. |
| `[x]` **3** | Address it in the Deployment Topology section rather than the failure modes table: specify PM2 or systemd as a required deployment component with a restart policy, making the failure window negligible by design. |

---

### B.12 Heartbeat Is Not Defined as a Packet Type

**Problem:** "Each node includes a heartbeat in its telemetry" but the dual-payload section defines only Weather and System Health payloads. In Power Saving mode (Health payload every 30 minutes), the "2× expected interval" offline detection threshold may generate false alerts if the threshold is shorter than 60 minutes.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Formally define the System Health Payload as the heartbeat. Make the offline detection threshold mode-aware: "if no Health payload is received within 2× the Health transmission rate for the current mode (10 min in High Alert, 10 min in Nominal, 60 min in Power Saving), flag as potentially offline." |
| `[ ]` **2** | Add a minimal third packet type: a Heartbeat packet (version byte + node_id + timestamp + current mode indicator). Transmitted on a fixed short interval (e.g., every 5 minutes) regardless of operational mode. Adds a small fixed LTE overhead but enables reliable liveness detection in all modes. |
| `[x]` **3** | Use the Weather Payload as the liveness signal — if a weather reading is received, the node is online. Heartbeat interval = weather transmission interval. Simplest implementation; means nodes are only confirmed "alive" when transmitting weather data, not in between. |

---

## Section C: Correctness Issues

---

### C.1 Data Budget Math Is Incorrect

**Problem:** The budget table shows Nominal Weather payload at ~114 KB/month. A straightforward calculation (20 bytes × 12 tx/hr × 24 hr × 30 days) gives ~172 KB/month. The table states numbers without showing the formula, and the numbers don't match a verifiable calculation at any obvious packet size.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Recalculate each row showing the formula explicitly: `packet_size × transmissions_per_hour × 24 × 30`. Make the assumed packet size per transmission explicit (accounting for the version byte addition). |
| `[x]` **2** | Replace exact figures with a range per mode (e.g., "~150–200 KB/month per node in Nominal mode") and label them as design estimates to be validated against live deployments. |
| `[ ]` **3** | Keep the table structure but add a footnote with the derivation method and note that final numbers depend on the exact binary struct sizes once the versioned packet format is finalized. |

---

### C.2 PWA Service Worker Caching Strategy Is Undefined

**Problem:** "PWA service worker serves last-cached data as a secondary fallback." For a disaster preparedness system, what a citizen actually sees when the API is down matters. The service worker strategy (what is cached, for how long) is never defined.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Cache the most recent reading per node plus the page shell. Service worker uses stale-while-revalidate. Citizens see the last known reading with a "last updated X ago" timestamp. Minimal storage, always shows some data. |
| `[x]` **2** | Cache the last 24 hours of readings per node plus the page shell. Citizen can see the trend leading up to an outage. More storage but more useful during an emergency. |
| `[ ]` **3** | No offline data strategy beyond the page shell. Document as a known limitation. The PWA requires connectivity to show weather data. Offline data support is a post-thesis feature. |

---

### C.3 `ingest/batch` Has No Size Limit

**Problem:** The batch endpoint accepts an arbitrary number of concatenated packets with no stated maximum. A malfunctioning or compromised node could send an enormous batch, creating a DoS vector even with authentication.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Add a maximum packet count per batch (e.g., 100 packets). Return `413 Payload Too Large` if exceeded. Document the limit in the API contract table. |
| `[ ]` **2** | Enforce a maximum request body size at the Fastify level (e.g., 4 KB). This implicitly caps batch size without explicit packet counting, and protects the API generally. |
| `[x]` **3** | Remove the batch endpoint from current scope. Live telemetry uses the single ingest endpoint. SD card recovery sync (which is the main use case for batching) is handled by the Extraction Tool, which already uses its own upload loop. |

---

### C.4 "Big Screen" View Is Listed but Never Described

**Problem:** The Big Screen view appears as an Admin Dashboard feature with no description of what it shows, who can access it, or whether it requires authentication.

| Option | Description |
|--------|-------------|
| `[ ]` **1** | Define it: a read-only, full-screen display of current conditions for all nodes in an LGU workspace. Accessible via a shareable URL (`/bigscreen/{workspace_id}`) without login — intended for display monitors in command centers. Data is served from the same public API endpoints. |
| `[x]` **2** | Auth-required: an admin logs in, enters full-screen mode, and the dashboard switches to a "display layout." No separate URL or endpoint. The existing admin session powers it. |
| `[ ]` **3** | Remove it from the current feature list. Document as a post-thesis UI mode once the core dashboard is stable. |

---

*Mark each decision, then apply to ARCHITECTURE.md.*
