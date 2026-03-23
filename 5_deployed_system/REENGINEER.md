# REENGINEER.md — Architecture Decision Review

Each item from the architecture critique is listed with three options. Mark your decision in the `[ ]` column.

---

## Section 1: Over-Engineering

---

### 1.1 Dual-Database Split (Convex + TimescaleDB + Clerk + Cloudflare)

**Problem:** Four external services with non-trivial inter-dependencies. Each one adds a billing account, a failure domain, and integration surface to maintain.

| Option | Description |
|--------|-------------|
| `[x]` **Retain** | Keep as-is. Justify by arguing each service solves a distinct problem (real-time subscriptions, time-series storage, auth, CDN). Accept the operational complexity. |
| `[ ]` **Change** | Drop Convex. Move admin backend to a simple REST API on the same server as the Ingestion API (Express/Fastify). Keep TimescaleDB as the sole database. Keep Clerk for auth or swap to a simpler JWT-based auth. Keep Cloudflare as an optional CDN optimization. |
| `[ ]` **Re-architect** | Drop Convex and Clerk entirely. Single server: Fastify API + TimescaleDB + session-based or JWT auth. Admin dashboard becomes a server-rendered or simple SPA that queries the same API. One database, one API, one deployment unit. |

---

### 1.2 Metadata Replication + CRON Reconciliation

**Problem:** Node metadata is written to Convex, then replicated to TimescaleDB via a CRON job to allow SQL joins. This is a self-inflicted split-brain problem.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep it. Accept the CRON reconciliation overhead as the cost of the Convex + TimescaleDB split. Ensure CRON failure alerts are in place. |
| `[x]` **Change** | Keep the dual-database but make TimescaleDB the write master for metadata. Convex reads metadata via an action instead of maintaining its own copy. Removes the replication step. |
| `[ ]` **Re-architect** | Eliminate the split by moving metadata to TimescaleDB only (contingent on dropping Convex per §1.1). One database owns all data. No replication needed. |

---

### 1.3 Three Adaptive Operational Modes

**Problem:** High Alert / Nominal / Power Saving with different sampling rates, block averages, and transmission intervals is complex firmware logic. Hard to implement, test, and debug in the field.

| Option | Description |
|--------|-------------|
| `[x]` **Retain** | Keep all three modes. The adaptive strategy is scientifically interesting and demonstrates awareness of real constraints (LTE cost, battery life). |
| `[ ]` **Change** | Reduce to two modes: **Normal** (current Nominal behavior) and **Power Saving** (current Power Saving behavior). Remove the High Alert mode. Simplify event detection — just use a faster normal interval during rain without a dedicated mode. |
| `[ ]` **Re-architect** | Single fixed interval with configurable transmission rate set at deployment time. No runtime mode switching. Eliminates adaptive logic entirely. Thesis contribution focuses on the system, not the power optimization. |

---

### 1.4 OTA Firmware Update System

**Problem:** Resumable downloads, dual-partition, admin-triggered fleet targeting by barangay/hardware generation, and hosted `.bin` files on object storage is a product feature, not a thesis deliverable.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep the full OTA system. Argue it is necessary for real-world deployment viability — physical updates to deployed nodes are impractical. Scope it as a key system feature. |
| `[x]` **Change** | Keep basic OTA (dual-partition, admin-triggered) but drop the advanced targeting (by barangay/hardware generation), resumable downloads, and object storage hosting. A simple "push to node by ID" with a direct URL is sufficient. |
| `[ ]` **Re-architect** | Remove OTA from scope entirely. Document it as a known gap and future work. For a thesis with 1–3 deployed nodes, physical updates are feasible. |

---

### 1.5 Local Integration Stack (Electron App)

**Problem:** A full Electron application with a bundled admin UI, background sync daemon, SQLite, and a COM gateway peripheral is a second product with its own development and testing scope.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep it. Argue offline resilience is a core requirement for LGUs with unreliable connectivity. Treat it as a differentiating feature of the thesis. |
| `[x]` **Change** | Keep the SD Card Extraction utility (it's practical and simpler) but drop the Electron app, partial sync, and COM gateway. Document the full Local Stack as planned future work. |
| `[ ]` **Re-architect** | Remove from current scope entirely. The cloud system is the thesis contribution. Local offline access is a post-thesis feature. |

---

### 1.6 Multi-Tenancy (Separate Schema per LGU)

**Problem:** Tenant isolation infrastructure assumes multiple LGUs will be onboarded. A thesis deployment with one LGU doesn't exercise or validate this.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep multi-tenancy. Argue it is a design requirement — the system is intended for multiple LGUs and the architecture must support that from the start. Scope the thesis to demonstrate the design, not production adoption. |
| `[x]` **Change** | Keep the concept of workspaces but implement it as a `workspace_id` column (row-level isolation) rather than separate schemas. Simpler to migrate and maintain. Still demonstrates multi-tenancy. |
| `[ ]` **Re-architect** | Remove multi-tenancy. Single schema, single LGU, no workspace concept. Thesis scope is one deployed station. Multi-tenancy is documented as a future extension. |

---

### 1.7 Production-Grade Observability (p50/p95/p99, Alerting Thresholds)

**Problem:** Latency percentiles, automated alerting at 5% error rate and 80% disk, EEPROM wear monitoring — this is SRE tooling beyond thesis scope.

| Option | Description |
|--------|-------------|
| `[x]` **Retain** | Keep it. These are descriptions of intent, not necessarily fully implemented features. They demonstrate awareness of production concerns. |
| `[ ]` **Change** | Simplify to: structured logging only (request log, error log), node heartbeat monitoring (last-seen), and battery/signal in the dashboard. Remove latency percentiles and automated alerting. |
| `[ ]` **Re-architect** | Remove the observability section from the architecture. Keep only what's visible in the admin dashboard: node status and basic health telemetry. |

---

### 1.8 49-Day `millis()` Rollover, Per-Record SD CRC, Atomic Write Journaling

**Problem:** Each is individually defensible but together they represent a large firmware implementation surface — especially for edge cases that may never trigger during a thesis evaluation.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep all three. These are real ESP32 firmware reliability concerns. Arguing you've handled them strengthens the thesis. |
| `[x]` **Change** | Keep the 49-day rollover protection (it's pure math in the timestamp reconciliation formula) and per-record CRC (one line of code). Drop the full atomic write journaling (temp file + fsync + rename) — a simpler periodic fsync is sufficient for a thesis. |
| `[ ]` **Re-architect** | Keep rollover protection only (it protects the core data integrity claim). Drop CRC and journaling. Document as known limitations. |

---

## Section 2: Big Assumption Jumps

---

### 2.1 "Hundreds of Nodes / Thousands of Users" Scaling Claim

**Problem:** Stated as a design goal with no load testing or basis. Drives Cloudflare as a hard dependency.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep the claim but add a clear disclaimer: *"This is an architectural design goal, not a validated production figure."* |
| `[x]` **Change** | Replace the scaling claim with a scoped statement: *"Designed to support the operational scale of a single LGU with multiple barangay-level nodes."* Remove the Cloudflare hard dependency; make it an optional optimization. |
| `[ ]` **Re-architect** | Remove the scalability section entirely. Document what the current implementation actually supports. |

---

### 2.2 OTA Justified by "50+ Field Nodes"

**Problem:** The scale justification for OTA doesn't match thesis deployment reality (1–3 nodes).

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep the justification. Argue the thesis system is designed for LGU-scale deployment, and 50+ nodes is a plausible future state the architecture must anticipate. |
| `[x]` **Change** | Reframe OTA as a maintainability feature (not a scale necessity). Drop the 50-node justification. |
| `[ ]` **Re-architect** | Drop OTA (see §1.4). Moot point. |

---

### 2.3 Electron App "Reuses" the Cloud Admin SPA

**Problem:** The cloud SPA is built on Convex + Clerk. It cannot be reused locally without replacing both backends — which is a major re-architecture of the frontend, not a reuse.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep the claim but acknowledge the frontend must be adapter-aware (switching between Convex and local API). Design a backend-agnostic data layer. |
| `[ ]` **Change** | Reframe: the Electron app runs a *separate* local admin UI that shares UI components (design system) with the cloud app, but has its own data layer. |
| `[x]` **Re-architect** | Drop the Electron app (see §1.5). Moot point. |

---

### 2.4 "Sensor Extensibility Requires Only a Minor Config Change"

**Problem:** The binary packet is a fixed 19-byte struct. Adding a new sensor requires a new packet format version, a new ingestion API parser, a DB schema change, and a dashboard update. The claim overstates simplicity.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Soften the claim to: *"Sensor extensibility is achievable via a new firmware version and a corresponding API update — no core system re-architecture is needed."* |
| `[x]` **Change** | Add a packet versioning byte to the binary struct (first byte = version). The ingestion API dispatches on version. This makes extensibility a real, designed-in feature. |
| `[ ]` **Re-architect** | Replace binary encoding with a small key-value binary format (e.g., sensor type tag + value) to allow variable payloads. Increases packet size slightly but is genuinely extensible. |

---

### 2.5 LTE Data Budget Underestimates Two Packet Types

**Problem:** The budget calculation uses 19 bytes × transmission rate but ignores the System Health payload — a second packet type also sent over LTE.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep the estimates but add a note that System Health packets add a fixed overhead per transmission cycle. |
| `[x]` **Change** | Revise the budget table to include both payload types. Show combined bandwidth per mode. |
| `[ ]` **Re-architect** | Merge Weather and System Health into a single packet (increases per-packet size but reduces overhead). Simplifies the budget and the firmware. |

---

## Section 3: Wrong Architecture Design

---

### 3.1 Convex Used as a Proxy to TimescaleDB

**Problem:** Convex actions are used purely as a server-side proxy to TimescaleDB. You're not using Convex's reactive database — you're using it as an expensive middleware.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep it. Convex's value here is: secure server-side execution (DB credentials off the client), real-time subscriptions for admin state, and built-in auth integration with Clerk. |
| `[x]` **Change** | Use Convex only for the data domains where it adds value (real-time admin state, alert rules, node config). Move TimescaleDB queries to a dedicated "Historical Data API" endpoint, queried directly from the admin dashboard with a JWT. Convex is no longer in the historical data path. |
| `[ ]` **Re-architect** | Remove Convex entirely. Single REST/WebSocket API (Fastify). Admin dashboard talks directly to the API. Eliminates the proxy architecture. (Contingent on §1.1 decision.) |

---

### 3.2 Schema-Per-Tenant in TimescaleDB

**Problem:** Schema-per-tenant is not the standard PostgreSQL multi-tenancy pattern. DDL changes require iterating over all schemas. Cross-tenant analytics require dynamic SQL.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep schema-per-tenant. Argue it provides the strongest isolation guarantee and the LGU count will remain small. |
| `[x]` **Change** | Switch to row-level tenancy: add `workspace_id` column to all tables, enforce with Row-Level Security (RLS) policies. Simpler migrations, cross-tenant queries are trivial, still secure. |
| `[ ]` **Re-architect** | Remove multi-tenancy entirely (see §1.6). Single schema. |

---

### 3.3 Auth Inconsistency: "API Key" vs. HMAC-SHA256

**Problem:** The API contract table says `API Key (header)` but the Security Model describes HMAC-SHA256 payload signing. These are different mechanisms described as if interchangeable.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Clarify in the document only: the "API Key" in the table header refers to the node's pre-shared key used as the HMAC secret — not a simple bearer token. The actual auth mechanism is HMAC-SHA256. |
| `[x]` **Change** | Replace HMAC-SHA256 with a simpler bearer API key per node (key is in the request header, not used as an HMAC secret). Simpler to implement and reason about. Loses the payload integrity guarantee — add a CRC to compensate. |
| `[ ]` **Re-architect** | Keep HMAC-SHA256 (it's the right approach for embedded systems) but fix the documentation inconsistency and rename the API table auth column to `HMAC-SHA256 (X-Node-Signature header)`. |

---

### 3.4 Cloudflare as a Hard Architectural Dependency

**Problem:** The public PWA has no direct API path — it requires Cloudflare. This makes local development, demos without internet, and offline testing require CDN configuration.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Keep Cloudflare as required. Argue it is a production necessity and the system is designed for production. Dev environments can mock the CDN with a local proxy. |
| `[x]` **Change** | Make Cloudflare optional. The public PWA can query the Ingestion API directly (with rate limiting). Cloudflare is a performance optimization layer, not a required component. Add `Cache-Control` headers on the API for CDN compatibility. |
| `[ ]` **Re-architect** | Remove Cloudflare from the architecture diagram. All public reads go directly to the API. Cloudflare can be added later as an infrastructure decision without changing the application architecture. |

---

### 3.5 SD Extraction Service Appears Twice (Standalone + Inside Electron)

**Problem:** "Component 6: SD Card Extraction Service" and the Electron app's "SD Card Reader & CSV Export Service" are described separately with no stated relationship.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain** | Clarify in the document: the standalone service is a CLI tool for operators; the Electron app bundles a GUI version of the same service. Same core logic, different packaging. |
| `[ ]` **Change** | Unify them: define one SD Extraction module that can be invoked as a CLI or loaded as a library by the Electron app. Remove the duplicate description. |
| `[ ]` **Re-architect** | If the Electron app is dropped (§1.5), keep only the standalone CLI extraction service. Remove the duplication by removing one instance. |
| `[x]` **New** | Remove the Electron app for viewing, keep the extraction service but with a lightweight GUI.|

---

## Section 4: Missed Areas / Considerations

---

### 4.1 Sensor Calibration and Accuracy

**Problem:** No mention of calibration procedures, measurement uncertainty, or how sensor drift is handled. For a weather thesis, this is the scientific core.

| Option | Description |
|--------|-------------|
| `[x]` **Retain (gap)** | Accept this as out of scope for the architecture document. Address calibration in the thesis write-up methodology chapter. |
| `[ ]` **Change** | Add a brief "Sensor Accuracy & Calibration" section to the architecture: reference the sensors used, their rated accuracy, and note that deployment includes a baseline comparison against a reference station. |
| `[ ]` **Re-architect** | Add a calibration offset field per sensor per node to the database schema. Operators can enter calibration adjustments in the admin dashboard; all queries apply the offset automatically. |

---

### 4.2 Data Quality / Range Validation

**Problem:** No range validation on incoming sensor values. A faulty sensor reporting 999°C would be silently written to the database.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain (gap)** | Accept it as a known limitation. Flag invalid readings in the admin dashboard after the fact. |
| `[x]` **Change** | Add configurable min/max thresholds per sensor type in the Ingestion API. Readings outside range are rejected with a `400` and logged as a sensor fault event. Thresholds are set per node in the admin dashboard. |
| `[ ]` **Re-architect** | Implement a separate validation/QC layer between the Ingestion API and the database write. Flagged readings are written to a quarantine table for review rather than rejected outright. |

---

### 4.3 Power System Architecture

**Problem:** Solar panel sizing, battery capacity, and charge controller specs are not specified. These directly determine the Power Saving mode thresholds and field viability.

| Option | Description |
|--------|-------------|
| `[x]` **Retain (gap)** | Treat as a hardware BOM concern, not an architecture concern. Document in the hardware chapter. |
| `[ ]` **Change** | Add a "Power System" subsection to the Hardware Node section: specify the panel wattage, battery capacity (Ah), charge controller, and the voltage thresholds that trigger each operational mode. |
| `[ ]` **Re-architect** | N/A — this is a documentation gap, not a design flaw. |

---

### 4.4 NTP Sync Specifics

**Problem:** "Periodic NTP syncing via LTE" is load-bearing for the timestamp integrity strategy but is never specified (which server? how often? fallback?).

| Option | Description |
|--------|-------------|
| `[ ]` **Retain (gap)** | Accept that NTP specifics are firmware implementation details, not architecture. Document in firmware notes. |
| `[x]` **Change** | Add a brief NTP spec: use different NTP servers, sync on boot + every N hours, fall back to last-known-good RTC if NTP is unreachable, log failed sync attempts. |
| `[ ]` **Re-architect** | N/A — a documentation and firmware detail, not an architecture decision. |

---

### 4.5 "Rainfall Interrupt" Event Trigger

**Problem:** Event mode is "triggered by rainfall interrupt" but the sensor type and wiring are never specified. The firmware design depends on this.

| Option | Description |
|--------|-------------|
| `[x]` **Retain (gap)** | Hardware-level detail; document in the hardware BOM and firmware spec. |
| `[ ]` **Change** | Specify in the Hardware Node section: tipping bucket rain gauge on GPIO X, generates an interrupt on each tip (e.g., 0.2mm per tip). Three or more tips within 60 seconds triggers Event Mode. |
| `[ ]` **Re-architect** | N/A — a hardware specification gap. |

---

### 4.6 Graceful Shutdown on Critical Battery

**Problem:** If the node's battery dies, SD card write buffers may not be flushed. The write journaling strategy mitigates partial writes but a clean shutdown would be better.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain (gap)** | Accept it. The write journaling (§1.8) already handles partial writes on power loss. A graceful shutdown is a nice-to-have. |
| `[x]` **Change** | Add a voltage threshold below the Power Saving threshold: when triggered, flush all SD buffers, close files, and enter deep sleep indefinitely. Transmit a "shutdown" system health packet before sleeping. |
| `[ ]` **Re-architect** | N/A — a firmware feature addition. |

---

### 4.7 Testing and Validation Strategy

**Problem:** No mention of how the thesis validates accuracy — unit tests, integration tests, or comparison against a reference station. This is typically a core thesis chapter.

| Option | Description |
|--------|-------------|
| `[x]` **Retain (gap)** | Testing is out of scope for the architecture document. Address it in the thesis methodology chapter. |
| `[ ]` **Change** | Add a "Validation Plan" section to the architecture: describe co-deployment with a PAGASA or commercial reference station, the comparison period, and acceptable error margins for each sensor type. |
| `[ ]` **Re-architect** | N/A — a documentation and methodology gap. |

---

### 4.8 Ingestion API Memory Queue Bound

**Problem:** The failure mode mitigation says the API "buffers packets in memory (bounded queue)" when the DB is down — but the bound and overflow behavior are unspecified.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain (gap)** | Acknowledge it as an implementation detail to be decided. |
| `[x]` **Change** | Specify: queue bound = N minutes of data at max transmission rate. On overflow, oldest packets are dropped (not newest) and a counter is logged. Add queue depth to the health endpoint response. |
| `[ ]` **Re-architect** | Replace the in-memory queue with a small on-disk queue (e.g., append-only log file). Survives API restarts. More complex but more resilient. |

---

### 4.9 Database Migration Strategy

**Problem:** No tooling mentioned for applying TimescaleDB schema changes as the system evolves.

| Option | Description |
|--------|-------------|
| `[x]` **Retain (gap)** | For a thesis, manual migration scripts are acceptable. Document migration SQL in the repo. |
| `[ ]` **Change** | Add a migration tool (e.g., `node-pg-migrate`, `Flyway`, or `sqitch`). Migrations are versioned and applied automatically on API startup. |
| `[ ]` **Re-architect** | N/A — a tooling choice, not an architecture decision. |

---

### 4.10 WiFi as a Fallback to LTE

**Problem:** LTE is the only wireless transmission path. If an LTE SIM expires or has no signal but the node is within WiFi range (e.g., in an LGU office), there is no fallback.

| Option | Description |
|--------|-------------|
| `[ ]` **Retain (gap)** | LTE-only is a deliberate design choice for field deployment. WiFi is not available in the barangay locations this system targets. |
| `[x]` **Change** | Add WiFi as a secondary connection method. Node attempts WiFi first (configurable SSID/password stored in flash), falls back to LTE if WiFi is unavailable. Reduces LTE data cost in connected environments. |
| `[ ]` **Re-architect** | N/A — a hardware and firmware connectivity decision. |

---

*Mark each decision, then update ARCHITECTURE.md accordingly.*

---

## Section 5: Conflicts & Tie-Breakers

Three issues were found in the decisions above that require a ruling before ARCHITECTURE.md can be updated.

---

### C1: 1.1 (Retain) directly conflicts with 3.1 (Change)

**The conflict:**
- **1.1 Retain** says keep the architecture "as-is," which includes Convex proxying all TimescaleDB historical queries.
- **3.1 Change** says remove Convex from the historical data path entirely — historical queries go to a dedicated endpoint on the Fastify API, queried directly by the admin dashboard using a JWT.

These cannot both be true. The current "as-is" has Convex in the historical data path. 3.1 removes it.

**What you likely intended:** Keep all four services as billing/deployment units (don't drop Convex or Clerk), but restructure the data routing within them. This is coherent — it's just not the same as "Retain as-is."

**A secondary consequence:** If the admin dashboard queries the Fastify API directly with a JWT, something must issue that JWT. The natural answer is Clerk. That means Clerk becomes an auth provider for two backends: Convex and the Fastify API. The Fastify API needs to validate Clerk JWTs. This is doable (Clerk publishes a JWKS endpoint) but it's a new integration point not currently in the architecture.

**Decide:**

| Option | Description |
|--------|-------------|
| `[ ]` **A** | Truly retain as-is: undo 3.1, keep Convex as the proxy for all TimescaleDB queries. Accept the inefficiency. |
| `[x]` **B** | Accept the restructure: keep all four services but change the data routing per 3.1. Clarify that 1.1 "Retain" means "retain the service set, not the data flow." The Fastify API validates Clerk JWTs for direct historical queries. |
| `[ ]` **C** | Split the difference: Convex stays in the historical data path for *recent data* (last N days, already in Convex's cache-friendly range) but the Fastify API handles *long-range historical queries* directly. Reduces load on Convex actions without fully removing it from the path. |

---

### C2: 3.3 (Change: bearer API key) contradicts the Security Model you retained (1.7)

**The conflict:**
- **3.3 Change** replaces HMAC-SHA256 with a bearer API key per node, relying on CRC to compensate for lost payload integrity.
- **1.7 Retain** keeps the Security Model section as written — which explicitly states: *"The key is never sent over the wire"* and describes HMAC-SHA256 as the authentication mechanism with replay attack prevention.

These directly contradict each other. A bearer API key IS sent over the wire (in the `Authorization` header). If you retain the Security Model text but implement a bearer key, the architecture document is internally inconsistent.

**The deeper issue:** CRC-8 is not a cryptographic primitive. It detects accidental bit corruption, not intentional tampering. An attacker who intercepts a packet can modify the payload and trivially recalculate a valid CRC-8 (the algorithm is public and deterministic). HMAC-SHA256 prevents this because computing a valid signature requires the secret key. If you switch to bearer key + CRC, the payload can be forged in transit — the bearer key only proves who sent it at the connection level, not that the payload wasn't modified.

For a thesis with a dedicated Security Model section, this is a meaningful downgrade to defend.

**Decide:**

| Option | Description |
|--------|-------------|
| `[ ]` **A** | Revert 3.3 — keep HMAC-SHA256. Fix the documentation inconsistency by renaming the API table auth column to `HMAC-SHA256 (X-Node-Signature header)`. Security model remains intact. |
| `[x]` **B** | Proceed with bearer API key, but accept a weakened security model. Rewrite the Security Model section to accurately reflect bearer key + CRC, remove the "key never sent over the wire" claim, and explicitly document the trade-off (implementation simplicity over payload integrity). |
| `[ ]` **C** | Keep HMAC-SHA256 for payload signing but simplify how the key is provisioned and referenced. Fix the API table to say `HMAC-SHA256` and add a brief note clarifying it is not a simple API key. No implementation change — only documentation correction. |

---

### C3 (Advisory, no ruling required): 4.8 Re-architect (on-disk queue) goes against the simplification trend

**Not a conflict between decisions, but worth noting before implementation:**

Every other Section 1–2 decision simplifies the system (drop Electron, basic OTA only, drop schema-per-tenant, drop atomic journaling). 4.8 Re-architect bucks that trend by replacing a simple in-memory queue with an on-disk append-only log, which is more complex to implement and test correctly.

The original in-memory queue is acceptable for a thesis: if the API restarts during a DB outage, you lose buffered packets — but the SD card on the node already has that data. The on-disk queue's resilience benefit is partially redundant with the SD card recovery path (SD-to-Cloud Sync).

**No decision required** — flagged only so you can confirm this is intentional before implementation begins.

---

*Resolve C1 and C2 above, then the ARCHITECTURE.md update can proceed.*
