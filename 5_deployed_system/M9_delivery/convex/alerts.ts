import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("alerts").order("desc").collect();
  },
});

export const listActive = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("alerts")
      .withIndex("by_resolved", (q) => q.eq("resolved", false))
      .order("desc")
      .collect();
  },
});

export const listForNode = query({
  args: { node_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("alerts")
      .withIndex("by_node_unresolved", (q) => q.eq("node_id", args.node_id))
      .collect();
  },
});

export const resolve = mutation({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.alertId, { resolved: true, resolved_at: Date.now() });
  },
});

export const deleteAlert = mutation({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.alertId);
  },
});

export const create = mutation({
  args: {
    node_id: v.string(),
    type: v.union(
      v.literal("heavy_rain"),
      v.literal("high_temp"),
      v.literal("battery_critical"),
      v.literal("offline"),
      v.literal("manual")
    ),
    message: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("alerts", { ...args, triggered_at: Date.now(), resolved: false });
  },
});
