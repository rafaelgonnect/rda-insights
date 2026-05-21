import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function authHandlers() {
  return [
    http.post("http://localhost:8088/api/v1/security/login", () =>
      HttpResponse.json({ access_token: "test-access-token" })
    ),
    http.get("http://localhost:8088/api/v1/security/csrf_token", () =>
      HttpResponse.json({ result: "test-csrf-token" })
    ),
  ];
}

describe("POST /api/guest-token", () => {
  it("returns token + embed uuid from Superset", async () => {
    server.use(
      ...authHandlers(),
      http.get("http://localhost:8088/api/v1/dashboard/7/embedded", () =>
        HttpResponse.json({ result: { uuid: "embed-uuid-7" } })
      ),
      http.post("http://localhost:8088/api/v1/security/guest_token/", () =>
        HttpResponse.json({ token: "abc.def.ghi" })
      )
    );
    const { POST } = await import("@/app/api/guest-token/route");
    const req = new Request("http://x/api/guest-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dashboard_id: 7 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("abc.def.ghi");
    expect(body.uuid).toBe("embed-uuid-7");
  });

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("@/app/api/guest-token/route");
    const req = new Request("http://x/api/guest-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
