import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

const locationFields = v.object({
  lat: v.number(),
  lng: v.number(),
  description: v.string(),
});

const calibrationFields = v.object({
  temp_offset: v.number(),
  temp_scalar: v.number(),
  hum_offset: v.number(),
  hum_scalar: v.number(),
  rain_scalar: v.number(),
  batt_v_offset: v.number(),
  solar_v_offset: v.number(),
});

const alertThresholdsFields = v.object({
  high_temp: v.number(),
  heavy_rain: v.number(),
});

export const list = query({
  handler: async (ctx) => ctx.db.query("nodes").collect(),
});

export const getNodeByNodeId = query({
  args: { node_id: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("nodes")
      .withIndex("by_node_id", (q) => q.eq("node_id", args.node_id))
      .unique(),
});

export const create = mutation({
  args: {
    node_id: v.string(),
    mac_address: v.string(),
    name: v.string(),
    location: locationFields,
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("nodes", {
      ...args,
      status: "active",
      calibration: {
        temp_offset: 0, temp_scalar: 1,
        hum_offset: 0, hum_scalar: 1,
        rain_scalar: 1,
        batt_v_offset: 0, solar_v_offset: 0,
      },
      alert_thresholds: {
        high_temp: 40,
        heavy_rain: 5,
      },
      installed_at: Date.now(),
      last_maintained_at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.sync.triggerRtdbSync, {});
    return id;
  },
});

export const updateNode = mutation({
  args: {
    nodeId: v.id("nodes"),
    name: v.string(),
    mac_address: v.string(),
    location: locationFields,
  },
  handler: async (ctx, { nodeId, ...fields }) => {
    await ctx.db.patch(nodeId, fields);
    await ctx.scheduler.runAfter(0, internal.sync.triggerRtdbSync, {});
  },
});

export const updateStatus = mutation({
  args: {
    nodeId: v.id("nodes"),
    status: v.union(v.literal("active"), v.literal("maintenance"), v.literal("offline")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.nodeId, { status: args.status });
    await ctx.scheduler.runAfter(0, internal.sync.triggerRtdbSync, {});
  },
});

export const deleteNode = mutation({
  args: { nodeId: v.id("nodes") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.nodeId);
    await ctx.scheduler.runAfter(0, internal.sync.triggerRtdbSync, {});
  },
});

export const updateCalibration = mutation({
  args: { nodeId: v.id("nodes"), calibration: calibrationFields },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.nodeId, {
      calibration: args.calibration,
      last_maintained_at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.sync.triggerRtdbSync, {});
  },
});

export const updateAlertThresholds = mutation({
  args: { nodeId: v.id("nodes"), thresholds: alertThresholdsFields },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.nodeId, {
      alert_thresholds: args.thresholds,
    });
    await ctx.scheduler.runAfter(0, internal.sync.triggerRtdbSync, {});
  },
});
