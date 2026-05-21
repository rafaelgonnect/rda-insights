import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamPostSse, streamPost } from "@/lib/sse-client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSseBody(blocks: { event?: string; data: string }[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = blocks
    .map((b) => {
      let s = "";
      if (b.event) s += `event: ${b.event}\n`;
      s += `data: ${b.data}\n\n`;
      return s;
    })
    .join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockFetch(body: ReadableStream, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => "error body",
    body,
  })) as unknown as typeof fetch;
}

// ─── streamPostSse ────────────────────────────────────────────────────────────

describe("streamPostSse", () => {
  it("forwards default (no event:) blocks as empty string event", async () => {
    const body = makeSseBody([{ data: JSON.stringify({ text: "hello" }) }]);
    const events: { event: string; data: unknown }[] = [];
    globalThis.fetch = mockFetch(body);

    await streamPostSse({
      url: "/api/chat",
      body: {},
      onEvent(event, data) {
        events.push({ event, data });
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("");
    expect(events[0].data).toEqual({ text: "hello" });
  });

  it("forwards named events with correct event type", async () => {
    const body = makeSseBody([
      { event: "tool_call_start", data: JSON.stringify({ id: "tc1", name: "get_chart", args: {} }) },
      { event: "tool_call_end", data: JSON.stringify({ id: "tc1", ok: true, durationMs: 42 }) },
      { event: "done", data: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 }, cost_usd: 0.001 }) },
    ]);
    const events: { event: string; data: unknown }[] = [];
    globalThis.fetch = mockFetch(body);

    await streamPostSse({ url: "/api/chat", body: {}, onEvent: (e, d) => events.push({ event: e, data: d }) });

    expect(events.map((e) => e.event)).toEqual(["tool_call_start", "tool_call_end", "done"]);
    expect((events[0].data as Record<string, unknown>).name).toBe("get_chart");
    expect((events[1].data as Record<string, unknown>).durationMs).toBe(42);
  });

  it("throws on HTTP error status", async () => {
    const body = makeSseBody([]);
    globalThis.fetch = mockFetch(body, 500);

    await expect(
      streamPostSse({ url: "/api/chat", body: {}, onEvent: () => {} })
    ).rejects.toThrow("HTTP 500");
  });

  it("throws on error event", async () => {
    const body = makeSseBody([{ event: "error", data: JSON.stringify({ message: "boom" }) }]);
    globalThis.fetch = mockFetch(body);

    await expect(
      streamPostSse({ url: "/api/chat", body: {}, onEvent: () => {} })
    ).rejects.toThrow("boom");
  });

  it("calls onClose when stream ends", async () => {
    const body = makeSseBody([{ data: JSON.stringify({ text: "x" }) }]);
    globalThis.fetch = mockFetch(body);
    const onClose = vi.fn();

    await streamPostSse({ url: "/api/chat", body: {}, onEvent: () => {}, onClose });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose even if error is thrown", async () => {
    const body = makeSseBody([{ event: "error", data: JSON.stringify({ message: "oops" }) }]);
    globalThis.fetch = mockFetch(body);
    const onClose = vi.fn();

    await expect(
      streamPostSse({ url: "/api/chat", body: {}, onEvent: () => {}, onClose })
    ).rejects.toThrow("oops");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ─── streamPost (legacy wrapper) ──────────────────────────────────────────────

describe("streamPost (legacy wrapper)", () => {
  it("calls onDelta for default blocks with text field", async () => {
    const body = makeSseBody([
      { data: JSON.stringify({ text: "hello " }) },
      { data: JSON.stringify({ text: "world" }) },
    ]);
    globalThis.fetch = mockFetch(body);
    const collected: string[] = [];

    await streamPost("/api/chat", {}, (t) => collected.push(t));
    expect(collected).toEqual(["hello ", "world"]);
  });

  it("calls onDone for done events", async () => {
    const meta = { usage: { input_tokens: 5, output_tokens: 3 } };
    const body = makeSseBody([{ event: "done", data: JSON.stringify(meta) }]);
    globalThis.fetch = mockFetch(body);
    let donePayload: unknown = null;

    await streamPost("/api/chat", {}, () => {}, (m) => { donePayload = m; });
    expect(donePayload).toEqual(meta);
  });
});

// ─── humanizeTool ─────────────────────────────────────────────────────────────

describe("humanizeTool", () => {
  it("returns human label for known tools", async () => {
    const { humanizeTool } = await import("@/components/ChatMessage");
    expect(humanizeTool("get_chart_data")).toBe("buscando dados do gráfico");
    expect(humanizeTool("list_dashboards")).toBe("listando dashboards");
  });

  it("falls back to tool name for unknown tools", async () => {
    const { humanizeTool } = await import("@/components/ChatMessage");
    expect(humanizeTool("some_unknown_tool")).toBe("some_unknown_tool");
  });
});
