import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

vi.mock("ioredis", () => ({
  default: class {
    async ping() {
      return "PONG";
    }
    quit() {}
  },
}));

describe("GET /api/health", () => {
  it("returns 200 when all deps are up", async () => {
    server.use(
      http.get("http://localhost:8088/health", () => HttpResponse.json({ status: "ok" }))
    );
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.superset).toBe("up");
  });

  it("returns 503 when Superset is down", async () => {
    server.use(
      http.get("http://localhost:8088/health", () => new HttpResponse(null, { status: 503 }))
    );
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
  });
});
