import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { _reset } from "@/lib/rate-limit";

// ─── Shared mock infrastructure ───────────────────────────────────────────────

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => _reset());

// Redis mock
const { redisStore } = vi.hoisted(() => ({ redisStore: new Map<string, string>() }));
vi.mock("ioredis", () => {
  function MockRedis() {
    return {
      async get(k: string) { return redisStore.get(k) ?? null; },
      async set(k: string, v: string) { redisStore.set(k, v); return "OK"; },
      async setex(k: string, _ttl: number, v: string) { redisStore.set(k, v); return "OK"; },
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

// ─── OpenAI mock helpers ──────────────────────────────────────────────────────

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

/**
 * Build an async generator that simulates a simple text-only stream.
 */
async function* textOnlyStream(text: string) {
  yield { id: "gen-1", choices: [{ delta: { content: text }, finish_reason: null }] };
  yield {
    id: "gen-1",
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 50, completion_tokens: 20 },
  };
}

/**
 * Build an async generator that simulates one tool_call followed by an
 * assistant response.
 */
async function* toolCallStream() {
  // First stream: LLM requests a tool
  yield {
    id: "gen-2",
    choices: [
      {
        delta: {
          content: "Vou listar os dashboards.\n",
          tool_calls: undefined,
        },
        finish_reason: null,
      },
    ],
  };
  yield {
    id: "gen-2",
    choices: [
      {
        delta: {
          content: null,
          tool_calls: [{ index: 0, id: "call-abc", function: { name: "list_dash", arguments: '{"' } }],
        },
        finish_reason: null,
      },
    ],
  };
  yield {
    id: "gen-2",
    choices: [
      {
        delta: {
          content: null,
          tool_calls: [{ index: 0, id: undefined, function: { name: "", arguments: '}' } }],
        },
        finish_reason: null,
      },
    ],
  };
  yield {
    id: "gen-2",
    choices: [{ delta: {}, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 80, completion_tokens: 30 },
  };
}

async function* afterToolStream() {
  yield { id: "gen-3", choices: [{ delta: { content: "Encontrei 2 dashboards." }, finish_reason: null }] };
  yield {
    id: "gen-3",
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 15 },
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

function parseEvents(body: string): { event?: string; data: string }[] {
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

// Minimal Superset auth mock
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

describe("POST /api/chat", () => {
  it("returns 200 with text/event-stream content-type", async () => {
    mockAuth();
    createMock.mockImplementation(() => Promise.resolve(textOnlyStream("Olá!")));

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://x/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify({ message: "oi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("streams a delta event and a done event", async () => {
    mockAuth();
    createMock.mockImplementation(() => Promise.resolve(textOnlyStream("Tudo bem!")));

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://x/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.5" },
      body: JSON.stringify({ message: "como vai?" }),
    });
    const res = await POST(req);
    const body = await readSseBody(res);
    const events = parseEvents(body);

    const deltas = events.filter((e) => !e.event);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[0].data).toContain("Tudo bem!");

    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    const doneData = JSON.parse(done!.data);
    expect(doneData).toHaveProperty("usage");
    expect(doneData).toHaveProperty("model");
  });

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://x/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.6" },
      body: JSON.stringify({ message: "" }), // empty string fails min(1)
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 429 after rate limit", async () => {
    mockAuth();
    createMock.mockImplementation(() => Promise.resolve(textOnlyStream("ok")));

    const { POST } = await import("@/app/api/chat/route");
    // Exhaust 30 requests
    for (let i = 0; i < 30; i++) {
      const r = await POST(
        new Request("http://x/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
          body: JSON.stringify({ message: "test" }),
        })
      );
      await readSseBody(r);
    }
    const r31 = await POST(
      new Request("http://x/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
        body: JSON.stringify({ message: "test" }),
      })
    );
    expect(r31.status).toBe(429);
  });

  it("emits tool_call_start + tool_call_end events when LLM calls a tool", async () => {
    mockAuth();

    // First call → tool call stream; second call → final answer
    let callCount = 0;
    createMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(toolCallStream());
      return Promise.resolve(afterToolStream());
    });

    // Mock the tool itself — list_dashboards via McpClient
    server.use(
      http.get("http://localhost:8088/api/v1/dashboard/", () =>
        HttpResponse.json({
          result: [
            { id: 1, dashboard_title: "Sales", thumbnail_url: null },
            { id: 2, dashboard_title: "Finance", thumbnail_url: null },
          ],
        })
      )
    );

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://x/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "2.3.4.5" },
      body: JSON.stringify({ message: "liste os dashboards" }),
    });
    const res = await POST(req);
    const body = await readSseBody(res);
    const events = parseEvents(body);

    const toolStart = events.find((e) => e.event === "tool_call_start");
    expect(toolStart).toBeDefined();

    const toolEnd = events.find((e) => e.event === "tool_call_end");
    expect(toolEnd).toBeDefined();
    if (toolEnd) {
      const d = JSON.parse(toolEnd.data);
      expect(d).toHaveProperty("id");
      expect(d).toHaveProperty("durationMs");
    }

    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
  });
});
