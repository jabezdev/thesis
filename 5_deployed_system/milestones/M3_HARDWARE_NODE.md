# M3: Hardware Node Firmware

**Depends on**: M2 (Ingestion API — a live endpoint to transmit to)
**Required by**: M8 (OTA & Fleet Management)

---

## What This Milestone Delivers

ESP32 firmware that senses temperature, humidity, and rainfall at 1 Hz; writes raw data to an SD card; builds block-averaged binary packets; and transmits them to the Ingestion API over WiFi-first / LTE-fallback connectivity. Includes adaptive operational modes, NTP synchronization, and graceful shutdown.

---

## Requirements

### Sensors
- **Temperature + Humidity**: DHT22 or equivalent. Polled at 1 Hz.
- **Rainfall**: Tipping bucket rain gauge on a GPIO interrupt (one interrupt per 0.2 mm tip).
- All readings accumulated in a ring buffer for block averaging.

### SD Card Logging
Every block average written to a CSV file on the SD card.

**Row format**:
```
rtc_timestamp,uptime_ms,temperature_c,humidity_pct,rainfall_mm,rainfall_min,rainfall_max,crc8
```
- `rtc_timestamp`: UNIX timestamp from RTC (may be wrong post-cold-boot).
- `uptime_ms`: monotonic `millis()` counter — always correct.
- `crc8`: CRC-8 checksum over all preceding fields in the row.

**Rollover protection**: `uptime_ms` is stored as `uint64_t` internally. The firmware detects the 49.7-day `millis()` rollover (32-bit → 0) and increments a high-word counter, producing a monotonically increasing 64-bit value.

**File strategy**: One CSV file per boot, named by boot timestamp or boot count. Periodic `fsync()` every N writes (configurable, default: every 10 writes). On Critical Shutdown, force `fsync()` before deep sleep.

### Binary Packet Format (V1)

All integers are **Little-Endian**, matching ESP32's native byte order.

#### Weather Payload (V1)
| Field | Type | Scale | Notes |
|-------|------|-------|-------|
| `version` | `uint8_t` | — | `0x01` |
| `packet_type` | `uint8_t` | — | `0x01` = Weather |
| `node_id_hash` | `uint16_t` | — | Lower 2 bytes of node_id for compact identification |
| `rtc_timestamp` | `uint32_t` | seconds | UNIX timestamp |
| `uptime_ms` | `uint32_t` | ms | Low 32 bits of monotonic counter |
| `temperature` | `int16_t` | ×10 | 29.4°C → 294 |
| `humidity` | `uint16_t` | ×10 | 65.5% → 655 |
| `rainfall_acc` | `uint16_t` | ×100 | mm × 100 |
| `rainfall_min` | `uint16_t` | ×100 | — |
| `rainfall_max` | `uint16_t` | ×100 | — |
| `crc8` | `uint8_t` | — | CRC-8 over all preceding bytes |

#### System Health Payload (V1)
| Field | Type | Scale | Notes |
|-------|------|-------|-------|
| `version` | `uint8_t` | — | `0x01` |
| `packet_type` | `uint8_t` | — | `0x02` = Health |
| `node_id_hash` | `uint16_t` | — | — |
| `rtc_timestamp` | `uint32_t` | seconds | — |
| `uptime_ms` | `uint32_t` | ms | — |
| `battery_mv` | `uint16_t` | mV | e.g., 3700 |
| `solar_charging` | `uint8_t` | — | 0/1 |
| `rssi_dbm` | `int8_t` | dBm | — |
| `free_heap` | `uint16_t` | KB | bytes / 1024 |
| `sd_free_kb` | `uint32_t` | KB | — |
| `op_mode` | `uint8_t` | — | 1=HighAlert, 2=Nominal, 3=PowerSaving, 0=Shutdown |
| `crc8` | `uint8_t` | — | — |

### Adaptive Operational Modes

#### Mode 1: High Alert
- Trigger: rainfall interrupt (GPIO from tipping bucket)
- Weather sampling: 1 Hz, block-averaged over 10 seconds
- Weather TX: every 1 minute
- Health TX: every 5 minutes
- **Exit hysteresis**: Exit to Nominal only after fewer than 2 rainfall tips in the last 5 minutes. Both N and M are `#define` constants.

#### Mode 2: Nominal (default on boot)
- Weather sampling: 1 Hz, block-averaged over 60 seconds
- Weather TX: every 5 minutes
- Health TX: every 5 minutes (bundled with weather)

#### Mode 3: Power Saving
- Trigger: battery voltage below `POWER_SAVE_MV` threshold
- Weather sampling: 1 read per 10 seconds, block-averaged over 60 seconds
- Weather TX: every 30 minutes
- Health TX: every 30 minutes (bundled with weather)

#### Critical Shutdown
- Trigger: battery voltage below `CRITICAL_MV` threshold
- Sequence: `fsync()` SD card → transmit Health packet with `op_mode = 0` → `esp_deep_sleep_start()`

### Connectivity

**WiFi-first**:
1. On boot, attempt WiFi connection using stored SSID/password (from flash, set at provisioning).
2. If WiFi connects: use WiFi for all transmissions; LTE modem stays in deep sleep.
3. If WiFi unavailable or drops: activate LTE modem (SIM800L or similar), initiate APN connection.
4. Transmission intervals are the same regardless of which link is active.

**Transmission sequence** (per interval):
1. Wake modem (if LTE) or use active WiFi.
2. Perform NTP sync if the sync interval has elapsed (piggyback on this wake — no dedicated NTP wake).
3. Build packet, compute CRC-8.
4. `POST https://<ingestion_api>/api/v1/ingest` with `X-Node-Key` header.
5. Read response status and check `X-Cmd` header.
6. If `X-Cmd: ntp_sync` → force NTP update on this connection.
7. If `X-Cmd: ota=<url>` → enter OTA download sequence (see M8).
8. Put modem back to sleep (if LTE) or continue polling (if WiFi with long interval).

**On 400 response**: Retry once after 30 seconds. If second attempt is also `400`, log fault to SD card and discard packet.

**On 5xx response**: Treat as transient. Retry on next scheduled TX window with exponential backoff (configurable max retries).

### Authentication
- API key stored in ESP32 flash at provisioning time (not on SD card).
- Set via serial command or over-the-air before field deployment: `AT+SETKEY=<api_key>`.
- The key is sent in `X-Node-Key` on every request.

### NTP Synchronization
- Sync against `pool.ntp.org` on boot and every 6 hours.
- NTP calls are piggybacked on the next scheduled TX window after the interval expires — no dedicated LTE wake for NTP alone.
- On NTP failure: retain last-known RTC value, log failed sync to SD card row's fault flag.

### Provisioning
At first flash, the following are written to ESP32 flash:
- WiFi SSID + password
- Bearer API key (retrieved from Admin Dashboard after running `POST /api/v1/admin/nodes`)
- Ingestion API endpoint URL

---

## Interactions

| Interacts With | Direction | How |
|----------------|-----------|-----|
| M2 Ingestion API | sends → | `POST /api/v1/ingest` with binary packet and `X-Node-Key` |
| M2 Ingestion API | ← receives from | `X-Cmd` header in ingest response (OTA, NTP) |
| M8 OTA | ← receives from | Downloads firmware `.bin` from URL in `X-Cmd: ota=<url>` |
| SD Card (M7) | writes → | CSV rows with dual timestamps and CRC-8 |

---

## Testing Checklist

### Sensor Readings
- [ ] DHT22 returns plausible temperature (18–35°C) and humidity (30–95%) in a normal environment
- [ ] Tipping bucket interrupt fires on each manual tip and increments the rainfall counter
- [ ] Block average over 10 readings produces a value within ±0.5 of manual calculation

### Binary Packet
- [ ] Built Weather V1 packet has exactly the expected byte count
- [ ] CRC-8 of the packet (excluding the CRC byte) matches the embedded CRC byte
- [ ] Little-Endian parsing: temperature field 294 decoded as 29.4°C
- [ ] Health V1 packet has expected byte count and correct CRC

### SD Card Logging
- [ ] After 10-second block average, one CSV row is written to the SD card
- [ ] Each row contains both `rtc_timestamp` and `uptime_ms`
- [ ] CRC-8 in the CSV row is valid (verified by Extraction Tool logic)
- [ ] After 49 days of simulated `millis()` rollover (inject uint32 overflow): `uptime_ms` in subsequent rows continues to increase monotonically (does not reset to 0 in the 64-bit counter)
- [ ] Critical shutdown: after simulated low battery, file is fsynced and no incomplete rows exist

### Adaptive Modes
- [ ] On boot: node starts in Nominal mode
- [ ] Simulate rainfall interrupt: node transitions to High Alert within 1 TX interval
- [ ] In High Alert: weather TX interval is 1 minute (verify by counting POST calls in test server)
- [ ] After quiet period (< 2 tips in 5 minutes): node reverts to Nominal
- [ ] Simulate battery below `POWER_SAVE_MV`: node transitions to Power Saving, TX interval becomes 30 minutes
- [ ] Simulate battery below `CRITICAL_MV`: node executes shutdown sequence (fsync → SHUTDOWN packet → sleep)

### Connectivity
- [ ] With WiFi credentials set: node connects via WiFi; LTE modem remains off
- [ ] With WiFi SSID wrong/absent: node falls back to LTE and transmits successfully
- [ ] After LTE transmission: modem is put back to sleep (current draw drops)

### NTP
- [ ] On boot: RTC is set from NTP within first TX window
- [ ] After 6 hours: NTP re-sync is piggybacked on the next TX window (no extra modem wake)
- [ ] With NTP unreachable: node retains last RTC value and logs failure to SD card; transmission continues

### 400 Retry
- [ ] Test server configured to return `400`: node retries once after 30 seconds, then logs fault and discards
- [ ] After two `400` responses: node does NOT retry a third time

### X-Cmd Handling
- [ ] Test server returns `X-Cmd: ntp_sync`: node forces NTP update on same connection
- [ ] Test server returns no `X-Cmd`: node continues normal operation
