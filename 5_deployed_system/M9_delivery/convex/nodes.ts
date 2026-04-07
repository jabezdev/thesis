import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * @panahonCore - Fleet Management Queries
 */

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("nodes").collect();
  },
});

export const getNodeByNodeId = query({
  args: { node_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("nodes")
      .withIndex("by_node_id", (q) => q.eq("node_id", args.node_id))
      .unique();
  },
});

export const create = mutation({
  args: {
    node_id: v.string(),
    mac_address: v.string(),
    name: v.string(),
    location: v.object({
      lat: v.number(),
      lng: v.number(),
      description: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("nodes", {
      ...args,
      status: "active",
      calibration: {
        temp_offset: 0,
        temp_scalar: 1,
        hum_offset: 0,
        hum_scalar: 1,
        rain_scalar: 1,
        batt_v_offset: 0,
        solar_v_offset: 0,
      },
      installed_at: Date.now(),
      last_maintained_at: Date.now(),
    });
  },
});

export const updateCalibration = mutation({
  args: {
    nodeId: v.id("nodes"),
    calibration: v.object({
      temp_offset: v.number(),
      temp_scalar: v.number(),
      hum_offset: v.number(),
      hum_scalar: v.number(),
      rain_scalar: v.number(),
      batt_v_offset: v.number(),
      solar_v_offset: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.nodeId, {
      calibration: args.calibration,
      last_maintained_at: Date.now(),
    });
  },
});
