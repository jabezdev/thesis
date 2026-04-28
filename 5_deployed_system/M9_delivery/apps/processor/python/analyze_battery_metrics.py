#!/usr/bin/env python3
"""Analyze exported telemetry and compute battery metrics.

The script uses the CSV produced by export_firestore_telemetry.py and computes:

* battery power consumption during the nightly discharge window
* the time it takes to recharge after the night
* a nightly discharge summary for each node

The calculations are heuristic and intentionally explicit so they can be tuned
later if the current sign convention or full-charge definition is confirmed.
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from statistics import mean, median
from typing import Any
from zoneinfo import ZoneInfo


MANILA = ZoneInfo("Asia/Manila")
NIGHT_START = time(18, 0)
NIGHT_END = time(6, 0)
SOLAR_ACTIVE_W = 0.5
RECHARGE_TARGET_RATIO = 0.95


@dataclass(frozen=True)
class TelemetryRow:
    node_id: str
    sample_ts: datetime
    batt_v: float | None
    batt_i: float | None
    solar_v: float | None
    solar_i: float | None
    source_collection: str
    doc_id: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "DATA" / "firestore_telemetry.csv",
        help="Input telemetry CSV path.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Directory for generated analysis CSVs.",
    )
    return parser.parse_args()


def parse_timestamp(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    isoish = text.replace(" ", "T")
    if isoish.endswith("Z"):
        isoish = isoish[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(isoish)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MANILA)


def parse_float(value: str) -> float | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_rows(path: Path) -> list[TelemetryRow]:
    rows: list[TelemetryRow] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for raw in reader:
            sample_ts = parse_timestamp(raw.get("sample_ts", ""))
            if sample_ts is None:
                continue
            rows.append(
                TelemetryRow(
                    node_id=(raw.get("node_id") or "").strip(),
                    sample_ts=sample_ts,
                    batt_v=parse_float(raw.get("batt_v", "")),
                    batt_i=parse_float(raw.get("batt_i", "")),
                    solar_v=parse_float(raw.get("solar_v", "")),
                    solar_i=parse_float(raw.get("solar_i", "")),
                    source_collection=(raw.get("source_collection") or "").strip(),
                    doc_id=(raw.get("doc_id") or "").strip(),
                )
            )
    return rows


def row_metrics(row: TelemetryRow) -> dict[str, Any]:
    batt_power_signed = None
    if row.batt_v is not None and row.batt_i is not None:
        batt_power_signed = row.batt_v * row.batt_i

    solar_power = None
    if row.solar_v is not None and row.solar_i is not None:
        solar_power = row.solar_v * row.solar_i

    return {
        "sample_ts": row.sample_ts,
        "batt_power_signed_w": batt_power_signed,
        "batt_power_abs_w": abs(batt_power_signed) if batt_power_signed is not None else None,
        "solar_power_w": solar_power,
        "solar_active": solar_power is not None and solar_power >= SOLAR_ACTIVE_W,
    }


def fmt_dt(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def energy_wh(samples: list[dict[str, Any]]) -> float:
    if len(samples) < 2:
        return 0.0

    total_wh = 0.0
    for left, right in zip(samples, samples[1:]):
        left_power = left["batt_power_abs_w"] or 0.0
        right_power = right["batt_power_abs_w"] or 0.0
        duration_hours = max((right["sample_ts"] - left["sample_ts"]).total_seconds(), 0.0) / 3600.0
        total_wh += ((left_power + right_power) / 2.0) * duration_hours
    return total_wh


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def analyze_node(rows: list[TelemetryRow]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    combined = sorted(((row, row_metrics(row)) for row in rows), key=lambda item: item[0].sample_ts)
    rows_sorted = [item[0] for item in combined]
    metrics_sorted = [item[1] for item in combined]

    if not rows_sorted:
        return [], []

    first_day = rows_sorted[0].sample_ts.date()
    last_day = rows_sorted[-1].sample_ts.date()

    power_rows: list[dict[str, Any]] = []
    summary_rows: list[dict[str, Any]] = []

    for row, metric in zip(rows_sorted, metrics_sorted):
        power_rows.append(
            {
                "node_id": row.node_id,
                "sample_ts": fmt_dt(row.sample_ts),
                "source_collection": row.source_collection,
                "doc_id": row.doc_id,
                "batt_v": row.batt_v if row.batt_v is not None else "",
                "batt_i": row.batt_i if row.batt_i is not None else "",
                "solar_v": row.solar_v if row.solar_v is not None else "",
                "solar_i": row.solar_i if row.solar_i is not None else "",
                "batt_power_signed_w": metric["batt_power_signed_w"] if metric["batt_power_signed_w"] is not None else "",
                "batt_power_abs_w": metric["batt_power_abs_w"] if metric["batt_power_abs_w"] is not None else "",
                "solar_power_w": metric["solar_power_w"] if metric["solar_power_w"] is not None else "",
                "solar_active": metric["solar_active"],
            }
        )

    day_cursor = first_day
    while day_cursor <= last_day:
        night_start = datetime.combine(day_cursor, NIGHT_END, tzinfo=MANILA) - timedelta(days=1)
        night_end = datetime.combine(day_cursor, NIGHT_END, tzinfo=MANILA)
        pre_night_start = night_start - timedelta(hours=2)

        night_pairs = [
            (row, metric)
            for row, metric in zip(rows_sorted, metrics_sorted)
            if row.node_id == rows_sorted[0].node_id and night_start <= row.sample_ts < night_end
        ]
        if not night_pairs:
            day_cursor += timedelta(days=1)
            continue

        night_samples = [
            {
                "sample_ts": row.sample_ts,
                "batt_v": row.batt_v,
                "batt_power_abs_w": metric["batt_power_abs_w"],
                "solar_active": metric["solar_active"],
            }
            for row, metric in night_pairs
        ]
        night_batt_v = [sample["batt_v"] for sample in night_samples if sample["batt_v"] is not None]
        if not night_batt_v:
            day_cursor += timedelta(days=1)
            continue

        pre_night_candidates = [
            row.batt_v
            for row in rows_sorted
            if row.node_id == rows_sorted[0].node_id and pre_night_start <= row.sample_ts < night_start and row.batt_v is not None
        ]
        pre_night_voltage = pre_night_candidates[-1] if pre_night_candidates else night_batt_v[0]

        night_start_voltage = night_batt_v[0]
        night_end_voltage = night_batt_v[-1]
        min_voltage = min(night_batt_v)
        avg_power = mean(sample["batt_power_abs_w"] or 0.0 for sample in night_samples)
        peak_power = max(sample["batt_power_abs_w"] or 0.0 for sample in night_samples)
        discharge_wh = energy_wh(night_samples)
        discharge_minutes = max((night_samples[-1]["sample_ts"] - night_samples[0]["sample_ts"]).total_seconds(), 0.0) / 60.0

        target_voltage = pre_night_voltage * RECHARGE_TARGET_RATIO
        morning_pairs = [
            (row, metric)
            for row, metric in zip(rows_sorted, metrics_sorted)
            if row.node_id == rows_sorted[0].node_id and night_end <= row.sample_ts < (night_end + timedelta(hours=12))
        ]
        recharge_start = next((row.sample_ts for row, metric in morning_pairs if metric["solar_active"]), None)
        recharge_complete = None
        if recharge_start is not None:
            for row, metric in morning_pairs:
                if row.sample_ts < recharge_start:
                    continue
                if row.batt_v is not None and row.batt_v >= target_voltage:
                    recharge_complete = row.sample_ts
                    break

        recharge_minutes = ""
        if recharge_start is not None and recharge_complete is not None:
            recharge_minutes = (recharge_complete - recharge_start).total_seconds() / 60.0

        summary_rows.append(
            {
                "node_id": rows_sorted[0].node_id,
                "analysis_day": day_cursor.isoformat(),
                "night_start": fmt_dt(night_start),
                "night_end": fmt_dt(night_end),
                "pre_night_batt_v": pre_night_voltage,
                "night_start_batt_v": night_start_voltage,
                "night_end_batt_v": night_end_voltage,
                "night_min_batt_v": min_voltage,
                "night_voltage_drop_v": pre_night_voltage - min_voltage,
                "night_duration_min": discharge_minutes,
                "battery_power_avg_w": avg_power,
                "battery_power_peak_w": peak_power,
                "battery_energy_wh": discharge_wh,
                "recharge_target_v": target_voltage,
                "recharge_start": fmt_dt(recharge_start),
                "recharge_complete": fmt_dt(recharge_complete),
                "recharge_minutes": recharge_minutes,
                "recharge_completed": recharge_complete is not None,
                "discharge_result": "complete" if recharge_complete is not None else "incomplete",
            }
        )

        day_cursor += timedelta(days=1)

    return power_rows, summary_rows


def main() -> int:
    args = parse_args()
    raw_rows = load_rows(args.input)
    rows_by_node: dict[str, list[TelemetryRow]] = defaultdict(list)
    for row in raw_rows:
        if row.node_id:
            rows_by_node[row.node_id].append(row)

    all_power_rows: list[dict[str, Any]] = []
    all_summary_rows: list[dict[str, Any]] = []

    for node_id, rows in rows_by_node.items():
        power_rows, summary_rows = analyze_node(rows)
        all_power_rows.extend(power_rows)
        all_summary_rows.extend(summary_rows)
        print(f"[Analyze] {node_id}: {len(summary_rows)} nightly windows, {len(power_rows)} telemetry rows")

    power_output = args.output_dir / "battery_power_timeseries.csv"
    summary_output = args.output_dir / "battery_night_summary.csv"

    write_csv(
        power_output,
        [
            "node_id",
            "sample_ts",
            "source_collection",
            "doc_id",
            "batt_v",
            "batt_i",
            "solar_v",
            "solar_i",
            "batt_power_signed_w",
            "batt_power_abs_w",
            "solar_power_w",
            "solar_active",
        ],
        all_power_rows,
    )
    write_csv(
        summary_output,
        [
            "node_id",
            "analysis_day",
            "night_start",
            "night_end",
            "pre_night_batt_v",
            "night_start_batt_v",
            "night_end_batt_v",
            "night_min_batt_v",
            "night_voltage_drop_v",
            "night_duration_min",
            "battery_power_avg_w",
            "battery_power_peak_w",
            "battery_energy_wh",
            "recharge_target_v",
            "recharge_start",
            "recharge_complete",
            "recharge_minutes",
            "recharge_completed",
            "discharge_result",
        ],
        all_summary_rows,
    )

    print(f"[Analyze] Saved power timeseries to {power_output}")
    print(f"[Analyze] Saved nightly summary to {summary_output}")

    if all_summary_rows:
        recharge_times = [row["recharge_minutes"] for row in all_summary_rows if isinstance(row["recharge_minutes"], (int, float))]
        discharge_energies = [row["battery_energy_wh"] for row in all_summary_rows if isinstance(row["battery_energy_wh"], (int, float))]
        if recharge_times:
            print(f"[Analyze] Median recharge time: {median(recharge_times):.2f} min")
        if discharge_energies:
            print(f"[Analyze] Mean discharge energy: {mean(discharge_energies):.2f} Wh")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())