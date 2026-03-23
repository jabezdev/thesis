# M8: OTA & Fleet Management

**Depends on**: M3 (Hardware Node), M4 (Admin Backend), M6 (Admin Dashboard)
**Required by**: nothing downstream (final milestone)

---

## What This Milestone Delivers

End-to-end OTA firmware delivery: admin triggers an update from the dashboard, the command persists in Convex, the Ingestion API delivers it via `X-Cmd` header on the node's next heartbeat, and the node downloads and applies the new firmware. Also includes fleet health alerting (silent nodes, clock drift, battery) wired up from dashboard to Convex.

---

## Requirements

### OTA Firmware Delivery

#### Server Side
1. Admin uploads a compiled `.bin` firmware file via the Admin Dashboard.
2. The API server stores the `.bin` in a local directory (or object storage) and records the URL.
3. Admin selects a target node and clicks "Push Firmware Update."
4. The dashboard calls the Convex mutation `createPendingCommand(nodeId, "ota", firmwareUrl)`.
5. The Ingestion API checks `pendingCommands` via a Convex action on every ingest call for that node.
6. When the node's next ingest arrives: API sets `X-Cmd: ota=<firmwareUrl>` in the response, then calls `markCommandDelivered(commandId)`.

**Firmware endpoint**: `GET /api/v1/firmware/:filename` — serves `.bin` files. No authentication required (URL is unguessable; the node downloads directly). Rate-limited.

#### Node Side (ESP32)
On receiving `X-Cmd: ota=<url>`:
1. Start an OTA session: `esp_ota_begin()` on the inactive partition (`ota_0` or `ota_1`).
2. Download the `.bin` over HTTPS in chunks, writing each chunk via `esp_ota_write()`. Use the same connection (WiFi preferred, LTE fallback).
3. On download complete: `esp_ota_end()`, then `esp_ota_set_boot_partition()` and `esp_restart()`.
4. If download fails at any point (timeout, HTTP error): `esp_ota_abort()`. Log failure to SD card. Remain on the current firmware. Next ingest will re-receive the `X-Cmd` (pending command is not cleared on a failed delivery — the Ingestion API only clears it after a confirmed response, not on a failed download).

**Rollback**: If the new firmware panics on boot, `esp_ota` automatically reverts to the previous partition. The node resumes with the old firmware and the admin sees `firmware_version` has not changed on the next health report.

**Firmware version reporting**: The System Health payload includes the running `firmware_version` string. The Ingestion API stores this in the `nodes` table on each health packet receive. The Admin Dashboard displays it on the node detail page.

### Fleet Health Alerting

Alert conditions evaluated in Convex (triggered by real-time data from Ingestion API writes):

| Alert | Condition | Delivery |
|-------|-----------|---------|
| Node offline | No weather reading for >2× the mode-specific interval | Convex scheduled function checks at 5-min intervals; creates alert doc; dashboard shows banner |
| Low battery | `battery_mv` below configured warning threshold | Evaluated on each Health payload ingested; alert doc created in Convex |
| Clock drift | Ingestion API flags `is_time_reconciled = true` on >10% of last 20 readings | Evaluated by Ingestion API; fires NTP re-sync via `X-Cmd: ntp_sync`; creates alert doc |
| Firmware out of date | Node's `firmware_version` ≠ latest staged version | Checked by Convex scheduled function daily |

Alert documents in Convex:
```typescript
alerts: defineTable({
  workspaceId: v.string(),
  nodeId: v.string(),
  alertType: v.string(), // "offline" | "low_battery" | "clock_drift" | "firmware_outdated"
  message: v.string(),
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
})
```

Alerts are displayed as banners in the Admin Dashboard via real-time Convex subscription. Resolved automatically when the condition clears.

### Firmware Upload Endpoint
`POST /api/v1/admin/firmware` (Clerk JWT required):
- Accepts a multipart form upload of a `.bin` file.
- Validates file type and size (max 2 MB for ESP32 firmware).
- Saves to `./firmware/<version>-<timestamp>.bin`.
- Returns the firmware URL for use in the OTA push command.

---

## Interactions

| Interacts With | Direction | How |
|----------------|-----------|-----|
| M3 Hardware Node | commands → | `X-Cmd: ota=<url>` delivered via Ingestion API response; node downloads `.bin` |
| M4 Convex | reads + writes → | `pendingCommands` created by admin action; read and cleared by Ingestion API |
| M2 Ingestion API | delivers via → | Checks Convex for pending commands on each ingest; returns `X-Cmd` header |
| M6 Admin Dashboard | triggered from → | "Push Firmware Update" button creates Convex pending command; alert banners from Convex subscriptions |

---

## Testing Checklist

### OTA — Server Side
- [ ] Uploading a `.bin` via `POST /api/v1/admin/firmware` stores the file and returns a URL
- [ ] The firmware URL is accessible via `GET /api/v1/firmware/:filename` without authentication
- [ ] Calling `createPendingCommand(nodeId, "ota", url)` creates a Convex doc with `status: pending`
- [ ] On the next simulated ingest for that node: response includes `X-Cmd: ota=<url>`
- [ ] After command delivery, Convex doc status changes to `delivered`
- [ ] If the Ingestion API restarts before delivery: the next ingest for that node still receives the `X-Cmd` (command persisted in Convex)

### OTA — Node Side
- [ ] Node receives `X-Cmd: ota=<url>` and initiates download
- [ ] Firmware is written to the inactive OTA partition
- [ ] After successful download: node restarts and boots into the new firmware
- [ ] New firmware's `firmware_version` string is reported in the next Health payload
- [ ] **Failure case**: if the download URL is unreachable: `esp_ota_abort()` is called; node stays on current firmware; fault logged to SD card; pending command NOT cleared (so next heartbeat will retry delivery)
- [ ] **Rollback**: load a firmware that immediately panics on boot; verify `esp_ota` rolls back to the previous partition automatically

### Fleet Health Alerting
- [ ] Stopping a node's transmissions for >2× its interval: offline alert appears in the Admin Dashboard within one Convex check cycle (5 minutes)
- [ ] When the node resumes transmitting: offline alert is automatically resolved
- [ ] Injecting a health packet with `battery_mv` below the warning threshold: low battery alert appears in the dashboard
- [ ] Injecting 10+ consecutive reconciled timestamps: clock drift alert appears and `X-Cmd: ntp_sync` is sent on the next ingest

### Firmware Version Tracking
- [ ] After a node boots new firmware, its `firmware_version` in the `nodes` table updates within one Health payload cycle
- [ ] Admin Dashboard node detail page shows the new firmware version without a page refresh
- [ ] If staged firmware version > node's current version: "Firmware update available" indicator shows on the node card
