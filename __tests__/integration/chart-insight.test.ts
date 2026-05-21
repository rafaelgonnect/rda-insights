import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { _reset } from "@/lib/rate-limit";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => _reset());

const { redisStore } = vi.hoisted(() => ({ redisStore: new Map<string, string>() }));
vi.mock("ioredis", () => {
  function MockRedis() {
    return {
      async get(k: string) {
        return redisStore.get(k) ?? null;
      },
      async set(k: string, v: string) {
        redisStore.set(k, v);
        return "OK";
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
      yield { id: "gen-test", choices: [{ delta: { content: "Resumo." } }] };
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

function mockSuperset(rows: Record<string, unknown>[] = [{ a: 1 }]) {
  server.use(
    http.post("http://localhost:8088/api/v1/security/login", () =>
      HttpResponse.json({ access_token: "test-access-token" })
    ),
    http.get("http://localhost:8088/api/v1/security/csrf_token", () =>
      HttpResponse.json({ result: "test-csrf-token" })
    ),
    http.get("http://localhost:8088/api/v1/chart/42", () =>
      HttpResponse.json({
        result: {
          slice_name: "X",
          viz_type: "table",
          datasource_id: 1,
          params: JSON.stringify({}),
        },
      })
    ),
    http.get("http://localhost:8088/api/v1/dataset/1", () =>
      HttpResponse.json({
        result: { columns: [{ column_name: "a", type: "INT" }] },
      })
    ),
    http.get("http://localhost:8088/api/v1/chart/42/data", () =>
      HttpResponse.json({
        result: [{ colnames: ["a"], data: rows }],
      })
    ),
    http.get("http://localhost:8088/health", () => HttpResponse.json({ status: "ok" }))
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
    mockSuperset();
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
    mockSuperset();
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
      await readSseBody(r);
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
    mockSuperset();
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
    mockSuperset([]);
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
