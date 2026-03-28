# OTA Fleet Manager — React Dashboard Setup

This is the web portal for managing the Sipat Banwa ESP32 fleet.
Use it to upload firmware, deploy updates, roll back nodes, and tweak per-node business config — all without touching the hardware.

## Stack

- **Vite + React (TypeScript)**
- **Firebase** (Realtime Database · Firestore · Storage)
- **Raw CSS** (no Tailwind/MUI)

---

## Firebase Data Architecture

Understanding the schema is essential before building the UI.

### Realtime Database (RTDB) — live control plane

```text
/nodes/{nodeId}/
  config/                   ← Dashboard WRITES here → ESP32 reacts instantly
    target_version: "v1.1"  ← Set this to trigger update OR rollback
    target_url:     "https://firebasestorage.googleapis.com/..."
    blink_interval: 500     ← Any other business config variable

  status/                   ← ESP32 WRITES here → Dashboard reads this
    current_version: "v1.0" ← What is actually running right now
    ota_status: "idle"      ← "idle" | "updating" | "failed"
    last_boot_ms: 123456
    ota_details: "..."      ← Error message if ota_status == "failed"

/firmwares/{versionName}/   ← Firmware registry (Dashboard WRITES on upload)
  version_name: "v1.1"
  download_url:  "https://firebasestorage.googleapis.com/..."
  uploaded_at:   1711584000000
  description:   "Added sensor averaging"
```

### Firebase Storage — firmware binary vault

```text
gs://panahon-live.firebasestorage.app/firmware/{version}.bin
```

### Firestore — node telemetry (read-only in this dashboard)

Firestore holds weather readings and heartbeats pushed by the ingestion pipeline.
The OTA dashboard only *reads* from Firestore to display node health context.

---

## How OTA Update and Rollback Work

| Action | What you write to RTDB | What the ESP32 does |
|--------|------------------------|---------------------|
| **Deploy new version** | `config.target_version = "v1.2"`, `config.target_url = "<url>"` | Detects version mismatch → downloads → reboots → reports `v1.2` in `status` |
| **Rollback** | `config.target_version = "v1.0"`, `config.target_url = "<old url>"` | Same flow — `!=` comparison means older versions trigger a download too |
| **Push config only** | Write any `config.*` key (e.g. `blink_interval`) | Stream fires instantly, no reboot needed |

---

## 1. Initialize the Project

Open a terminal in `5_deployed_system/M8_ota_fleet` and run:

```bash
npx create-vite@latest ota_manager --template react-ts
cd ota_manager
npm install
npm install firebase
```

---

## 2. Firebase Configuration — `src/firebase.ts`

```typescript
import { initializeApp } from "firebase/app";
import { getDatabase }   from "firebase/database";
import { getFirestore }  from "firebase/firestore";
import { getStorage }    from "firebase/storage";

const firebaseConfig = {
  apiKey:            "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg",
  authDomain:        "panahon-live.firebaseapp.com",
  databaseURL:       "https://panahon-live-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId:         "panahon-live",
  storageBucket:     "panahon-live.firebasestorage.app",
  messagingSenderId: "<your-sender-id>",
  appId:             "<your-app-id>",
};

const app = initializeApp(firebaseConfig);

export const rtdb    = getDatabase(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
```

Get the missing values from the Firebase Console → Project Settings → Your Apps.

---

## 3. RTDB Security Rules

In the Firebase Console → Realtime Database → Rules, use these rules while developing.
**Tighten these before going to production.**

```json
{
  "rules": {
    ".read":  true,
    ".write": true
  }
}
```

For production, restrict to authenticated users and validate data shapes.

---

## 4. Features to Build

### A. Firmware Vault (`/src/components/FirmwareVault.tsx`)

**Purpose**: Upload `.bin` files and register them in RTDB so nodes can be pointed at them.

**Logic:**

1. Drag-and-drop or file input — accept `.bin` only.
2. Prompt for a `versionName` (e.g. `v1.2`) and optional `description`.
3. Upload to Firebase Storage at path `firmware/{versionName}.bin` using `uploadBytes`.
4. Get the public download URL with `getDownloadURL`.
5. Write a record to RTDB at `/firmwares/{versionName}`:

   ```typescript
   import { ref as dbRef, set } from "firebase/database";
   import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

   const fileRef = storageRef(storage, `firmware/${versionName}.bin`);
   await uploadBytes(fileRef, file);
   const url = await getDownloadURL(fileRef);

   await set(dbRef(rtdb, `firmwares/${versionName}`), {
     version_name: versionName,
     download_url: url,
     uploaded_at:  Date.now(),
     description,
   });
   ```

6. Display a list of all registered firmwares (read from `/firmwares`) with version, date, and description.

---

### B. Fleet Overview (`/src/components/FleetOverview.tsx`)

**Purpose**: See all nodes at a glance and push updates/rollbacks.

**Data sources:**

- `/nodes` from RTDB — live config and status for every node.
- `/firmwares` from RTDB — list of available firmware versions for the dropdown.

**Per-node card should show:**

| Field | Source |
|-------|--------|
| Node ID | RTDB key |
| Running version | `status.current_version` |
| OTA status | `status.ota_status` (colour-coded: idle=green, updating=yellow, failed=red) |
| Last boot | `status.last_boot_ms` |
| Target version | `config.target_version` |
| OTA error (if any) | `status.ota_details` |

**Deploy / Rollback flow:**

1. Dropdown lists all versions from `/firmwares`.
2. Admin selects a version and clicks **Deploy** (or **Rollback** if older than running).
3. Write to `/nodes/{nodeId}/config`:

   ```typescript
   import { ref, update } from "firebase/database";

   await update(ref(rtdb, `nodes/${nodeId}/config`), {
     target_version: selectedFirmware.version_name,
     target_url:     selectedFirmware.download_url,
   });
   ```

4. The ESP32 stream fires within seconds — `status.ota_status` will change to `"updating"` then the node reboots and reports the new `current_version`.

---

### C. Business Config Panel (`/src/components/NodeConfig.tsx`)

**Purpose**: Edit per-node config variables without touching the firmware.

This reads and writes any non-OTA fields inside `/nodes/{nodeId}/config`.

**Example implementation:**

```typescript
// Read
import { ref, onValue, update } from "firebase/database";

onValue(ref(rtdb, `nodes/${nodeId}/config`), (snap) => {
  const cfg = snap.val();
  setBlinkInterval(cfg?.blink_interval ?? 1000);
  // add any other custom fields your firmware reads
});

// Write
await update(ref(rtdb, `nodes/${nodeId}/config`), {
  blink_interval: newValue,
  // other custom business config fields
});
```

Add one input per config variable your firmware listens to in `streamCallback`.
The ESP32 will apply the change live without rebooting.

---

## 5. Recommended Component Structure

```text
src/
  firebase.ts
  App.tsx                   ← Tab/route between Vault and Fleet
  components/
    FirmwareVault.tsx        ← Upload bin + list registered firmwares
    FleetOverview.tsx        ← Node cards with deploy/rollback
    NodeCard.tsx             ← Single node card (status + actions)
    NodeConfig.tsx           ← Business config editor for a node
  styles/
    global.css
```

---

## 6. Adding a New Node

When you flash a new ESP32 with `ota_base.ino`:

1. Set `FIRMWARE_VERSION` and optionally `NODE_ID_OVERRIDE` in the `.ino`.
2. Flash and power on — the node auto-registers by writing to `/nodes/{nodeId}/status`.
3. Its card appears in the Fleet Overview automatically (RTDB `onValue` listener picks it up).
4. You can now push configs and firmware updates from the dashboard.

No server restart, no database migration needed.

---

## 7. Running Locally

```bash
cd ota_manager
npm run dev
```

Open `http://localhost:5173`. All Firebase calls go directly from the browser to Firebase — no backend needed for this dashboard.
