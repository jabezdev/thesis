# Project Sipat Banwa: Implementation Roadmap

This roadmap breaks the full system into eight milestones. Each milestone has its own specification file in `milestones/`. Build in this order — later milestones depend on earlier ones.

---

## Milestone Overview

| # | Milestone | Depends On | File |
|---|-----------|------------|------|
| M1 | Database Schema | — | [M1_DATABASE_SCHEMA.md](milestones/M1_DATABASE_SCHEMA.md) |
| M2 | Ingestion API | M1 | [M2_INGESTION_API.md](milestones/M2_INGESTION_API.md) |
| M3 | Hardware Node Firmware | M2 | [M3_HARDWARE_NODE.md](milestones/M3_HARDWARE_NODE.md) |
| M4 | Admin Backend (Auth + Admin API + Convex) | M1, M2 | [M4_ADMIN_BACKEND.md](milestones/M4_ADMIN_BACKEND.md) |
| M5 | Public Web App (PWA) | M2 | [M5_PUBLIC_PWA.md](milestones/M5_PUBLIC_PWA.md) |
| M6 | Admin Dashboard SPA | M4 | [M6_ADMIN_DASHBOARD.md](milestones/M6_ADMIN_DASHBOARD.md) |
| M7 | SD Card Extraction Tool | M2 | [M7_EXTRACTION_TOOL.md](milestones/M7_EXTRACTION_TOOL.md) |
| M8 | OTA & Fleet Management | M3, M4, M6 | [M8_OTA_FLEET.md](milestones/M8_OTA_FLEET.md) |

---

## Dependency Graph

```
M1 (DB Schema)
├── M2 (Ingestion API)
│   ├── M3 (Hardware Node) ──────────────────────┐
│   ├── M5 (Public PWA)                          │
│   └── M7 (Extraction Tool)                     │
└── M4 (Admin Backend)                           │
    └── M6 (Admin Dashboard) ────────────────────┤
                                                  ▼
                                            M8 (OTA & Fleet)
```

---

## Phase Descriptions

### Phase 1 — Foundation (M1 + M2)
Get data flowing from a node to the database. This is the critical path everything else depends on.
- M1: Define the TimescaleDB schema — tables, RLS policies, materialized view, upsert logic.
- M2: Build the Fastify Ingestion API — binary packet parsing, authentication, TimescaleDB writes.

### Phase 2 — Hardware (M3)
Implement the ESP32 firmware. Requires a running Ingestion API endpoint to test against.
- Binary packet encoding, SD card logging, adaptive modes, connectivity.

### Phase 3 — Admin Infrastructure (M4)
Set up Clerk auth, Convex, and the Admin API endpoints for node provisioning and metadata management.

### Phase 4 — User-Facing Frontends (M5 + M6)
Build the public PWA and the admin dashboard. Can be developed in parallel once M4 is complete.

### Phase 5 — Field Tools (M7)
Build the Tauri-based SD Card Extraction Tool. Depends on the Ingestion API's ingest endpoint being stable.

### Phase 6 — OTA & Fleet Management (M8)
Implement OTA firmware delivery, the command/response protocol, and fleet health monitoring. Depends on the node firmware (M3), admin backend (M4), and admin dashboard (M6) all being functional.

---

## Integration Testing
See [TESTING.md](TESTING.md) for integration tests between milestones and end-to-end system validation.
