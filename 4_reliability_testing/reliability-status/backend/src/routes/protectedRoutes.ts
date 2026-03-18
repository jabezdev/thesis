import { getSessionFromRequest } from "../auth";
import { buildChartsCsv, buildReadingsCsv, isMetric } from "../services/payloads";
import { csv, json, text } from "../http";
import { normalizeApiPath } from "./path";

export async function handleProtectedRoute(req: Request, url: URL): Promise<Response | null> {
  const path = normalizeApiPath(url.pathname);
  const protectedRoute = path === "/api/export/readings.csv" || path === "/api/export/charts.csv";
  if (!protectedRoute) {
    return null;
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  if (path === "/api/export/readings.csv") {
    const hours = Math.min(24 * 14, Math.max(1, Number(url.searchParams.get("hours") ?? 24)));
    return csv(buildReadingsCsv(hours), `readings_last_${hours}h.csv`);
  }

  if (path === "/api/export/charts.csv") {
    const hours = Math.min(24 * 14, Math.max(1, Number(url.searchParams.get("hours") ?? 24)));
    const bucketMinutes = Math.min(60, Math.max(1, Number(url.searchParams.get("bucketMinutes") ?? 5)));
    const metric = url.searchParams.get("metric");
    if (metric && !isMetric(metric)) {
      return text("Unsupported metric\n", { status: 400 });
    }
    return csv(buildChartsCsv(hours, bucketMinutes, metric), `charts_last_${hours}h.csv`);
  }

  return null;
}
