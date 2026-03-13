# 0_reference_codes

Reference implementations from hardware development. Contains raw trial files and a consolidated snippet file. **Start with `SNIPPETS.ino` — it's the single source of truth going forward.**

---

## Files

### `SNIPPETS.ino` ← Start here
Consolidated reference for all hardware patterns. Organized into 13 sections:

| Section | What's in it |
|---|---|
| 1 – Includes | All required libraries |
| 2 – Config | WiFi credentials, server URL placeholders |
| 3 – Pin Definitions | RS485 (16/17), Rain UART (25/26), SD CS (5), WiFi MOSFET (13) |
| 4 – Hardware Objects | RTC, Modbus node, RainSensor, SD file handle, INA219 |
| 5 – Data Structures | `Sample` struct for batch uploads |
| 6 – Counters | `failSensor`, `failSD`, `failUpload` diagnostics |
| 7 – TxMode Enum | EXTREME / NORMAL / NIGHT_SAVE / CRITICAL transmission modes |
| 8 – Utility Functions | `heatIndex()`, `rtcNow()`, `checkSerialForRTCUpdate()` |
| 9 – Init Functions | Per-peripheral setup: RTC, Modbus, Rain, SD, WiFi, INA219, MOSFET |
| 10 – Sensor Reads | Modbus T/H, DFRobot rainfall, INA219 coulomb counting + SoC |
| 11 – SD Logging | CSV append to `/datalog.csv` |
| 12 – HTTP Upload | Pattern A (single reading) and Pattern B (batched, 10 samples) |
| 13 – Loop Skeleton | RTC-tick gated loop tying everything together |

---

### `CODE_1.ino`
Full working sketch — batch upload pattern (10 samples per HTTP POST).
- Reads temp/humidity via Modbus RS485
- Reads rainfall via DFRobot UART sensor
- Logs every second to SD card (`/datalog.csv`)
- Batches 10 readings before POSTing to server
- Includes `TxMode` enum for adaptive upload frequency

### `CODE_2.ino`
Full working sketch — simpler, SD-only logging with WiFi MOSFET power control.
- WiFi module switchable via MOSFET on pin 13
- Reads temp/humidity via Modbus RS485
- Logs to SD (`/datetime.txt`, seeks to end before write)
- Serial RTC update with stricter delimiter validation
- No rain sensor, no HTTP upload

### `INA219.ino`
Standalone battery monitor sketch.
- Reads bus voltage and current via INA219 over I2C (pins 21/22)
- Coulomb counting to track used Ah and estimate State of Charge (SoC)
- Hard cutoff at 11.0V (halts execution)
- Calibrated for 16V / 5A range
