# M7: SD Card Extraction Tool

**Depends on**: M2 (Ingestion API — ingest endpoint must be stable for sync)
**Required by**: nothing downstream (standalone field utility)

---

## What This Milestone Delivers

A Tauri desktop application that reads raw sensor CSV logs from a node's SD card, validates CRC-8 per row, exports clean data to a local CSV file, and optionally syncs the data to TimescaleDB via the Ingestion API using admin Clerk authentication.

---

## Requirements

### Technology
- **Framework**: Tauri (Rust backend + OS WebView frontend).
- **Frontend**: Standard HTML/CSS/JS — same web stack as the rest of the project.
- **Target platforms**: Windows, macOS, Linux (Tauri supports all three from one codebase).
- **Distributed as**: a single native binary installer. No Chromium bundled; no Node.js required on the field operator's computer.

### Core Workflow

1. **Mount SD card**: Operator inserts the node's SD card into their computer.
2. **Open folder**: Operator selects the SD card directory in the tool.
3. **Parse & validate**: The tool reads all CSV files in the directory, validates each row's CRC-8, and separates valid rows from corrupted rows.
4. **Review**: Tool shows a summary — total rows, valid rows, corrupted rows, date range.
5. **Export**: Operator clicks "Export to CSV" → clean, validated data is written to a local CSV file on the operator's computer.
6. **Sync (optional)**: Operator clicks "Sync to Cloud" → tool prompts for a Clerk login (opens browser to Clerk sign-in if not already authenticated), then uploads each valid row to the Ingestion API one packet at a time.

### CSV Parsing

Input format (from M3 SD card logging):
```
rtc_timestamp,uptime_ms,temperature_c,humidity_pct,rainfall_mm,rainfall_min,rainfall_max,crc8
```

Validation rules per row:
- Parse each field as the correct type; skip rows with parse errors (log as "corrupted").
- Compute CRC-8 over all fields except the `crc8` column. Compare with stored `crc8`. Mismatch → skip row (log as "corrupted").
- If `rtc_timestamp` predates the deployment epoch constant, flag row as `time_reconciled_needed = true` (the Ingestion API will handle reconciliation on upload).

### Fault Event Display
Corrupted rows (CRC mismatch or parse error) are shown in a separate "Faults" tab with the row number, the raw content, and the failure reason. The operator can export fault rows to a separate CSV for manual inspection.

### Export Format
Output CSV:
```
source_file,row_number,rtc_timestamp,uptime_ms,temperature_c,humidity_pct,rainfall_mm,rainfall_min,rainfall_max,is_time_reconciled_needed,crc8_valid
```

### Cloud Sync

**Authentication**: The tool requests an admin Clerk JWT before syncing. This can be done via:
- A local Clerk auth token stored in the OS keychain after first login (using Tauri's `tauri-plugin-store`).
- Or browser-based sign-in flow redirecting back to the app.

The Clerk JWT is sent as `Authorization: Bearer <jwt>` on each sync request to `POST /api/v1/ingest`. The `X-Node-ID` header must be set (selected by the operator from a dropdown of known nodes).

**Sync sequence**:
1. Operator selects the target node from a dropdown (fetched from `GET /api/v1/admin/nodes`, Clerk JWT).
2. Tool iterates over valid parsed rows.
3. For each row: construct a binary packet (V1 format) and POST to `/api/v1/ingest`.
4. Show a progress bar: `N of M packets synced`.
5. On `400` (duplicate or rejected): log to a sync fault report; continue.
6. On `5xx`: retry once; if failure persists, pause sync and show error with a "Resume" button.
7. After sync: show a summary — synced, skipped (duplicate), faulted.

**Idempotency**: The Ingestion API's `ON CONFLICT DO NOTHING` ensures that re-syncing the same card is safe.

### No SD Key Storage
The node's bearer API key is never stored on the SD card and is not required by the Extraction Tool. The tool authenticates as an admin, not as a node.

---

## Interactions

| Interacts With | Direction | How |
|----------------|-----------|-----|
| M2 Ingestion API | sends → | `POST /api/v1/ingest` (per row) with Clerk JWT + `X-Node-ID` |
| M2 Ingestion API (Admin) | fetches from → | `GET /api/v1/admin/nodes` to populate node selector dropdown |
| M4 Clerk | authenticates via → | Clerk JWT for admin-tier access |
| M3 SD Card | reads from → | CSV files written by the Hardware Node firmware |

---

## Testing Checklist

### Parsing & Validation
- [ ] Tool reads a valid CSV from a test SD card directory and displays correct row count, date range
- [ ] A row with a mismatched CRC-8 appears in the "Faults" tab and is excluded from the export
- [ ] A row with a parse error (e.g., non-numeric temperature) appears in "Faults" and is excluded
- [ ] A row with `rtc_timestamp` before the deployment epoch is parsed successfully and flagged `time_reconciled_needed = true`

### Export
- [ ] "Export to CSV" writes a valid CSV file to the selected output directory
- [ ] Exported CSV contains only valid rows (faulted rows are absent)
- [ ] Exporting a second time to the same file overwrites (not appends)

### Cloud Sync — Authentication
- [ ] Clicking "Sync to Cloud" without a stored Clerk session opens the browser sign-in flow
- [ ] After sign-in, the JWT is stored and subsequent syncs do not require re-authentication
- [ ] An invalid/expired JWT results in a clear error message (not a silent failure)

### Cloud Sync — Upload
- [ ] Each row is converted to a correct V1 binary packet (matching the M3 format)
- [ ] CRC-8 of each generated packet is correct
- [ ] Progress bar advances as packets are uploaded
- [ ] Uploading the same SD card twice: all packets are accepted by the API (`ON CONFLICT DO NOTHING`); no error shown to operator
- [ ] A `400` response from the server is logged in the sync fault report; sync continues with the next row
- [ ] A `5xx` response pauses sync and shows a "Resume" button; clicking Resume continues from the last failed row

### Node Selector
- [ ] The node dropdown is populated from `GET /api/v1/admin/nodes` using the admin Clerk JWT
- [ ] Selecting the correct node sets the `X-Node-ID` header on sync requests

### Tauri Build
- [ ] The app builds successfully for the target platform (Windows or Linux)
- [ ] The installer/binary size is under 20 MB
- [ ] The app launches without requiring Node.js, Python, or any developer toolchain on the target machine
