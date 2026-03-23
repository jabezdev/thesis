# M1: Database Schema

**Depends on**: nothing
**Required by**: M2 (Ingestion API), M4 (Admin Backend)

---

## What This Milestone Delivers

A fully initialized TimescaleDB instance with all tables, policies, indexes, and views needed to store and serve Project Sipat Banwa data. No application code runs before this is in place.

---

## Requirements

### Tables

#### `workspaces`
Represents an LGU tenant.
- `workspace_id` UUID PRIMARY KEY
- `name` TEXT NOT NULL
- `created_at` TIMESTAMPTZ DEFAULT now()

#### `nodes`
One row per deployed hardware node.
- `node_id` UUID PRIMARY KEY
- `workspace_id` UUID REFERENCES workspaces(workspace_id)
- `api_key` TEXT UNIQUE NOT NULL — the bearer key used by the node; doubles as its identifier on the ingestion path
- `label` TEXT
- `barangay` TEXT
- `location_name` TEXT
- `hardware_version` TEXT
- `firmware_version` TEXT
- `is_active` BOOLEAN DEFAULT true
- `created_at` TIMESTAMPTZ DEFAULT now()

#### `weather_readings`
TimescaleDB hypertable. One row per transmitted block average.
- `time` TIMESTAMPTZ NOT NULL — the reading timestamp (may be reconciled)
- `node_id` UUID REFERENCES nodes(node_id)
- `workspace_id` UUID — denormalized for RLS
- `temperature_c` NUMERIC(5,2)
- `humidity_pct` NUMERIC(5,2)
- `rainfall_mm` NUMERIC(6,3)
- `rainfall_min` NUMERIC(6,3)
- `rainfall_max` NUMERIC(6,3)
- `packet_version` SMALLINT NOT NULL
- `is_time_reconciled` BOOLEAN DEFAULT false
- `created_at` TIMESTAMPTZ DEFAULT now()

#### `system_health_readings`
TimescaleDB hypertable. One row per System Health payload received.
- `time` TIMESTAMPTZ NOT NULL
- `node_id` UUID REFERENCES nodes(node_id)
- `workspace_id` UUID — denormalized for RLS
- `battery_mv` INTEGER
- `solar_charging` BOOLEAN
- `rssi_dbm` SMALLINT
- `free_heap_bytes` INTEGER
- `uptime_ms` BIGINT
- `sd_free_kb` INTEGER
- `operational_mode` SMALLINT — 1=High Alert, 2=Nominal, 3=Power Saving, 0=Shutdown
- `packet_version` SMALLINT NOT NULL
- `is_time_reconciled` BOOLEAN DEFAULT false

#### `sensor_fault_events`
Logged whenever the Ingestion API rejects an out-of-range value with a `400`.
- `id` BIGSERIAL PRIMARY KEY
- `node_id` UUID REFERENCES nodes(node_id)
- `workspace_id` UUID
- `time` TIMESTAMPTZ DEFAULT now()
- `sensor_type` TEXT — e.g., `temperature`, `humidity`, `rainfall`
- `rejected_value` NUMERIC
- `threshold_min` NUMERIC
- `threshold_max` NUMERIC

#### `sensor_thresholds`
Per-node, per-sensor min/max range configuration.
- `node_id` UUID REFERENCES nodes(node_id)
- `sensor_type` TEXT
- `threshold_min` NUMERIC
- `threshold_max` NUMERIC
- PRIMARY KEY (`node_id`, `sensor_type`)

### Hypertable Configuration
- Convert `weather_readings` and `system_health_readings` to hypertables partitioned by `time` with a 1-week chunk interval.
- Enable TimescaleDB compression on chunks older than 30 days.

### Row-Level Security (RLS)
Enable RLS on `weather_readings`, `system_health_readings`, `sensor_fault_events`, `sensor_thresholds`, and `nodes`.

Policy for authenticated queries:
```sql
CREATE POLICY workspace_isolation ON weather_readings
  USING (workspace_id = current_setting('app.workspace_id')::uuid);
```

Apply the same policy pattern on all tables with a `workspace_id` column.

### Materialized View (Public Read)
A separate read-only database role (`public_reader`) and a pre-computed view for unauthenticated public endpoints.

```sql
CREATE MATERIALIZED VIEW public_latest_readings AS
  SELECT DISTINCT ON (node_id)
    node_id,
    time AS last_reading_at,
    temperature_c,
    humidity_pct,
    rainfall_mm
  FROM weather_readings
  ORDER BY node_id, time DESC;
```

- Refresh on a scheduled interval (e.g., every 1 minute via `pg_cron`).
- Grant `SELECT` on this view only to the `public_reader` role.
- The `public_reader` role has no access to the base hypertables.

### Idempotent Upsert
All inserts into `weather_readings` and `system_health_readings` use `ON CONFLICT (node_id, time) DO NOTHING` (or `DO UPDATE` for reconciled timestamps).

### Indexes
- `weather_readings (node_id, time DESC)` — for latest-reading queries
- `weather_readings (workspace_id, time DESC)` — for RLS-filtered workspace queries
- `nodes (api_key)` — for auth lookup (key is UNIQUE, index is implicit)

---

## Interactions

| Interacts With | Direction | How |
|----------------|-----------|-----|
| M2 Ingestion API | writes → | Fastify inserts weather and health rows via parameterized SQL |
| M4 Admin Backend | reads + writes → | Admin API reads/writes `nodes` table; Historical API queries hypertables |
| M5 Public PWA | reads → | Public API queries `public_latest_readings` view via `public_reader` role |
| M6 Admin Dashboard | reads → | Admin dashboard queries hypertables via Clerk JWT (workspace RLS applied) |

---

## Testing Checklist

### Schema Integrity
- [ ] All six tables exist with correct column types
- [ ] `weather_readings` and `system_health_readings` are TimescaleDB hypertables (verify with `\d+ table_name` or `SELECT * FROM timescaledb_information.hypertables`)
- [ ] Compression policy is configured on both hypertables

### RLS Policies
- [ ] Connecting as a role with `SET LOCAL app.workspace_id = '<workspace_a_id>'` only returns rows for workspace A from `weather_readings`
- [ ] Connecting without setting `app.workspace_id` returns 0 rows (policy blocks unset context)
- [ ] `public_reader` role can query `public_latest_readings` view
- [ ] `public_reader` role cannot query `weather_readings` directly (permission denied)

### Materialized View
- [ ] `public_latest_readings` contains exactly one row per node (the most recent reading)
- [ ] Running `REFRESH MATERIALIZED VIEW public_latest_readings` updates the view with a new inserted row
- [ ] View does not expose `workspace_id`

### Idempotent Upsert
- [ ] Insert a row into `weather_readings`. Insert the same row again (same `node_id` + `time`). Verify only one row exists.
- [ ] An insert with `is_time_reconciled = true` for an existing timestamp does not raise an error

### Indexes
- [ ] Query plan for `SELECT ... FROM weather_readings WHERE node_id = $1 ORDER BY time DESC LIMIT 1` uses an index scan (not seq scan)
- [ ] Query plan for `SELECT ... FROM nodes WHERE api_key = $1` uses an index scan

### Sensor Thresholds
- [ ] Insert a row into `sensor_thresholds` for a node. Insert again with the same `(node_id, sensor_type)` — verify upsert behavior (no duplicate key error)

### Test Data Seed
- [ ] A seed script exists that populates at least 1 workspace, 2 nodes with different `workspace_id` values, and 10 rows each in `weather_readings` and `system_health_readings`
- [ ] RLS test above works against this seed data
