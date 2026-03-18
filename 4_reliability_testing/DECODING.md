# SD Card Log Decoding Guide

The reliability firmware writes both CSV and binary logs to the SD card.

## Files On The SD Card

- `datalog.csv`: human-readable periodic telemetry rows
- `datalog.bin`: packed binary telemetry rows
- `pending.csv`: CSV buffer for rows waiting for upload
- `pending.bin`: binary buffer for rows waiting for upload

The firmware creates the CSV headers automatically when the files do not exist.

## CSV Log Format

The CSV header written by the firmware is:

```text
timestamp,temperature,humidity,rainfall_mm,rainfall_1h_mm,rain_raw,batt_voltage,batt_current_A,batt_soc_pct,batt_total_energy_Wh,batt_peak_current_A,v_min,solar_voltage,solar_current_A,int_temp,min_heap,log_count,sd_free,up_lat,rssi,reconnects,fail_streak,max_fail,latency,uptime,wifi_offline,ir
```

Notes:

- `timestamp` is local RTC time in `YYYY-MM-DD HH:MM:SS` format.
- `ir` is battery internal resistance in milliohms.
- `up_lat` is the last upload latency in milliseconds.
- `latency` is the last sensor read latency in milliseconds.

The CSV file is already readable as-is. Load it into pandas, Excel, LibreOffice, or any time-series tool.

Example:

```python
import pandas as pd

df = pd.read_csv("datalog.csv")
df["timestamp"] = pd.to_datetime(df["timestamp"])
```

## Binary Log Format

The binary logs use the packed `WeatherPacketFull` struct from `reliability_test.ino`.

- Encoding is little-endian.
- Each record is written with no padding.
- Trailing partial bytes are ignored by the decoder.

Use the provided decoder:

```bash
python3 esp-code/reliability_test/decode_weather_bin.py datalog.bin --csv datalog_decoded.csv --json datalog_decoded.json
python3 esp-code/reliability_test/decode_weather_bin.py pending.bin --csv pending_decoded.csv
```

The decoder converts the packed integers back into readable units and adds convenience fields such as:

- `ts_iso_utc`
- `temperature_c`
- `humidity_pct`
- `rainfall_mm`
- `batt_voltage_v`
- `batt_current_a`
- `solar_voltage_v`
- `solar_current_a`
- `modbus_error_rate_pct`
- `net_throughput_kbps`

## Field Scaling

The packed binary record uses scaled integers to save space. Important examples:

- temperatures are stored as tenths of a degree
- humidity and voltages are stored as hundredths
- currents are stored as thousandths
- rainfall is stored as hundredths of millimeters
- `uptime_h` is stored as tenths of an hour
- `batt_internal_resistance` is stored as tenths of a milliohm

The Python decoder already applies these scale factors.

## Recommended Workflow

1. Copy the SD card files from the device.
2. Decode `datalog.bin` and `pending.bin` with `decode_weather_bin.py`.
3. Use the CSV logs for quick inspection and the binary logs for exact reconstruction.
4. Compare SD logs with Firestore uploads if you are checking data loss or upload gaps.

## When To Use Which File

- Use `datalog.csv` for fast manual checks.
- Use `datalog.bin` when you need the full packed record and exact field order.
- Use `pending.bin` to inspect rows that failed upload and were queued for retry.