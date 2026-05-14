import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { _reset } from "@/lib/rate-limit";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => _reset());

// Shared in-memory Redis store across all tests in this file.
// Exposed via vi.hoisted so we can clear it between tests.
const { redisStore } = vi.hoisted(() => ({ redisStore: new Map<string, string>() }));
vi.mock("ioredis", () => {
  function MockRedis() {
    return {
      async get(k: string) {
        return redisStore.get(k) ?? null;
      },
      async setex(k: string, _ttl: number, v: string) {
        redisStore.set(k, v);
        return "OK";
      },
      async incrbyfloat(k: string, n: number) {
        const cur = parseFloat(redisStore.get(k) ?? "0");
        const next = cur + n;
        redisStore.set(k, String(next));
        return String(next);
      },
      async ping() {
        return "PONG";
      },
      quit() {},
    };
  }
  return { default: MockRedis };
});
beforeEach(() => redisStore.clear());

// Hoisted Anthropic mock — returns a stream by default
const { streamMock } = vi.hoisted(() => ({
  streamMock: vi.fn(() =>
    (async function* () {
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "Resumo." } };
      yield { type: "message_delta", usage: { input_tokens: 100, output_tokens: 10 } };
    })()
  ),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));

function mockMcp() {
  server.use(
    http.post("http://localhost:5008/mcp", async ({ request }) => {
      const body = (await request.json()) as { params: { name: string } };
      const map: Record<string, unknown> = {
        get_chart: { slice_name: "X", viz_type: "table", datasource_id: 1, params: {} },
        get_dataset_columns: [{ column_name: "a", type: "INT" }],
        get_chart_data: { columns: ["a"], rows: [{ a: 1 }] },
        get_health: { status: "ok" },
      };
      return HttpResponse.json({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: JSON.stringify(map[body.params.name]) }] },
      });
    })
  );
}

async function readSseBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe("POST /api/insights/chart/[id]", () => {
  it("streams insight on happy path", async () => {
    mockMcp();
    const { POST } = await import("@/app/api/insights/chart/[id]/route");
    const req = new Request("http://x/api/insights/chart/42", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.1.1.1" },
      body: JSON.stringify({ filters: {} }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(200);
    const body = await readSseBody(res);
    expect(body).toContain("Resumo.");
    expect(body).toContain("event: done");
  });

  it("returns 429 after 30 calls per IP", async () => {
    mockMcp();
    const { POST } = await import("@/app/api/insights/chart/[id]/route");
    for (let i = 0; i < 30; i++) {
      const r = await POST(
        new Request("http://x/api/insights/chart/42", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "2.2.2.2" },
          body: JSON.stringify({ filters: {} }),
        }),
        { params: Promise.resolve({ id: "42" }) }
      );
      await readSseBody(r); // drain
    }
    const r = await POST(
      new Request("http://x/api/insights/chart/42", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "2.2.2.2" },
        body: JSON.stringify({ filters: {} }),
      }),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(r.status).toBe(429);
  });

  it("returns 429 when monthly cost cap is reached", async () => {
    mockMcp();
    // pre-fill the cost counter past the cap
    const Redis = (await import("ioredis")).default as unknown as new () => {
      incrbyfloat: (k: string, n: number) => Promise<string>;
    };
    const r = new Redis();
    await r.incrbyfloat(`monthly_cost:${new Date().toISOString().slice(0, 7)}`, 9999);

    const { POST } = await import("@/app/api/insights/chart/[id]/route");
    const res = await POST(
      new Request("http://x/api/insights/chart/42", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "3.3.3.3" },
        body: JSON.stringify({ filters: {} }),
      }),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Monthly cost cap/);
  });

  it("short-circuits on empty chart data", async () => {
    server.use(
      http.post("http://localhost:5008/mcp", async ({ request }) => {
        const body = (await request.json()) as { params: { name: string } };
        const map: Record<string, unknown> = {
          get_chart: { slice_name: "X", viz_type: "table", datasource_id: 1, params: {} },
          get_dataset_columns: [{ column_name: "a", type: "INT" }],
          get_chart_data: { columns: ["a"], rows: [] },
        };
        return HttpResponse.json({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: JSON.stringify(map[body.params.name]) }] },
        });
      })
    );
    const { POST } = await import("@/app/api/insights/chart/[id]/route");
    const res = await POST(
      new Request("http://x/api/insights/chart/42", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
        body: JSON.stringify({ filters: {} }),
      }),
      { params: Promise.resolve({ id: "42" }) }
    );
    const body = await readSseBody(res);
    expect(body).toContain("Esse gráfico está sem dados");
  });
});
