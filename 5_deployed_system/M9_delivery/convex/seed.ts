import { mutation } from "./_generated/server";

export const nodes = mutation({
  handler: async (ctx) => {
    // Clear existing nodes if any
    const existing = await ctx.db.query("nodes").collect();
    for (const node of existing) {
      await ctx.db.delete(node._id);
    }

    // Seed the pilot node
    await ctx.db.insert("nodes", {
      node_id: "node_1",
      mac_address: "AA:BB:CC:DD:EE:01",
      name: "Pilot Module (Baguio Central)",
      location: {
        lat: 16.4023,
        lng: 120.5960,
        description: "Panahon HQ / City Center",
      },
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

    console.log("Seed complete: Pilot node_1 inserted.");
  },
});
