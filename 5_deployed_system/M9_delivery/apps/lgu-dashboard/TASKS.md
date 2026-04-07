# LGU Dashboard — Implementation Tasks

This document tracks the remaining implementation work for `apps/lgu-dashboard` (`dashboard.panahon.live`). Tasks are ordered by dependency — complete them roughly top-to-bottom.

---

## Phase 0: Convex Backend (Prerequisite for most features)

The `convex/` folder only has a `schema.ts`. No query or mutation functions exist yet.

- [ ] **0.1 — Deploy Convex project**
  - Run `npx convex dev` from the monorepo root to link and deploy the project.
  - Set `VITE_CONVEX_URL` env var in `apps/lgu-dashboard/.env`.

- [ ] **0.2 — Write `convex/nodes.ts`**
  - `listNodes` — public query: returns all node records (id, name, location, status, calibration).
  - `getNode` — query by `node_id`.
  - `upsertNode` — internal mutation for admin-console use (create/update a node record).
  - `setNodeStatus` — mutation to flip `status` field (`active | maintenance | offline`).

- [ ] **0.3 — Write `convex/alerts.ts`**
  - `listActiveAlerts` — query: returns all `resolved: false` alerts, ordered by `triggered_at desc`.
  - `resolveAlert` — mutation: sets `resolved: true` and `resolved_at`.
  - `createAlert` — internal mutation: inserts a new alert row (to be called by processor or admin).

- [ ] **0.4 — Write `convex/users.ts`**
  - `getMe` — query using Clerk `identity` to look up the current user's role and `lgu_region`.
  - `upsertUser` — mutation called on first sign-in (create or update user record from Clerk token).

---

## Phase 1: Auth (Clerk)

- [ ] **1.1 — Install and configure `ClerkProvider`**
  - Wrap `<App />` in `<ClerkProvider publishableKey={...}>` inside `main.tsx`.
  - Store `VITE_CLERK_PUBLISHABLE_KEY` in `apps/lgu-dashboard/.env`.

- [ ] **1.2 — Gate the entire app behind sign-in**
  - Use `<SignedIn>` / `<SignedOut>` from `@clerk/clerk-react`.
  - Show a centered `<SignIn />` component (Clerk-hosted or embedded) when signed out.
  - Redirect to the dashboard on successful sign-in.

- [ ] **1.3 — Sync Clerk user → Convex on first load**
  - After sign-in, call the `convex/users:upsertUser` mutation with the Clerk identity payload.
  - Use `useConvexAuth()` to wait for Convex auth to be ready before querying.

- [ ] **1.4 — Display user info in header**
  - Replace the static "Current Status" block with a `<UserButton />` from Clerk (avatar + sign-out dropdown).
  - Show the user's role badge (from Convex `getMe`) next to the avatar.

---

## Phase 2: Node Selector

- [ ] **2.1 — Fetch node list from Convex**
  - Use `useQuery(api.nodes.listNodes)` to get all nodes.
  - Store the selected `node_id` in component state (default to first node in list).

- [ ] **2.2 — Build `<NodeSelector>` dropdown component**
  - Lives in a new file `src/components/NodeSelector.tsx`.
  - Renders a styled `<select>` or custom dropdown showing `node.name` with a colored status dot (green = active, amber = maintenance, red = offline).
  - On change, updates the selected `node_id` state which drives all Firebase listeners and Firestore queries.

- [ ] **2.3 — Make Firebase listeners reactive to selected node**
  - Change the hardcoded `nodes/node_1/latest` RTDB ref to `nodes/${selectedNodeId}/latest`.
  - Re-subscribe when `selectedNodeId` changes (put it in the `useEffect` dependency array).
  - Do the same for the Firestore historical query (`where('node_id', '==', selectedNodeId)`).

---

## Phase 3: Calibration

- [ ] **3.1 — Fetch calibration constants from Convex**
  - When the selected node changes, run `useQuery(api.nodes.getNode, { node_id: selectedNodeId })` to get its calibration object.

- [ ] **3.2 — Apply `applyCalibration()` to live data**
  - Import `applyCalibration` and `DEFAULT_CALIBRATION` from `@panahon/shared`.
  - In the `onValue` callback, wrap the raw snapshot with `applyCalibration(raw, nodeCalibration ?? DEFAULT_CALIBRATION)`.
  - Store `ProcessedData` (not `RawSensorData`) in state; update all display references to use `_corrected` fields.

- [ ] **3.3 — Apply calibration to historical chart data**
  - In `fetchHistory`, map each Firestore doc through `applyCalibration(...)` before pushing to state.
  - Update chart `dataKey` props to `rain_corrected`, `temp_corrected`, etc.

- [ ] **3.4 — Show a "Calibrated" badge**
  - When calibration is loaded and not DEFAULT, display a small green "Calibrated" badge near the stats section so it's clear to LGU users the data is corrected.

---

## Phase 4: Live Map (MapLibre GL)

- [ ] **4.1 — Install MapLibre GL**
  - `bun add maplibre-gl` in `apps/lgu-dashboard`.
  - Add `import 'maplibre-gl/dist/maplibre-gl.css'` to `index.css` or `main.tsx`.

- [ ] **4.2 — Create `<NodeMap>` component** (`src/components/NodeMap.tsx`)
  - Initialise a MapLibre map using a free tile source (e.g. OpenFreeMap Positron style: `https://tiles.openfreemap.org/styles/positron`).
  - The map container should fill the existing 500px card slot.
  - On unmount, call `map.remove()` to prevent memory leaks.

- [ ] **4.3 — Plot nodes as markers**
  - For each node returned by Convex `listNodes`, add a `Marker` at `[node.location.lng, node.location.lat]`.
  - Marker colour: green for `active`, amber for `maintenance`, red for `offline`.
  - On marker click, show a `Popup` with node name, latest temp/rain/hum (from RTDB), and uptime.

- [ ] **4.4 — Fly-to on node switch**
  - When the selected node changes in the `<NodeSelector>`, call `map.flyTo({ center: [lng, lat], zoom: 14 })`.

- [ ] **4.5 — Dark mode tile swap**
  - Detect `prefers-color-scheme: dark` (or a manual dark toggle) and switch to a dark tile style (e.g. OpenFreeMap Dark).

---

## Phase 5: Alerts (Convex)

- [ ] **5.1 — Replace hardcoded alert with real data**
  - Use `useQuery(api.alerts.listActiveAlerts)` to get live alerts.
  - Render one `<Card>` per alert with the correct `variant` (warning → amber, critical → rose).
  - Show a "No active alerts" empty state when the list is empty.

- [ ] **5.2 — Alert dismissal**
  - Add a small ✕ button on each alert card that calls the `resolveAlert` mutation with the alert's `_id`.
  - Optimistically remove it from the list on click.

- [ ] **5.3 — Alert count badge in header**
  - Show a red count badge on the header (e.g. next to the "DRRM Command Center" badge) when `activeAlerts.length > 0`.

---

## Phase 6: Charts — Humidity & Power Metrics

- [ ] **6.1 — Add Humidity 24h chart**
  - Add a third chart card (alongside Rainfall and Temp) showing a `LineChart` with `dataKey="hum_corrected"`.
  - Use a teal/cyan color scheme.

- [ ] **6.2 — Create Power Metrics stacked chart** (`src/components/PowerChart.tsx`)
  - Full-width card below the three weather charts.
  - Use a `ComposedChart` with two `Line`s:
    - Battery voltage (`batt_v`) — use a solid amber line.
    - Solar voltage (`solar_v`) — use a dashed green line.
  - Add a right-side `YAxis` for current values (`batt_i`, `solar_i`) as `Bar` or a second overlay.
  - Label: "Power System (24h)" with a ⚡ icon.

- [ ] **6.3 — Responsive chart layout**
  - Restructure the chart grid so the three weather charts are `md:grid-cols-3` and the power chart spans full width.

---

## Phase 7: History View & Date Range

- [ ] **7.1 — Wire up the "History" button in the nav**
  - Clicking "History" should toggle a full-page overlay/drawer (`position: fixed, inset-0`) containing the extended history UI.
  - The overlay should have a close button and keyboard `Escape` support.

- [ ] **7.2 — Date range picker**
  - Add a simple date-range input (two `<input type="date">` fields: "From" and "To") inside the history overlay.
  - Default range: last 7 days.
  - On change, re-run the Firestore query with the new date bounds.

- [ ] **7.3 — History charts in the overlay**
  - Show the same rainfall, temp, humidity, and power charts but with the selected range's data.

---

## Phase 8: CSV Export

- [ ] **8.1 — Create `<ExportModal>` component** (`src/components/ExportModal.tsx`)
  - Triggered by clicking "Export Daily Report" quick-action button.
  - Modal contains:
    - Node selector (pre-filled with currently selected node).
    - "From" / "To" date inputs.
    - Checkbox group to choose which fields to include (Temp, Humidity, Rainfall, Battery, Solar).
    - "Export CSV" primary button.
    - "Cancel" secondary button.

- [ ] **8.2 — Implement CSV generation logic**
  - On confirm, fetch the Firestore data for the selected node + date range (no limit, or paginate up to 50k rows).
  - Apply `applyCalibration()` to each row.
  - Build a CSV string with headers matching selected fields.
  - Trigger a download via `URL.createObjectURL(new Blob([csvString], { type: 'text/csv' }))` + programmatic anchor click.
  - Filename format: `panahon_{node_id}_{from}_{to}.csv`.

- [ ] **8.3 — Loading state during export**
  - Show a spinner and disable the button while fetching data (can be a large query).

---

## Phase 9: Polish & UX

- [ ] **9.1 — Dark mode toggle**
  - Add a sun/moon icon button in the header that toggles the `dark` class on `<html>`.
  - Persist preference in `localStorage`.

- [ ] **9.2 — Loading skeletons**
  - While `latestData` is `null` (initial load), show animated skeleton placeholders in the stat cards instead of `--`.

- [ ] **9.3 — "Broadcast Warning" modal (stub)**
  - Clicking "Broadcast Warning" should open a confirmation modal with a text area for the warning message.
  - On confirm, `console.log` the payload (actual SMS/PA integration out of scope for M9).

- [ ] **9.4 — Sticky sidebar node-context**
  - When the node selector is in the header and the user scrolls down, the currently selected node name + live status dot should remain visible in the sticky header.

- [ ] **9.5 — Error boundaries**
  - Wrap map, charts, and Firebase sections in React error boundaries so a crash in one panel doesn't take down the whole dashboard.

---

## Dependency Summary

```
Phase 0 (Convex)
  └── Phase 1 (Clerk auth)
        └── Phase 2 (Node selector)
              ├── Phase 3 (Calibration)
              │     ├── Phase 5 (Alerts)
              │     ├── Phase 6 (Charts)
              │     └── Phase 8 (CSV Export)
              └── Phase 4 (Map)
Phase 7 (History) — depends on Phase 2 + 3
Phase 9 (Polish) — can be done in parallel with any phase
```
