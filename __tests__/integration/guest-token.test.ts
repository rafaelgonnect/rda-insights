import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("POST /api/guest-token", () => {
  it("returns token from MCP", async () => {
    server.use(
      http.post("http://localhost:5008/mcp", () =>
        HttpResponse.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: JSON.stringify({ token: "abc.def.ghi" }) }],
          },
        })
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
