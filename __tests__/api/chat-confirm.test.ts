/**
 * Tests for POST /api/chat/confirm (Fase 4 write-tool confirmation endpoint).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { _reset } from "@/lib/rate-limit";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => _reset());

// ─── Redis mock ───────────────────────────────────────────────────────────────

const { redisStore } = vi.hoisted(() => ({ redisStore: new Map<string, string>() }));
vi.mock("ioredis", () => {
  function MockRedis() {
    return {
      async get(k: string) { return redisStore.get(k) ?? null; },
      async set(k: string, v: string) { redisStore.set(k, v); return "OK"; },
      async setex(k: string, _ttl: number, v: string) { redisStore.set(k, v); return "OK"; },
      async del(...keys: string[]) {
        let c = 0;
        for (const k of keys) { if (redisStore.delete(k)) c++; }
        return c;
      },
      async incrbyfloat(k: string, n: number) {
        const cur = parseFloat(redisStore.get(k) ?? "0");
        redisStore.set(k, String(cur + n));
        return String(cur + n);
      },
      async ping() { return "PONG"; },
      quit() {},
    };
  }
  return { default: MockRedis };
});
beforeEach(() => redisStore.clear());

// ─── OpenAI mock ──────────────────────────────────────────────────────────────

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

async function* textStream(text: string) {
  yield { id: "gen-1", choices: [{ delta: { content: text }, finish_reason: null }] };
  yield {
    id: "gen-1",
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 50, completion_tokens: 20 },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function parseEvents(body: string) {
  const events: { event?: string; data: string }[] = [];
  const blocks = body.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    let event: string | undefined;
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7);
      if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (data) events.push({ event, data });
  }
  return events;
}

/** Seed a PendingToolCall into the mock Redis store. */
async function seedPending(id: string) {
  const { savePendingToolCall } = await import("@/lib/cache");
  await savePendingToolCall({
    id,
    createdAt: Date.now(),
    messages: [
      { role: "user", content: "Cria um gráfico" },
      {
        role: "assistant",
        content: "Vou criar o gráfico.",
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "create_simple_chart", arguments: '{"slice_name":"T","dataset_id":1,"chart_type":"bar","x_axis":"m"}' },
        }],
      },
    ],
    toolCallId: "call-1",
    toolName: "create_simple_chart",
    toolArgs: { slice_name: "T", dataset_id: 1, chart_type: "bar", x_axis: "m" },
    dashboardId: 1,
  });
}

function mockAuth() {
  server.use(
    http.post("http://localhost:8088/api/v1/security/login", () =>
      HttpResponse.json({ access_token: "tok" })
    ),
    http.get("http://localhost:8088/api/v1/security/csrf_token", () =>
      HttpResponse.json({ result: "csrf" })
    )
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/chat/confirm", () => {
  it("returns 404 when pending_id is unknown", async () => {
    const { POST } = await import("@/app/api/chat/confirm/route");
    const req = new Request("http://x/api/chat/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify({ pending_id: "does-not-exist", decision: "apply" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("@/app/api/chat/confirm/route");
    const req = new Request("http://x/api/chat/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.5" },
      body: JSON.stringify({ pending_id: "x", decision: "maybe" }), // invalid enum
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("cancel decision streams SSE continuation with done event", async () => {
    mockAuth();
    createMock.mockImplementation(() => Promise.resolve(textStream("Ação cancelada pelo usuário.")));

    await seedPending("cancel-test-id");

    const { POST } = await import("@/app/api/chat/confirm/route");
    const req = new Request("http://x/api/chat/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.6" },
      body: JSON.stringify({ pending_id: "cancel-test-id", decision: "cancel" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await readSseBody(res);
    const events = parseEvents(body);

    const deltas = events.filter((e) => !e.event);
    expect(deltas.some((e) => e.data.includes("cancelada"))).toBe(true);

    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
  });

  it("apply decision calls the tool handler and streams continuation", async () => {
    mockAuth();
    createMock.mockImplementation(() => Promise.resolve(textStream("Gráfico criado!")));

    // Mock the Superset chart POST endpoint
    server.use(
      http.post("http://localhost:8088/api/v1/chart/", () =>
        HttpResponse.json({ id: 42, result: { slice_name: "T" } })
      )
    );

    await seedPending("apply-test-id");

    const { POST } = await import("@/app/api/chat/confirm/route");
    const req = new Request("http://x/api/chat/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.7" },
      body: JSON.stringify({ pending_id: "apply-test-id", decision: "apply" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await readSseBody(res);
    const events = parseEvents(body);

    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();

    const deltas = events.filter((e) => !e.event);
    expect(deltas.some((e) => e.data.includes("Gráfico"))).toBe(true);
  });

  it("pending record is deleted after processing (cannot replay)", async () => {
    mockAuth();
    createMock.mockImplementation(() => Promise.resolve(textStream("ok")));
    server.use(
      http.post("http://localhost:8088/api/v1/chart/", () =>
        HttpResponse.json({ id: 1, result: { slice_name: "T" } })
      )
    );

    await seedPending("one-shot-id");

    const { POST } = await import("@/app/api/chat/confirm/route");
    const makeReq = () =>
      new Request("http://x/api/chat/confirm", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.8" },
        body: JSON.stringify({ pending_id: "one-shot-id", decision: "apply" }),
      });

    // First call succeeds
    const res1 = await POST(makeReq());
    await readSseBody(res1); // drain
    expect(res1.status).toBe(200);

    // Second call with same id → 404 (deleted)
    const res2 = await POST(makeReq());
    expect(res2.status).toBe(404);
  });
});
