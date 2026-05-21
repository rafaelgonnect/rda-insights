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

// Hoisted OpenAI (OpenRouter) mock — returns an async iterable by default
const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(async () =>
    (async function* () {
      yield { id: "gen-test", choices: [{ delta: { content: "Análise." } }] };
      yield {
        id: "gen-test",
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      };
    })()
  ),
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

function mockMcp(rows: Record<string, unknown>[] = [{ a: 1, b: "x" }, { a: 2, b: "y" }, { a: 3, b: "z" }]) {
  server.use(
    http.post("http://localhost:5008/mcp", async ({ request }) => {
      const body = (await request.json()) as { params: { name: string } };
      const map: Record<string, unknown> = {
        get_chart: { slice_name: "X", viz_type: "table", datasource_id: 1, params: {} },
        get_dataset_columns: [
          { column_name: "a", type: "INT" },
          { column_name: "b", type: "VARCHAR" },
        ],
        get_chart_data: { columns: ["a", "b"], rows },
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

describe("POST /api/insights/row", () => {
  it("streams insight on happy path", async () => {
    mockMcp();
    const { POST } = await import("@/app/api/insights/row/route");
    const req = new Request("http://x/api/insights/row", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      body: JSON.stringify({ chart_id: 42, filter_values: { a: 1 } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await readSseBody(res);
    expect(body).toContain("Análise.");
    expect(body).toContain("event: done");
  });

  it("returns 400 on invalid body (missing chart_id)", async () => {
    mockMcp();
    const { POST } = await import("@/app/api/insights/row/route");
    const req = new Request("http://x/api/insights/row", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.2" },
      body: JSON.stringify({ filter_values: { a: 1 } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("short-circuits when no rows match the filter_values", async () => {
    mockMcp();
    const { POST } = await import("@/app/api/insights/row/route");
    const req = new Request("http://x/api/insights/row", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.3" },
      body: JSON.stringify({ chart_id: 42, filter_values: { a: 999 } }),
    });
    const res = await POST(req);
    const body = await readSseBody(res);
    expect(body).toContain("Não encontrei linhas");
  });
});
