# Status Page — Implementation Tasks

This document tracks implementation work for `apps/status-page` (`status.panahon.live`).

---

## Phase 1: Fleet-wide Monitoring
- [ ] **1.1 — Dynamic Node Discovery**
  - Use Convex `listNodes` to fetch all configured nodes in the fleet.
  - Render a grid of status cards (one per node) instead of the hardcoded `node_1`.
- [ ] **1.2 — Real-time Heartbeats**
  - Switch from Firestore polling (`getDocs`) to RTDB `onValue` listeners for `nodes/${node_id}/latest` for all nodes.
  - This provides < 1s latency for status updates.

## Phase 2: Logic & Metrics
- [ ] **2.1 — Uptime & Connectivity**
  - Replace "Ping N/A" with a relative "Last seen: X seconds ago" based on `ts`.
  - Calculate packet health from the `samples` field in `RawSensorData`.
- [ ] **2.2 — System-wide Health**
  - Implement a global header badge that turns "Degraded" if any node is offline or "Critical" if the processor hasn't updated RTDB in > 1 minute.

## Phase 3: Visuals & UX
- [ ] **3.1 — Emerald/Slate Theme**
  - Fully implement the dark-mode primary aesthetic (Emerald for operational, Rose for critical).
- [ ] **3.2 — Micro-animations**
  - Add a subtle pulse animation to the node card when a new heartbeat is received.
- [ ] **3.3 — Mobile Optimization**
  - Ensure the fleet grid stacks correctly on small screens for on-the-go monitoring.
