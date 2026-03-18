#!/usr/bin/env python3
"""Decode packed WeatherPacketFull binary records produced by reliability_test.ino.

Usage:
  python decode_weather_bin.py
  python decode_weather_bin.py path/to/pending.bin
  python decode_weather_bin.py --csv decoded.csv --json decoded.json
"""

from __future__ import annotations

import argparse
import csv
import json
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Field order mirrors WeatherPacketFull in reliability_test.ino exactly.
FIELD_DEFS: list[tuple[str, str]] = [
    ("ts", "I"),
    ("temp_s10", "h"),
    ("hum_s10", "H"),
    ("rain_s100", "H"),
    ("rain_1h_s100", "H"),
    ("rain_raw", "I"),
    ("v_batt_s100", "H"),
    ("i_batt_s1000", "h"),
    ("p_batt_s100", "H"),
    ("soc_pct", "B"),
    ("rem_ah_s1000", "H"),
    ("e_wh_s10", "H"),
    ("i_peak_s1000", "h"),
    ("v_min_s100", "H"),
    ("v_sol_s100", "H"),
    ("i_sol_s1000", "H"),
    ("p_sol_s100", "H"),
    ("e_sol_wh_s10", "H"),
    ("i_sol_peak_s1000", "H"),
    ("int_temp", "B"),
    ("min_heap", "I"),
    ("log_count", "I"),
    ("sd_free_mb", "I"),
    ("up_lat_ms", "H"),
    ("rssi", "b"),
    ("flags", "B"),
    ("reconn_count", "H"),
    ("fail_streak", "H"),
    ("max_fail", "H"),
    ("uptime_s", "I"),
    ("uptime_h_s10", "H"),
    ("free_heap", "I"),
    ("heap_frag", "B"),
    ("sensor_stat", "B"),
    ("reset_rc", "B"),
    ("boot_count", "I"),
    ("send_success", "I"),
    ("send_fail", "I"),
    ("sd_fail", "H"),
    ("total_read", "I"),
    ("mod_err_s100", "H"),
    ("consec_mb_fail", "H"),
    ("max_mb_fail", "H"),
    ("mb_latency", "H"),
    ("wifi_off_total", "I"),
    ("long_off_streak", "I"),
    ("dongle_pc", "H"),
    ("pending_rows", "H"),
    ("avg_ul_lat", "H"),
    ("sd_w_lat", "H"),
    ("s_stack_hwm", "H"),
    ("u_stack_hwm", "H"),
    ("sd_used_mb", "I"),
    ("loop_jitter", "H"),
    ("brownouts", "H"),
    ("i2c_errs", "H"),
    ("sd_max_lat", "H"),
    ("batt_ir_s10", "H"),
    ("mt_count", "H"),
    ("mc_count", "H"),
    ("h2xx", "H"),
    ("h4xx", "H"),
    ("h5xx", "H"),
    ("last_http", "h"),
    ("hte_count", "H"),
    ("sd_flags", "B"),
    ("sd_remount_try", "H"),
    ("sd_remount_ok", "H"),
    ("net_kbps_s10", "H"),
    ("ntp_drift", "i"),
    ("ntp_backoff_s", "H"),
    ("up_interval", "H"),
]

RECORD_STRUCT = struct.Struct("<" + "".join(fmt for _, fmt in FIELD_DEFS))
RECORD_SIZE = RECORD_STRUCT.size


def _scale(v: int | float, factor: float) -> float:
    return float(v) / factor


def decode_record(raw_bytes: bytes) -> dict[str, Any]:
    raw_values = RECORD_STRUCT.unpack(raw_bytes)
    record = {name: value for (name, _), value in zip(FIELD_DEFS, raw_values)}

    flags = record["flags"]
    sd_flags = record["sd_flags"]

    # Human-readable values from scaled integer fields.
    record.update(
        {
            "ts_iso_utc": datetime.fromtimestamp(record["ts"], tz=timezone.utc).isoformat(),
            "temperature_c": _scale(record["temp_s10"], 10.0),
            "humidity_pct": _scale(record["hum_s10"], 10.0),
            "rainfall_mm": _scale(record["rain_s100"], 100.0),
            "rainfall_1h_mm": _scale(record["rain_1h_s100"], 100.0),
            "batt_voltage_v": _scale(record["v_batt_s100"], 100.0),
            "batt_current_a": _scale(record["i_batt_s1000"], 1000.0),
            "batt_power_w": _scale(record["p_batt_s100"], 100.0),
            "batt_remaining_ah": _scale(record["rem_ah_s1000"], 1000.0),
            "batt_energy_wh": _scale(record["e_wh_s10"], 10.0),
            "batt_peak_current_a": _scale(record["i_peak_s1000"], 1000.0),
            "batt_min_voltage_v": _scale(record["v_min_s100"], 100.0),
            "solar_voltage_v": _scale(record["v_sol_s100"], 100.0),
            "solar_current_a": _scale(record["i_sol_s1000"], 1000.0),
            "solar_power_w": _scale(record["p_sol_s100"], 100.0),
            "solar_energy_wh": _scale(record["e_sol_wh_s10"], 10.0),
            "solar_peak_current_a": _scale(record["i_sol_peak_s1000"], 1000.0),
            "modbus_error_rate_pct": _scale(record["mod_err_s100"], 100.0),
            "uptime_h": _scale(record["uptime_h_s10"], 10.0),
            "batt_internal_resistance_mohm": _scale(record["batt_ir_s10"], 10.0),
            "net_throughput_kbps": _scale(record["net_kbps_s10"], 10.0),
            "wifi_connected": bool(flags & 0x01),
            "has_crash_log": bool(flags & 0x02),
            "sensor_ok": bool(record["sensor_stat"]),
            "sd_available": bool(sd_flags & 0x01),
            "sd_fault": bool(sd_flags & 0x02),
        }
    )

    return record


def discover_bin_files(root: Path, limit: int = 200) -> list[Path]:
    found: list[Path] = []
    for p in root.rglob("*.bin"):
        if p.is_file():
            found.append(p)
            if len(found) >= limit:
                break
    return sorted(found)


def choose_file_interactively() -> Path:
    print("No input file provided.")
    print("Scanning current directory for .bin files...\n")

    candidates = discover_bin_files(Path.cwd())
    if candidates:
        for i, p in enumerate(candidates, start=1):
            print(f"[{i}] {p}")
        print("[M] Enter a path manually")

        while True:
            choice = input("\nSelect file number or M: ").strip()
            if not choice:
                continue
            if choice.lower() == "m":
                break
            if choice.isdigit():
                idx = int(choice)
                if 1 <= idx <= len(candidates):
                    return candidates[idx - 1]
            print("Invalid selection. Try again.")

    while True:
        path_text = input("Enter path to .bin file: ").strip().strip('"')
        if not path_text:
            continue
        p = Path(path_text)
        if p.exists() and p.is_file():
            return p
        print("File not found. Try again.")


def decode_file(path: Path) -> tuple[list[dict[str, Any]], int]:
    data = path.read_bytes()
    total = len(data)

    if total == 0:
        return [], 0

    records: list[dict[str, Any]] = []
    full_bytes = (total // RECORD_SIZE) * RECORD_SIZE
    for off in range(0, full_bytes, RECORD_SIZE):
        chunk = data[off : off + RECORD_SIZE]
        records.append(decode_record(chunk))

    trailing = total - full_bytes
    return records, trailing


def write_json(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return

    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Decode WeatherPacketFull binary records from reliability_test.ino"
    )
    parser.add_argument(
        "input_file",
        nargs="?",
        help="Path to binary file. If omitted, you will pick a file interactively.",
    )
    parser.add_argument("--json", dest="json_out", help="Write decoded output to JSON file")
    parser.add_argument("--csv", dest="csv_out", help="Write decoded output to CSV file")
    parser.add_argument(
        "--head",
        type=int,
        default=5,
        help="Number of decoded rows to print in terminal (default: 5)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input_file) if args.input_file else choose_file_interactively()

    if not input_path.exists() or not input_path.is_file():
        print(f"Input file not found: {input_path}")
        return 1

    print(f"\nUsing file: {input_path}")
    print(f"Expected record size: {RECORD_SIZE} bytes")

    rows, trailing = decode_file(input_path)
    print(f"Decoded records: {len(rows)}")
    if trailing:
        print(f"Warning: ignored trailing bytes: {trailing}")

    preview_count = max(0, args.head)
    if preview_count and rows:
        print("\nPreview:")
        for i, row in enumerate(rows[:preview_count], start=1):
            print(
                f"[{i}] ts={row['ts_iso_utc']} "
                f"temp={row['temperature_c']}C hum={row['humidity_pct']}% "
                f"batt={row['batt_voltage_v']}V/{row['batt_current_a']}A "
                f"rain={row['rainfall_mm']}mm"
            )

    if args.json_out:
        out = Path(args.json_out)
        write_json(out, rows)
        print(f"Wrote JSON: {out}")

    if args.csv_out:
        out = Path(args.csv_out)
        write_csv(out, rows)
        print(f"Wrote CSV: {out}")

    if not args.json_out and not args.csv_out:
        print("\nTip: add --json decoded.json or --csv decoded.csv to save all rows.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
