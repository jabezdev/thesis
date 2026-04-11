/**
 * Sync Convex node metadata to Firebase RTDB immediately.
 * Triggered by node mutations via ctx.scheduler.runAfter(0, internal.sync.triggerRtdbSync, {}).
 *
 * When nodeId + calibration are provided (calibration mutations), the processor writes
 * that node's calibration to RTDB immediately (awaited) before responding, so Public and
 * Status pages receive the update within the same HTTP round-trip. A full metadata sync
 * still runs in the background to keep all other fields consistent.
 */
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const calibrationV = v.object({
  temp_offset: v.number(),
  temp_scalar: v.number(),
  hum_offset: v.number(),
  hum_scalar: v.number(),
  rain_scalar: v.number(),
  batt_v_offset: v.number(),
  solar_v_offset: v.number(),
});

export const triggerRtdbSync = internalAction({
  args: {
    nodeId: v.optional(v.string()),
    calibration: v.optional(calibrationV),
  },
  handler: async (_ctx, args) => {
    // Convex actions have access to process.env at runtime.
    // PROCESSOR_SYNC_URL is set as a Convex environment variable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (globalThis as any).process?.env ?? {};
    const syncUrl: string | undefined = env["PROCESSOR_SYNC_URL"];
    const syncSecret: string | undefined = env["PROCESSOR_SYNC_SECRET"];

    if (!syncUrl) {
      console.warn("[sync] PROCESSOR_SYNC_URL not set — skipping immediate RTDB sync.");
      return { ok: false, reason: "no_url" };
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (syncSecret) headers["x-sync-secret"] = syncSecret;

      const body: Record<string, unknown> = { trigger: "convex_mutation" };
      if (args.nodeId) body.nodeId = args.nodeId;
      if (args.calibration) body.calibration = args.calibration;

      const res = await fetch(syncUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error(`[sync] Processor /sync returned ${res.status}`);
        return { ok: false, status: res.status };
      }

      console.log("[sync] RTDB sync triggered successfully.");
      return { ok: true };
    } catch (err) {
      console.error("[sync] Failed to reach processor:", String(err));
      return { ok: false, error: String(err) };
    }
  },
});
