# Panahon.live — Sipat Banwa M9 Delivery

This directory contains the unified ecosystem for **Panahon.live**, a scalable telemetry and disaster risk reduction (DRRM) platform. Built with **Bun**, **React**, **Vite**, **TailwindCSS**, **Clerk**, and **Convex**.

## Project Goals

1.  **Unified Data Pipeline (Processor)**: A constantly running Bun app that listens to Firestore for new documents, simplifies and normalizes them for easy querying into `m6_` collections (e.g. `m6_node_data`). It also publishes the latest reading and a 1-hour window to Firebase RTDB for real-time frontend use.
2.  **Scalable Multi-Node Support**: Design the system to handle an expanding fleet of sensor nodes, managing their metadata via Convex.
3.  **Modular Web Apps**: Four specialized single-page applications built with React, TypeScript, Vite, and TailwindCSS:
    - `panahon.live`: Public site for the latest and last 1 hour data.
    - `dashboard.panahon.live`: Dashboard for the LGU users and DRRM officers (uses Convex and Clerk).
    - `admin.panahon.live`: For researchers and maintainers. This is to setup the nodes, do configuration, and manage calibration.
    - `status.panahon.live`: System status that is open to see (no need for login), for quick monitoring.
4.  **Frontend Calibration**: Maintain 100% RAW data on the databases. All calibration and correction logic is applied dynamically on the frontend.

## Ecosystem Architecture

```text
M9_delivery/
├── apps/
│   ├── processor/      # Bun Telemetry Processor (Firestore -> RTDB)
│   ├── public-site/    # panahon.live
│   ├── lgu-dashboard/  # dashboard.panahon.live
│   ├── admin-console/  # admin.panahon.live
│   └── status-page/    # status.panahon.live
└── packages/
    ├── shared/         # Core Physics & Types
    └── ui/             # Unified Design System
```

## Raw telemetry export and battery analysis

The processor app now includes a raw Firestore export script at
`apps/processor/export_raw_telemetry_to_csv.mjs`.

It reads the `node_data_0v3` collection, flattens each document's `history[]`
samples, and writes a CSV to `DATA/raw_telemetry_export.csv`.

For battery analysis, use the Colab-ready Python script at
`apps/processor/colab_battery_analysis.py`. Copy that script into Google Colab
after exporting the CSV.

## Deployment

The system is designed for **VPS Deployment** via **Dokploy**. Each application and the telemetry processor have their own independent Docker lifecycle, allowing for atomic updates and decoupled scaling.

---

© 2026 Project Sipat Banwa — Developed as part of a Master's Thesis.
