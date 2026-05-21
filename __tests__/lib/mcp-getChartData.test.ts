import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { McpClient, McpError } from "@/lib/mcp";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Shared auth mock handlers — mirrors the pattern in __tests__/unit/mcp.test.ts */
function authHandlers() {
  return [
    http.post("http://localhost:8088/api/v1/security/login", () =>
      HttpResponse.json({ access_token: "test-token" })
    ),
    http.get("http://localhost:8088/api/v1/security/csrf_token", () =>
      HttpResponse.json({ result: "test-csrf" })
    ),
  ];
}

const CHART_RESULT = {
  colnames: ["date", "revenue"],
  data: [{ date: "2024-01", revenue: 1000 }],
};

describe("McpClient.getChartData — two-path fallback", () => {
  it("Test 1: GET succeeds with rows → returns normalised columns and rows", async () => {
    server.use(
      ...authHandlers(),
      http.get("http://localhost:8088/api/v1/chart/1/data/", () =>
        HttpResponse.json({ result: [CHART_RESULT] })
      )
    );

    const client = new McpClient();
    const result = await client.getChartData(1);

    expect(result.columns).toEqual(["date", "revenue"]);
    expect(result.rows).toEqual([{ date: "2024-01", revenue: 1000 }]);
  });

  it("Test 2: GET returns 400 (query context missing) → falls back to POST and normalises response", async () => {
    let postCalled = false;

    server.use(
      ...authHandlers(),
      // GET path: 400 with the query_context error message
      http.get("http://localhost:8088/api/v1/chart/2/data/", () =>
        HttpResponse.json(
          { message: "Chart has no query context saved. Please save the chart again." },
          { status: 400 }
        )
      ),
      // getChart call for fallback path
      http.get("http://localhost:8088/api/v1/chart/2", () =>
        HttpResponse.json({
          result: {
            slice_name: "Revenue",
            viz_type: "bar",
            datasource_id: 5,
            datasource_type: "table",
            params: JSON.stringify({
              x_axis: "date",
              groupby: [],
              metrics: ["sum__revenue"],
              row_limit: 50,
            }),
          },
        })
      ),
      // POST path: return rows
      http.post("http://localhost:8088/api/v1/chart/data", () => {
        postCalled = true;
        return HttpResponse.json({ result: [CHART_RESULT] });
      })
    );

    const client = new McpClient();
    const result = await client.getChartData(2);

    expect(postCalled).toBe(true);
    expect(result.columns).toEqual(["date", "revenue"]);
    expect(result.rows).toEqual([{ date: "2024-01", revenue: 1000 }]);
  });

  it("Test 3: GET returns 500 (server error) → no fallback attempted → throws McpError", async () => {
    let postCalled = false;

    server.use(
      ...authHandlers(),
      http.get("http://localhost:8088/api/v1/chart/3/data/", () =>
        new HttpResponse(null, { status: 500 })
      ),
      // This handler should NOT be called
      http.post("http://localhost:8088/api/v1/chart/data", () => {
        postCalled = true;
        return HttpResponse.json({ result: [CHART_RESULT] });
      }),
      // getChart — also should not be called, but register to avoid unhandled error
      http.get("http://localhost:8088/api/v1/chart/3", () =>
        HttpResponse.json({ result: { slice_name: "X", viz_type: "bar", datasource_id: 1, params: "{}" } })
      )
    );

    const client = new McpClient();
    await expect(client.getChartData(3)).rejects.toBeInstanceOf(McpError);
    expect(postCalled).toBe(false);
  });
});
