# M6: Admin Dashboard SPA

**Depends on**: M4 (Admin Backend — Clerk + Convex + Admin API)
**Required by**: M8 (OTA & Fleet Management)

---

## What This Milestone Delivers

A Clerk-authenticated Single Page Application at `dashboard.panahon.live` for LGU administrators. Provides node management, historical data visualization, real-time health monitoring, alert rule configuration, and a Big Screen display mode for command centers.

---

## Requirements

### Authentication
- Clerk-powered sign-in page. Supports email/password and social login.
- After sign-in, the Clerk JWT is used for all Fastify API calls (Historical + Admin endpoints).
- Org-scoped: admin can only view nodes within their own LGU workspace.

### Node List View (`/nodes`)
- Lists all nodes in the workspace with status indicators: **online** / **degraded** / **offline**.
  - Online: weather reading received within 1× expected interval for current mode.
  - Degraded: 1×–2× interval without a reading.
  - Offline: >2× interval without a reading.
- Shows last reading timestamp, battery voltage, signal strength (RSSI), and current operational mode for each node.
- "Provision New Node" button: opens provisioning flow (see below).

### Node Provisioning Flow
1. Admin clicks "Provision New Node."
2. Dashboard calls `POST /api/v1/admin/nodes` (Clerk JWT).
3. Modal displays the generated API key with a copy button.
4. Warning: "This key will not be shown again. Copy it now and flash it to the node firmware."
5. Admin can then set label, location, and barangay for the new node via `PUT /api/v1/admin/nodes/:node_id`.

### Node Detail View (`/nodes/:node_id`)
- **Live readings panel**: Temperature, humidity, rainfall — updated via Convex real-time subscription when a new reading arrives.
- **Historical chart**: Line/bar chart of the last 7 days. Data from `GET /api/v1/historical/:node_id` (Clerk JWT).
- **System health panel**: Battery voltage trend, RSSI history, operational mode history.
- **Sensor threshold editor**: Per-sensor min/max range inputs. Save → `PUT /api/v1/admin/nodes/:node_id`.
- **Clock drift indicator**: Shows `is_time_reconciled` rate as a percentage of recent readings.

### Alert Rules (`/alerts`)
- List all active alert rules for the workspace.
- Create/edit/delete rules via Convex mutations.
- Each rule: sensor type, condition (above/below), threshold, target node (or all nodes).
- When a rule fires (detected by comparing incoming readings against rules): notify admin via a visual alert banner in the dashboard (real-time via Convex subscription).

### User Preferences (`/settings`)
- Theme (light/dark).
- Default node to show on dashboard home.
- Stored in Convex `userPreferences`.

### Big Screen Mode
- Available from any node list or aggregate view.
- Admin clicks "Enter Full Screen" → browser enters fullscreen; dashboard layout switches to a large-format display:
  - Grid of node cards showing current temp, humidity, rainfall, and node status.
  - Auto-refreshes via Convex real-time subscription.
  - No separate URL. Requires the admin to be logged in.
- Exit: press Escape or click "Exit Full Screen."

---

## Interactions

| Interacts With | Direction | How |
|----------------|-----------|-----|
| M4 Clerk | authenticates via → | Clerk components for sign-in; JWT attached to all API calls |
| M4 Convex | subscriptions + mutations → | Alert rules, user preferences, pending commands, real-time node events |
| M2 Ingestion API (Historical + Admin) | fetches + posts → | Historical charts, node provisioning, metadata updates |
| M8 OTA | triggers via → | "Push Firmware Update" button calls `createPendingCommand` Convex mutation |

---

## Testing Checklist

### Authentication
- [ ] Unauthenticated user is redirected to the Clerk sign-in page
- [ ] After sign-in, the dashboard is accessible
- [ ] User from workspace A cannot see nodes from workspace B
- [ ] Sign-out clears the session; further requests to admin APIs return `401`

### Node List & Status
- [ ] All nodes in the workspace are listed
- [ ] A node that has transmitted within 1× its interval shows "online" (green)
- [ ] A node that hasn't transmitted for >2× its interval shows "offline" (red)
- [ ] Status indicators update in real-time without a page refresh (via Convex subscription)

### Node Provisioning
- [ ] Clicking "Provision New Node" calls `POST /api/v1/admin/nodes` and displays the generated key
- [ ] The modal shows a copy button; copying places the key in the clipboard
- [ ] After provisioning, the new node appears in the node list
- [ ] Refreshing the page does NOT show the API key again (it is not stored in the UI)

### Node Detail — Historical Data
- [ ] Historical chart loads data from the Fastify Historical API
- [ ] Chart correctly renders temperature as °C and rainfall as mm over time
- [ ] Changing the time range (e.g., last 24 hours vs last 7 days) updates the chart
- [ ] `is_time_reconciled = true` readings are visually flagged on the chart

### Sensor Threshold Configuration
- [ ] Editing and saving a threshold for a node calls `PUT /api/v1/admin/nodes/:node_id`
- [ ] The next ingest request for that node uses the updated threshold for range validation (verify via a test packet)

### Alert Rules
- [ ] Creating an alert rule via the dashboard saves it in Convex and appears in the list
- [ ] Deleting an alert rule removes it from Convex
- [ ] An alert banner appears in the dashboard when a reading crosses a threshold

### Big Screen Mode
- [ ] "Enter Full Screen" button triggers browser fullscreen and switches to the display layout
- [ ] All workspace nodes are shown on the big screen with current readings
- [ ] Readings update automatically without manual refresh
- [ ] Pressing Escape exits fullscreen mode and returns to the normal dashboard layout

### OTA Push (UI entry point — full test in M8)
- [ ] "Push Firmware Update" button on a node detail page is visible
- [ ] Clicking the button with a firmware URL calls the `createPendingCommand` Convex mutation
- [ ] The node's status in the dashboard shows a pending OTA indicator
