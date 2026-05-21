import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { McpClient } from "@/lib/mcp";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function authHandlers() {
  return [
    http.post("http://localhost:8088/api/v1/security/login", () =>
      HttpResponse.json({ access_token: "test-access-token" })
    ),
    http.get("http://localhost:8088/api/v1/security/csrf_token", ({ request }) => {
      const auth = request.headers.get("authorization");
      if (auth !== "Bearer test-access-token") {
        return new HttpResponse(null, { status: 401 });
      }
      return HttpResponse.json({ result: "test-csrf-token" });
    }),
  ];
}

describe("McpClient (Superset REST)", () => {
  it("listDashboards logs in, fetches CSRF, then returns parsed result", async () => {
    server.use(
      ...authHandlers(),
      http.get("http://localhost:8088/api/v1/dashboard/", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer test-access-token");
        return HttpResponse.json({
          result: [{ id: 1, dashboard_title: "Demo" }],
        });
      })
    );
    const c = new McpClient();
    const r = await c.listDashboards();
    expect(r).toEqual([{ id: 1, dashboard_title: "Demo" }]);
  });

  it("throws McpError on 4xx", async () => {
    server.use(
      ...authHandlers(),
      http.get("http://localhost:8088/api/v1/dashboard/", () =>
        HttpResponse.json({ message: "forbidden" }, { status: 403 })
      )
    );
    const c = new McpClient();
    await expect(c.listDashboards()).rejects.toThrow(/403/);
  });

  it("re-logins once on 401 then succeeds", async () => {
    let getCalls = 0;
    server.use(
      ...authHandlers(),
      http.get("http://localhost:8088/api/v1/dashboard/", () => {
        getCalls++;
        if (getCalls === 1) return new HttpResponse(null, { status: 401 });
        return HttpResponse.json({ result: [] });
      })
    );
    const c = new McpClient();
    const r = await c.listDashboards();
    expect(r).toEqual([]);
    expect(getCalls).toBe(2);
  });

  it("getChart parses params field as JSON", async () => {
    server.use(
      ...authHandlers(),
      http.get("http://localhost:8088/api/v1/chart/42", () =>
        HttpResponse.json({
          result: {
            slice_name: "X",
            viz_type: "table",
            datasource_id: 1,
            params: JSON.stringify({ groupby: ["a"] }),
          },
        })
      )
    );
    const c = new McpClient();
    const r = await c.getChart(42);
    expect(r.slice_name).toBe("X");
    expect(r.viz_type).toBe("table");
    expect(r.datasource_id).toBe(1);
    expect(r.params).toEqual({ groupby: ["a"] });
  });
});
