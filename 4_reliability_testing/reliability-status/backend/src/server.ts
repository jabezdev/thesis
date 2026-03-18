import { config } from "./config";
import { fetchApp } from "./app";
import { startPoller } from "./poller";

if (config.authPassword === "" && config.authPasswordHash === "") {
  console.warn("[SECURITY] AUTH_PASSWORD or AUTH_PASSWORD_HASH is not set. Login will always fail.");
}

if (config.sessionSecret === "change-this-secret") {
  console.warn("[SECURITY] SESSION_SECRET is using default value. Set a strong secret in production.");
}

console.log(
  `[AUTH] user=${config.authUsername.trim().toLowerCase()} mode=${config.authPasswordHash ? "hash_with_plain_fallback" : "plain"}`
);

Bun.serve({
  hostname: "0.0.0.0",
  port: config.port,
  fetch: fetchApp
});

console.log(`reliability-status backend listening on :${config.port}`);

// Keep API responsive even when Firestore is slow/unreachable.
void startPoller();
