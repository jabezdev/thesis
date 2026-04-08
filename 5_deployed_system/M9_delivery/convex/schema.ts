import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  nodes: defineTable({
    node_id: v.string(), // e.g. "node_1"
    mac_address: v.string(),
    name: v.string(),
    location: v.object({
      lat: v.number(),
      lng: v.number(),
      description: v.string(),
    }),
    status: v.union(v.literal("active"), v.literal("maintenance"), v.literal("offline")),
    // Calibration constants
    // TODO(future): Calibration/correction will require more complex functions 
    // (e.g. polynomial curves or piecewise functions) rather than simple scalar/offset math.
    // Ensure the shared @panahon/shared package is updated once the exact models are known.
    calibration: v.object({
      temp_offset: v.number(),
      temp_scalar: v.number(),
      hum_offset: v.number(),
      hum_scalar: v.number(),
      rain_scalar: v.number(),
      batt_v_offset: v.number(),
      solar_v_offset: v.number(),
    }),
    alert_thresholds: v.optional(v.object({
      high_temp: v.number(),
      heavy_rain: v.number(),
    })),
    installed_at: v.number(),
    last_maintained_at: v.number(),
  }).index("by_node_id", ["node_id"]),

  users: defineTable({
    clerk_id: v.string(), // Linked to Clerk
    email: v.string(),
    name: v.string(),
    role: v.union(v.literal("admin"), v.literal("lgu"), v.literal("viewer")),
    lgu_region: v.optional(v.string()), // For restricting which sensors they care about
  }).index("by_clerk_id", ["clerk_id"]),

  alerts: defineTable({
    node_id: v.string(),
    type: v.union(v.literal("heavy_rain"), v.literal("high_temp"), v.literal("battery_critical"), v.literal("offline"), v.literal("manual")),
    message: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    triggered_at: v.number(),
    resolved: v.boolean(),
    resolved_at: v.optional(v.number()),
  }).index("by_node_unresolved", ["node_id", "resolved"])
    .index("by_resolved", ["resolved"]),
});
