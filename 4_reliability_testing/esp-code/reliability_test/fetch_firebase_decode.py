#!/usr/bin/env python3
"""Fetch and decode Firestore telemetry using the same credentials as reliability_test.ino.

This script reads from Firestore REST API and decodes compact field keys used by ESP:
- ts, t, h, bv, bi, soc, ir

Usage:
  python fetch_firebase_decode.py
  python fetch_firebase_decode.py --collection readings --limit 200 --out firebase_readings.txt
  python fetch_firebase_decode.py --collection heartbeats --out heartbeats.txt
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

# Same credentials/config found in reliability_test.ino
FIREBASE_PROJECT_ID = "panahon-live"
FIREBASE_API_KEY = "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg"
FIRESTORE_BASE = (
    "https://firestore.googleapis.com/v1/projects/"
    "panahon-live/databases/(default)/documents"
)


def parse_firestore_typed_value(value_obj: dict[str, Any]) -> Any:
    if "integerValue" in value_obj:
        return int(value_obj["integerValue"])
    if "doubleValue" in value_obj:
        return float(value_obj["doubleValue"])
    if "stringValue" in value_obj:
        return value_obj["stringValue"]
    if "booleanValue" in value_obj:
        return bool(value_obj["booleanValue"])
    if "nullValue" in value_obj:
        return None
    if "timestampValue" in value_obj:
        return value_obj["timestampValue"]
    if "mapValue" in value_obj:
        nested = value_obj.get("mapValue", {}).get("fields", {})
        return {k: parse_firestore_typed_value(v) for k, v in nested.items()}
    if "arrayValue" in value_obj:
        arr = value_obj.get("arrayValue", {}).get("values", [])
        return [parse_firestore_typed_value(v) for v in arr]
    return value_obj


def parse_firestore_document(doc: dict[str, Any]) -> dict[str, Any]:
    fields = doc.get("fields", {})
    parsed = {k: parse_firestore_typed_value(v) for k, v in fields.items()}
    parsed["_name"] = doc.get("name", "")
    parsed["_createTime"] = doc.get("createTime", "")
    parsed["_updateTime"] = doc.get("updateTime", "")
    return parsed


def decode_readings(record: dict[str, Any]) -> dict[str, Any]:
    # Map compact ESP keys to readable names.
    decoded = {
        "ts": record.get("ts"),
        "temperature_c": record.get("t"),
        "humidity_pct": record.get("h"),
        "batt_voltage_v": record.get("bv"),
        "batt_current_a": record.get("bi"),
        "soc_pct": record.get("soc"),
        "batt_internal_resistance_mohm": record.get("ir"),
        "_name": record.get("_name"),
        "_createTime": record.get("_createTime"),
        "_updateTime": record.get("_updateTime"),
    }

    ts = decoded.get("ts")
    if isinstance(ts, int) and ts > 0:
        decoded["ts_iso_utc"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    else:
        decoded["ts_iso_utc"] = None

    return decoded


def decode_heartbeats(record: dict[str, Any]) -> dict[str, Any]:
    decoded = {
        "station_id": record.get("station_id"),
        "timestamp": record.get("timestamp"),
        "uptime_h": record.get("uptime_h"),
        "batt_voltage": record.get("batt_voltage"),
        "http_2xx": record.get("http_2xx"),
        "http_4xx": record.get("http_4xx"),
        "http_5xx": record.get("http_5xx"),
        "http_transport": record.get("http_transport"),
        "last_http": record.get("last_http"),
        "pending_rows": record.get("pending_rows"),
        "sd_fault": bool(record.get("sd_fault", 0)),
        "sd_ok": bool(record.get("sd_ok", 0)),
        "sd_remount_attempts": record.get("sd_remount_attempts"),
        "sd_remount_success": record.get("sd_remount_success"),
        "ntp_backoff_s": record.get("ntp_backoff_s"),
        "_name": record.get("_name"),
        "_createTime": record.get("_createTime"),
        "_updateTime": record.get("_updateTime"),
    }
    return decoded


def list_documents(collection: str, limit: int) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    page_token = ""

    while len(docs) < limit:
        page_size = min(100, limit - len(docs))
        params = {
            "key": FIREBASE_API_KEY,
            "pageSize": str(page_size),
        }
        if page_token:
            params["pageToken"] = page_token

        url = f"{FIRESTORE_BASE}/{collection}?{urlencode(params)}"
        with urlopen(url, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        raw_docs = payload.get("documents", [])
        docs.extend(raw_docs)

        page_token = payload.get("nextPageToken", "")
        if not page_token or not raw_docs:
            break

    return docs


def decode_collection(rows: list[dict[str, Any]], collection: str) -> list[dict[str, Any]]:
    parsed_rows = [parse_firestore_document(r) for r in rows]

    if collection == "readings":
        return [decode_readings(r) for r in parsed_rows]
    if collection == "heartbeats":
        return [decode_heartbeats(r) for r in parsed_rows]

    return parsed_rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch and decode telemetry from Firestore using ESP credentials"
    )
    parser.add_argument(
        "--collection",
        default="readings",
        choices=["readings", "heartbeats"],
        help="Firestore collection to fetch (default: readings)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Maximum number of documents to fetch (default: 200)",
    )
    parser.add_argument(
        "--out",
        default="firebase_decoded.txt",
        help="Output file path (JSON text format). Default: firebase_decoded.txt",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty print output JSON in terminal",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.limit <= 0:
        print("--limit must be greater than 0")
        return 1

    try:
        raw_docs = list_documents(args.collection, args.limit)
    except Exception as ex:
        print(f"Failed to fetch Firestore documents: {ex}")
        return 1

    decoded = decode_collection(raw_docs, args.collection)

    out_path = Path(args.out)
    out_path.write_text(json.dumps(decoded, indent=2), encoding="utf-8")

    print(f"Collection: {args.collection}")
    print(f"Fetched documents: {len(raw_docs)}")
    print(f"Wrote decoded output: {out_path}")

    if decoded:
        print("Sample decoded row:")
        print(json.dumps(decoded[0], indent=2 if args.pretty else None))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
