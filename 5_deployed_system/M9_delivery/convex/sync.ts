/**
 * Sync Convex node metadata → Firebase RTDB immediately.
 * Triggered by node mutations via ctx.scheduler.runAfter(0, internal.sync.triggerRtdbSync, {}).
 */
import { internalAction } from "./_generated/server";

export const triggerRtdbSync = internalAction({
  args: {},
  handler: async (_ctx) => {
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

      const res = await fetch(syncUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ trigger: "convex_mutation" }),
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
