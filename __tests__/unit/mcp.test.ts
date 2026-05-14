import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { McpClient } from "@/lib/mcp";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("McpClient", () => {
  it("listDashboards returns parsed result", async () => {
    server.use(
      http.post("http://localhost:5008/mcp", async ({ request }) => {
        const auth = request.headers.get("authorization");
        expect(auth).toMatch(/^Bearer eyJ/);
        return HttpResponse.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: JSON.stringify([{ id: 1, dashboard_title: "Demo" }]) }],
          },
        });
      })
    );
    const c = new McpClient();
    const r = await c.listDashboards();
    expect(r).toEqual([{ id: 1, dashboard_title: "Demo" }]);
  });

  it("throws on MCP error response", async () => {
    server.use(
      http.post("http://localhost:5008/mcp", () =>
        HttpResponse.json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } })
      )
    );
    const c = new McpClient();
    await expect(c.listDashboards()).rejects.toThrow(/boom/);
  });

  it("retries once on 5xx then throws", async () => {
    let calls = 0;
    server.use(
      http.post("http://localhost:5008/mcp", () => {
        calls++;
        return new HttpResponse("upstream error", { status: 502 });
      })
    );
    const c = new McpClient();
    await expect(c.listDashboards()).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
