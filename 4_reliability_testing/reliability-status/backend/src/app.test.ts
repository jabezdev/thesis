import { describe, expect, test } from "bun:test";
import { fetchApp } from "./app";

describe("API smoke tests", () => {
  test("GET /api/health returns 200 and poller info", async () => {
    const res = await fetchApp(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; readingsStored: number; poller: { ticks: number } };
    expect(body.ok).toBe(true);
    expect(typeof body.readingsStored).toBe("number");
    expect(typeof body.poller.ticks).toBe("number");
  });

  test("GET /api/auth/session returns unauthenticated payload when no cookie", async () => {
    const res = await fetchApp(new Request("http://localhost/api/auth/session"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  test("POST /api/auth/logout always clears cookie", async () => {
    const res = await fetchApp(new Request("http://localhost/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")?.includes("Max-Age=0")).toBe(true);
  });

  test("GET /api/export/readings.csv requires session", async () => {
    const res = await fetchApp(new Request("http://localhost/api/export/readings.csv"));
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  test("GET /api/latest/ with trailing slash remains public", async () => {
    const res = await fetchApp(new Request("http://localhost/api/latest/"));
    expect(res.status).toBe(200);
  });

  test("GET unknown api route returns 404 instead of unauthorized", async () => {
    const res = await fetchApp(new Request("http://localhost/api/not-real"));
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not found");
  });
});
