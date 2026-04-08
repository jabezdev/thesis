# Database Specification

This document outlines the data schema from the M3 node (firmware v0.3) to the database, its subsequent normalization by the telemetry processor, and instructions for frontend display.

## 1. Data Origin (m3_v0.3.ino)

The deployed environment monitoring nodes upload payloads into the backend at regular intervals. The payload contains raw readings bundled into a `history` array, along with health metrics for the hardware and network.

### Node Data Payload Structure

**Base Document:**
- `node_id` (String): The unique identifier for the node.
- `timestamp` (String): Timestamp of the last sample in the batch.
- `history` (Array): Collection of minute-by-minute environment samples.
- `health` (Object): Node health and diagnostics metrics.

**History Array Elements:**
- `ts` (String): The timestamp for the block.
- `uptime_ms` (Integer): System uptime in milliseconds.
- `temp` (Double): Average temperature reading.
- `hum` (Double): Average humidity reading.
- `rain` (Double): Rainfall accumulation.
- `batt_v` (Double): Average battery voltage.
- `batt_i` (Double): Average battery current.
- `solar_v` (Double): Average solar voltage.
- `solar_i` (Double): Average solar current.
- `samples` (Integer): Number of samples averaged in this block.

**Health Object Elements:**
- `send_success`, `send_fail`, `sd_fail`, `uptime_h`, `wifi_rssi`, `firmware`, `i2c_errs`, `mb_errs`, `dongle_cycles`, `http_2xx`, `http_errs`, `upload_lat_ms`, `sd_lat_ms`, `min_heap`, `wifi_reconn`

---

## 2. Telemetry Processor Normalization

The telemetry processor (`apps/processor`) listens for these batches and normalizes the unflattened array so it's easier to access and retrieve on the application tier.

For every batch:
1. **Firestore (Normalized Historical Data)**:
   - Each entry in the `history` array becomes a singular document inside the `m6_node_data` collection.
   - The doc ID format is `{node_id}_{timestamp}`.
   - The document attributes are fully flattened: `node_id`, `ts`, `uptime_ms`, `temp`, `hum`, `rain`, `batt_v`, `batt_i`, `solar_v`, `solar_i`, `samples`, plus a new timestamp: `processed_at`.
2. **Firebase Realtime Database (RTDB) (Live Telemetry)**:
   - Sets the `nodes/{node_id}/last_hour/{epoch}` data point.
   - Updates `nodes/{node_id}/latest` using the most recent sample in the batch.
   - The processor also polls Convex metadata regularly to map human-readable location data and status onto the RTDB (`nodes/{node_id}/metadata`).

---

## 3. Storage Strategy & Architecture

Based on frontend access patterns, data is split via two distinct paths:

- **Firestore**: Used strictly for retrieving **historical data**.
  - *Consumer*: The Analytics Page on the Dashboard App.
- **Firebase Realtime Database (RTDB)**: Used for streaming **live telemetry**.
  - *Consumer*: The Live Monitor on the Dashboard, the Public App, and the Status App.

---

## 4. Frontend Guidelines

To ensure consistency in UI presentation across all applications:

- **Rounding**: All telemetry values (e.g., temperature, humidity, battery metrics) must be rounded to **1 decimal place**.
- **Timestamps**: It is important to rely exclusively on precise `ts` (timestamps). Do not assume that data arrives exactly every minute, as network failures or hardware sleep cycles can result in data fragmentation/losses. Timestamps anchor the state truthfully.
