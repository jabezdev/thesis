import { json } from "./http";
import { handlePublicRoute } from "./routes/publicRoutes";
import { handleProtectedRoute } from "./routes/protectedRoutes";

export async function fetchApp(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return json({}, { status: 204 });
  }

  const publicResponse = await handlePublicRoute(req, url);
  if (publicResponse) {
    return publicResponse;
  }

  const protectedResponse = await handleProtectedRoute(req, url);
  if (protectedResponse) {
    return protectedResponse;
  }

  return json({ error: "Not found" }, { status: 404 });
}