# M4: Admin Backend (Auth + Admin API + Convex)

**Depends on**: M1 (Database Schema), M2 (Ingestion API)
**Required by**: M6 (Admin Dashboard), M8 (OTA & Fleet Management)

---

## What This Milestone Delivers

The authentication layer (Clerk), real-time admin state service (Convex), and the Admin API endpoints on Fastify that allow LGU administrators to manage nodes, workspaces, and alert rules. This milestone also establishes the OTA command pipeline from admin action to Convex storage.

---

## Requirements

### Clerk Authentication Setup
- Create a Clerk application and configure two environments: development and production.
- Enable **Organizations** in Clerk — each LGU maps to one Clerk Organization.
- Each Clerk Organization ID maps 1:1 to a `workspace_id` in TimescaleDB and a Convex workspace document.
- JWT template: include `org_id` and `org_role` claims in the issued JWT so the Fastify API can extract the workspace context without a separate lookup.
- JWKS endpoint URL is configured as an environment variable on the Fastify server for JWT validation.

### Convex Setup

#### Schema
```typescript
// convex/schema.ts
export default defineSchema({
  workspaces: defineTable({
    clerkOrgId: v.string(),
    workspaceId: v.string(), // matches TimescaleDB workspace_id UUID
    name: v.string(),
  }).index("by_clerk_org", ["clerkOrgId"]),

  alertRules: defineTable({
    workspaceId: v.string(),
    nodeId: v.optional(v.string()), // null = applies to all nodes
    sensorType: v.string(),
    threshold: v.number(),
    condition: v.union(v.literal("above"), v.literal("below")),
    isActive: v.boolean(),
  }).index("by_workspace", ["workspaceId"]),

  userPreferences: defineTable({
    clerkUserId: v.string(),
    workspaceId: v.string(),
    theme: v.optional(v.string()),
    defaultNodeId: v.optional(v.string()),
  }).index("by_user", ["clerkUserId"]),

  pendingCommands: defineTable({
    nodeId: v.string(),
    workspaceId: v.string(),
    commandType: v.union(v.literal("ota"), v.literal("ntp_sync")),
    payload: v.optional(v.string()), // firmware URL for OTA, null for ntp_sync
    createdAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("delivered")),
  }).index("by_node", ["nodeId", "status"]),
});
```

#### Convex Functions

**Queries** (real-time subscriptions):
- `getAlertRules(workspaceId)` — returns all alert rules for a workspace
- `getUserPreferences(clerkUserId)` — returns user preferences
- `getPendingCommands(nodeId)` — returns pending (undelivered) commands for a node

**Mutations**:
- `upsertAlertRule(rule)` — create or update an alert rule
- `deleteAlertRule(id)` — delete an alert rule
- `saveUserPreferences(prefs)` — save user preferences
- `createPendingCommand(nodeId, workspaceId, commandType, payload)` — admin-triggered OTA or NTP push
- `markCommandDelivered(commandId)` — called by Ingestion API after delivering X-Cmd

**Actions** (server-side, can call external services):
- `getNodeMetadata(nodeId)` — fetches node metadata from TimescaleDB via the Fastify Admin API (Clerk auth). Used when Convex needs node metadata for admin-domain operations.

### Admin API Endpoints on Fastify

These endpoints were introduced in M2 but their full business logic lives here.

**`POST /api/v1/admin/nodes`**
- Validates Clerk JWT; extracts `org_id` from JWT claims.
- Looks up `workspace_id` for this `org_id`.
- Generates a cryptographically random 32-byte hex API key.
- Inserts into `nodes` table with the workspace association.
- Returns:
  ```json
  {
    "node_id": "uuid",
    "api_key": "abc123...",
    "label": null,
    "workspace_id": "uuid"
  }
  ```
  This is the only time the plaintext API key is returned. Admin must copy and flash to the node.

**`GET /api/v1/admin/nodes/:node_id`**
- Validates JWT; checks that the requesting workspace owns this node.
- Returns full node metadata from TimescaleDB.

**`PUT /api/v1/admin/nodes/:node_id`**
- Validates JWT + ownership.
- Accepts: `label`, `barangay`, `location_name`, `hardware_version`, per-sensor thresholds.
- Updates `nodes` and `sensor_thresholds` tables.

**`GET /api/v1/admin/nodes`** (list all nodes in workspace)
- Validates JWT; returns all nodes for the requesting workspace.

### Workspace Initialization Flow
When a new LGU is onboarded:
1. Admin creates a Clerk Organization for the LGU.
2. A Convex mutation creates the `workspaces` document linked to the Clerk org ID.
3. The first admin uses `POST /api/v1/admin/nodes` to provision each node.
4. The generated API key is flashed to the node firmware before field deployment.

---

## Interactions

| Interacts With | Direction | How |
|----------------|-----------|-----|
| M1 TimescaleDB | reads + writes → | Admin API reads/writes `nodes`, `sensor_thresholds` |
| M2 Ingestion API | ← called by | Ingestion API validates Clerk JWTs from admin endpoints; reads `pendingCommands` from Convex |
| M6 Admin Dashboard | ← serves | Convex subscriptions + Fastify Admin API for node management |
| M8 OTA | provides → | `createPendingCommand` mutation creates OTA commands; `markCommandDelivered` clears them |

---

## Testing Checklist

### Clerk Setup
- [ ] A test user can sign up and log into the admin dashboard via Clerk
- [ ] The Clerk JWT contains `org_id` and `org_role` claims
- [ ] The JWKS endpoint is reachable by the Fastify server and JWT validation succeeds
- [ ] A JWT from a different Clerk application is rejected by Fastify

### Convex Schema
- [ ] `pendingCommands` table accepts `ota` and `ntp_sync` command types
- [ ] `by_node` index query returns only `pending` status commands for a given node
- [ ] `getAlertRules` query returns only rules for the requesting workspace

### Node Provisioning
- [ ] `POST /api/v1/admin/nodes` with a valid Clerk JWT returns a node record with a 64-character hex API key
- [ ] The returned API key is unique (not reused across two sequential provisioning calls)
- [ ] The provisioned node can immediately authenticate to `POST /api/v1/ingest` using the returned key
- [ ] `POST /api/v1/admin/nodes` with JWT from workspace A cannot create nodes in workspace B

### Node Metadata Management
- [ ] `PUT /api/v1/admin/nodes/:node_id` updates `label` in TimescaleDB; `GET` returns the new value
- [ ] `PUT` with a node_id belonging to a different workspace returns `403`
- [ ] Updating `sensor_thresholds` via `PUT` takes effect on the next ingest request for that node

### OTA Command Pipeline
- [ ] After calling `createPendingCommand("node_1", "ota", "https://...")`, a `pendingCommands` doc exists with `status: pending`
- [ ] Simulated ingestion call from node_1: Ingestion API reads the pending command, returns `X-Cmd: ota=<url>`, calls `markCommandDelivered`
- [ ] After delivery, `pendingCommands` doc status is `delivered` (or removed)
- [ ] If the API server restarts before command delivery: the `pendingCommands` doc persists in Convex and is delivered on the node's next ingestion call

### Convex Actions
- [ ] `getNodeMetadata(nodeId)` Convex action returns node metadata that matches what is in TimescaleDB
