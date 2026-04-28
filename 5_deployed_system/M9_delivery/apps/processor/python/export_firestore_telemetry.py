#!/usr/bin/env python3
"""Export Firestore telemetry documents to a flat CSV.

By default this exports the raw processor source collection, `node_data_0v3`,
and expands each document's `history[]` array into one row per telemetry sample.

That raw collection is the best source for downstream battery analysis because
the processor's normalized collection contains placeholder rows for missing
minutes, which would distort power and recharge calculations.
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError as exc:  # pragma: no cover - dependency guidance only
    raise SystemExit(
        "Missing dependency: firebase-admin. Install with `pip install -r requirements.txt`."
    ) from exc


SCRIPT_DIR = Path(__file__).resolve().parent
PROCESSOR_DIR = SCRIPT_DIR.parent
REPO_ROOT = PROCESSOR_DIR.parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "DATA" / "firestore_telemetry.csv"
DEFAULT_COLLECTIONS = ["node_data_0v3"]
MANILA = timezone(timedelta(hours=8))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--collections",
        nargs="+",
        default=DEFAULT_COLLECTIONS,
        help="Firestore collections to export. Default: node_data_0v3",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output CSV path. Default: {DEFAULT_OUTPUT}",
    )
    return parser.parse_args()


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_service_account() -> dict[str, Any] | None:
    sources = [
        dict(os.environ),
        load_env_file(PROCESSOR_DIR / ".env"),
        load_env_file(REPO_ROOT / ".env.local"),
    ]

    for source in sources:
        base64_value = source.get("FIREBASE_SERVICE_ACCOUNT_JSON_BASE64") or source.get(
            "FIREBASE_SERVICE_ACCOUNT_64"
        )
        if base64_value:
            decoded = base64.b64decode(base64_value).decode("utf-8")
            return json.loads(decoded)

        raw_json = source.get("FIREBASE_SERVICE_ACCOUNT")
        if raw_json:
            return json.loads(raw_json)

    return None


def build_firestore_client() -> Any:
    if not firebase_admin._apps:
        service_account = load_service_account()
        if service_account:
            firebase_admin.initialize_app(credentials.Certificate(service_account))
        else:
            firebase_admin.initialize_app(credentials.ApplicationDefault())
    return firestore.client()


def normalize_timestamp(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=MANILA)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    if isinstance(value, (int, float)):
        epoch = float(value)
        if epoch > 1e12:
            epoch /= 1000.0
        return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")

    text = str(value).strip()
    if not text:
        return ""

    if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?", text):
        dt = datetime.fromisoformat(text.replace(" ", "T")).replace(tzinfo=MANILA)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    isoish = text.replace(" ", "T")
    if isoish.endswith("Z"):
        isoish = isoish[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(isoish)
    except ValueError:
        return text
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=MANILA)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def flatten_sample(
    *,
    source_collection: str,
    doc_id: str,
    doc_data: dict[str, Any],
    sample: dict[str, Any],
    sample_index: int,
    doc_timestamp: str,
) -> dict[str, Any]:
    sample_ts = normalize_timestamp(sample.get("ts") or sample.get("timestamp") or doc_timestamp)
    return {
        "source_collection": source_collection,
        "doc_id": doc_id,
        "doc_timestamp": doc_timestamp,
        "sample_index": sample_index,
        "node_id": sample.get("node_id") or doc_data.get("node_id") or "",
        "sample_ts": sample_ts,
        "uptime_ms": sample.get("uptime_ms") if sample.get("uptime_ms") is not None else "",
        "temp": sample.get("temp") if sample.get("temp") is not None else "",
        "hum": sample.get("hum") if sample.get("hum") is not None else "",
        "rain": sample.get("rain") if sample.get("rain") is not None else "",
        "batt_v": sample.get("batt_v") if sample.get("batt_v") is not None else "",
        "batt_i": sample.get("batt_i") if sample.get("batt_i") is not None else "",
        "solar_v": sample.get("solar_v") if sample.get("solar_v") is not None else "",
        "solar_i": sample.get("solar_i") if sample.get("solar_i") is not None else "",
        "samples": sample.get("samples") if sample.get("samples") is not None else "",
        "processed_at": sample.get("processed_at") or doc_data.get("processed_at") or "",
    }


def flatten_document(source_collection: str, doc: Any) -> list[dict[str, Any]]:
    doc_data = doc.to_dict() or {}
    doc_timestamp = normalize_timestamp(
        doc_data.get("timestamp") or doc_data.get("ts") or doc_data.get("created_at")
    )
    history = doc_data.get("history")

    if isinstance(history, list) and history:
        rows: list[dict[str, Any]] = []
        for index, sample in enumerate(history):
            if not isinstance(sample, dict):
                continue
            rows.append(
                flatten_sample(
                    source_collection=source_collection,
                    doc_id=doc.id,
                    doc_data=doc_data,
                    sample=sample,
                    sample_index=index,
                    doc_timestamp=doc_timestamp,
                )
            )
        return rows

    return [
        flatten_sample(
            source_collection=source_collection,
            doc_id=doc.id,
            doc_data=doc_data,
            sample=doc_data,
            sample_index=0,
            doc_timestamp=doc_timestamp,
        )
    ]


def sort_key(row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        row["source_collection"],
        row["node_id"],
        row["sample_ts"],
        row["doc_timestamp"],
        row["doc_id"],
        row["sample_index"],
    )


def main() -> int:
    args = parse_args()
    db = build_firestore_client()

    rows: list[dict[str, Any]] = []
    for collection_name in args.collections:
        print(f"[Export] Reading collection: {collection_name}")
        for doc in db.collection(collection_name).stream():
            rows.extend(flatten_document(collection_name, doc))

    rows.sort(key=sort_key)

    output_path: Path = args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)

    columns = [
        "source_collection",
        "doc_id",
        "doc_timestamp",
        "sample_index",
        "node_id",
        "sample_ts",
        "uptime_ms",
        "temp",
        "hum",
        "rain",
        "batt_v",
        "batt_i",
        "solar_v",
        "solar_i",
        "samples",
        "processed_at",
    ]

    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    print(f"[Export] Saved {len(rows)} rows to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())