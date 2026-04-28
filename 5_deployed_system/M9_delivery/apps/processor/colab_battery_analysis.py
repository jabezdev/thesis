"""Google Colab battery analysis for exported raw telemetry CSV.

Expected input: the CSV produced by export_raw_telemetry_to_csv.mjs.

It computes:
1. Battery power consumption during the nightly discharge window
2. Time to recharge after the night
3. Nightly discharge summary results
"""

from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from statistics import mean, median
from zoneinfo import ZoneInfo


MANILA = ZoneInfo('Asia/Manila')
NIGHT_END = time(6, 0)
SOLAR_ACTIVE_W = 0.5
RECHARGE_TARGET_RATIO = 0.95


@dataclass(frozen=True)
class Row:
    node_id: str
    sample_ts: datetime
    batt_v: float | None
    batt_i: float | None
    solar_v: float | None
    solar_i: float | None
    source_collection: str
    doc_id: str


def parse_timestamp(value: str) -> datetime | None:
    text = (value or '').strip()
    if not text:
        return None
    text = text.replace(' ', 'T')
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MANILA)


def parse_float(value: str) -> float | None:
    text = (value or '').strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_rows(csv_path: str) -> list[Row]:
    rows: list[Row] = []
    with open(csv_path, newline='', encoding='utf-8') as handle:
        reader = csv.DictReader(handle)
        for raw in reader:
            sample_ts = parse_timestamp(raw.get('sample_ts', ''))
            if sample_ts is None:
                continue
            rows.append(
                Row(
                    node_id=(raw.get('node_id') or '').strip(),
                    sample_ts=sample_ts,
                    batt_v=parse_float(raw.get('batt_v', '')),
                    batt_i=parse_float(raw.get('batt_i', '')),
                    solar_v=parse_float(raw.get('solar_v', '')),
                    solar_i=parse_float(raw.get('solar_i', '')),
                    source_collection=(raw.get('source_collection') or '').strip(),
                    doc_id=(raw.get('doc_id') or '').strip(),
                )
            )
    return rows


def row_metrics(row: Row) -> dict:
    batt_power = None if row.batt_v is None or row.batt_i is None else row.batt_v * row.batt_i
    solar_power = None if row.solar_v is None or row.solar_i is None else row.solar_v * row.solar_i
    return {
        'sample_ts': row.sample_ts,
        'batt_power_signed_w': batt_power,
        'batt_power_abs_w': abs(batt_power) if batt_power is not None else None,
        'solar_power_w': solar_power,
        'solar_active': solar_power is not None and solar_power >= SOLAR_ACTIVE_W,
    }


def fmt_dt(value: datetime | None) -> str:
    if value is None:
        return ''
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def energy_wh(samples: list[dict]) -> float:
    if len(samples) < 2:
        return 0.0
    total = 0.0
    for left, right in zip(samples, samples[1:]):
        left_power = left['batt_power_abs_w'] or 0.0
        right_power = right['batt_power_abs_w'] or 0.0
        dt_hours = max((right['sample_ts'] - left['sample_ts']).total_seconds(), 0.0) / 3600.0
        total += ((left_power + right_power) / 2.0) * dt_hours
    return total


def write_csv(path: str, fieldnames: list[str], rows: list[dict]) -> None:
    with open(path, 'w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def analyze_node(rows: list[Row]) -> tuple[list[dict], list[dict]]:
    combined = sorted(((row, row_metrics(row)) for row in rows), key=lambda item: item[0].sample_ts)
    rows_sorted = [item[0] for item in combined]
    metrics_sorted = [item[1] for item in combined]

    power_rows: list[dict] = []
    summary_rows: list[dict] = []
    if not rows_sorted:
        return power_rows, summary_rows

    for row, metric in zip(rows_sorted, metrics_sorted):
        power_rows.append({
            'node_id': row.node_id,
            'sample_ts': fmt_dt(row.sample_ts),
            'source_collection': row.source_collection,
            'doc_id': row.doc_id,
            'batt_v': row.batt_v if row.batt_v is not None else '',
            'batt_i': row.batt_i if row.batt_i is not None else '',
            'solar_v': row.solar_v if row.solar_v is not None else '',
            'solar_i': row.solar_i if row.solar_i is not None else '',
            'batt_power_signed_w': metric['batt_power_signed_w'] if metric['batt_power_signed_w'] is not None else '',
            'batt_power_abs_w': metric['batt_power_abs_w'] if metric['batt_power_abs_w'] is not None else '',
            'solar_power_w': metric['solar_power_w'] if metric['solar_power_w'] is not None else '',
            'solar_active': metric['solar_active'],
        })

    first_day = rows_sorted[0].sample_ts.date()
    last_day = rows_sorted[-1].sample_ts.date()
    day_cursor = first_day

    while day_cursor <= last_day:
        night_end = datetime.combine(day_cursor, NIGHT_END, tzinfo=MANILA)
        night_start = night_end - timedelta(days=1)
        pre_night_start = night_start - timedelta(hours=2)

        night_pairs = [
            (row, metric)
            for row, metric in zip(rows_sorted, metrics_sorted)
            if row.node_id == rows_sorted[0].node_id and night_start <= row.sample_ts < night_end
        ]
        if not night_pairs:
            day_cursor += timedelta(days=1)
            continue

        night_samples = [{
            'sample_ts': row.sample_ts,
            'batt_v': row.batt_v,
            'batt_power_abs_w': metric['batt_power_abs_w'],
            'solar_active': metric['solar_active'],
        } for row, metric in night_pairs]

        night_batt_v = [sample['batt_v'] for sample in night_samples if sample['batt_v'] is not None]
        if not night_batt_v:
            day_cursor += timedelta(days=1)
            continue

        pre_night_candidates = [
            row.batt_v
            for row in rows_sorted
            if row.node_id == rows_sorted[0].node_id and pre_night_start <= row.sample_ts < night_start and row.batt_v is not None
        ]
        pre_night_voltage = pre_night_candidates[-1] if pre_night_candidates else night_batt_v[0]
        target_voltage = pre_night_voltage * RECHARGE_TARGET_RATIO

        morning_pairs = [
            (row, metric)
            for row, metric in zip(rows_sorted, metrics_sorted)
            if row.node_id == rows_sorted[0].node_id and night_end <= row.sample_ts < (night_end + timedelta(hours=12))
        ]
        recharge_start = next((row.sample_ts for row, metric in morning_pairs if metric['solar_active']), None)
        recharge_complete = None
        if recharge_start is not None:
            for row, _metric in morning_pairs:
                if row.sample_ts < recharge_start:
                    continue
                if row.batt_v is not None and row.batt_v >= target_voltage:
                    recharge_complete = row.sample_ts
                    break

        summary_rows.append({
            'node_id': rows_sorted[0].node_id,
            'analysis_day': day_cursor.isoformat(),
            'night_start': fmt_dt(night_start),
            'night_end': fmt_dt(night_end),
            'pre_night_batt_v': pre_night_voltage,
            'night_start_batt_v': night_batt_v[0],
            'night_end_batt_v': night_batt_v[-1],
            'night_min_batt_v': min(night_batt_v),
            'night_voltage_drop_v': pre_night_voltage - min(night_batt_v),
            'battery_power_avg_w': mean(sample['batt_power_abs_w'] or 0.0 for sample in night_samples),
            'battery_power_peak_w': max(sample['batt_power_abs_w'] or 0.0 for sample in night_samples),
            'battery_energy_wh': energy_wh(night_samples),
            'recharge_target_v': target_voltage,
            'recharge_start': fmt_dt(recharge_start),
            'recharge_complete': fmt_dt(recharge_complete),
            'recharge_minutes': '' if recharge_start is None or recharge_complete is None else (recharge_complete - recharge_start).total_seconds() / 60.0,
            'recharge_completed': recharge_complete is not None,
            'discharge_result': 'complete' if recharge_complete is not None else 'incomplete',
        })

        day_cursor += timedelta(days=1)

    return power_rows, summary_rows


def main(csv_path: str = '/content/raw_telemetry_export.csv'):
    rows = load_rows(csv_path)
    rows_by_node = defaultdict(list)
    for row in rows:
        if row.node_id:
            rows_by_node[row.node_id].append(row)

    all_power_rows: list[dict] = []
    all_summary_rows: list[dict] = []
    for node_id, node_rows in rows_by_node.items():
        power_rows, summary_rows = analyze_node(node_rows)
        all_power_rows.extend(power_rows)
        all_summary_rows.extend(summary_rows)
        print(f'{node_id}: {len(summary_rows)} nightly windows, {len(power_rows)} telemetry rows')

    write_csv('/content/battery_power_timeseries.csv', [
        'node_id', 'sample_ts', 'source_collection', 'doc_id', 'batt_v', 'batt_i',
        'solar_v', 'solar_i', 'batt_power_signed_w', 'batt_power_abs_w', 'solar_power_w', 'solar_active'
    ], all_power_rows)
    write_csv('/content/battery_night_summary.csv', [
        'node_id', 'analysis_day', 'night_start', 'night_end', 'pre_night_batt_v',
        'night_start_batt_v', 'night_end_batt_v', 'night_min_batt_v', 'night_voltage_drop_v',
        'battery_power_avg_w', 'battery_power_peak_w', 'battery_energy_wh', 'recharge_target_v',
        'recharge_start', 'recharge_complete', 'recharge_minutes', 'recharge_completed', 'discharge_result'
    ], all_summary_rows)

    print('Saved /content/battery_power_timeseries.csv')
    print('Saved /content/battery_night_summary.csv')
    if all_summary_rows:
        times = [row['recharge_minutes'] for row in all_summary_rows if isinstance(row['recharge_minutes'], (int, float))]
        energies = [row['battery_energy_wh'] for row in all_summary_rows if isinstance(row['battery_energy_wh'], (int, float))]
        if times:
            print('Median recharge time (min):', round(median(times), 2))
        if energies:
            print('Mean discharge energy (Wh):', round(mean(energies), 2))


if __name__ == '__main__':
    main()