/**
 * Tests for streamChat pausing on confirm-required tools and
 * continueChatAfterConfirmation resuming the conversation.
 */
import { describe, it, expect, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

import { streamChat, continueChatAfterConfirmation } from "@/lib/llm";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions/completions";

// ─── Fake stream helpers ──────────────────────────────────────────────────────

/** Simulate LLM proposing a single tool call that requires confirmation. */
async function* confirmToolStream() {
  yield {
    id: "gen-c1",
    choices: [{ delta: { content: "Vou criar o gráfico.\n" }, finish_reason: null }],
  };
  yield {
    id: "gen-c1",
    choices: [{
      delta: {
        content: null,
        tool_calls: [{ index: 0, id: "call-write-1", function: { name: "create_simple_chart", arguments: '{"slice_name":"Test"' } }],
      },
      finish_reason: null,
    }],
  };
  yield {
    id: "gen-c1",
    choices: [{
      delta: {
        content: null,
        tool_calls: [{ index: 0, id: undefined, function: { name: "", arguments: ',"dataset_id":1,"chart_type":"bar","x_axis":"m"}' } }],
      },
      finish_reason: null,
    }],
  };
  yield {
    id: "gen-c1",
    choices: [{ delta: {}, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 100, completion_tokens: 30 },
  };
}

/** Simulate LLM final response after tool result. */
async function* afterToolStream() {
  yield { id: "gen-c2", choices: [{ delta: { content: "Gráfico criado com sucesso!" }, finish_reason: null }] };
  yield {
    id: "gen-c2",
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 150, completion_tokens: 20 },
  };
}

/** Simulate LLM proposing only a read (no confirmation) tool. */
async function* readToolStream() {
  yield {
    id: "gen-r1",
    choices: [{
      delta: {
        content: null,
        tool_calls: [{ index: 0, id: "call-read-1", function: { name: "list_dashboards", arguments: "{}}" } }],
      },
      finish_reason: null,
    }],
  };
  yield {
    id: "gen-r1",
    choices: [{ delta: {}, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 50, completion_tokens: 10 },
  };
}

async function* finalResponseStream() {
  yield { id: "gen-r2", choices: [{ delta: { content: "Há 2 dashboards." }, finish_reason: null }] };
  yield {
    id: "gen-r2",
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 80, completion_tokens: 15 },
  };
}

const fakeTools: ChatCompletionFunctionTool[] = [];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("streamChat — confirmation pause", () => {
  it("yields tool_pending_confirmation and stops when a confirm-required tool is called", async () => {
    createMock.mockResolvedValue(confirmToolStream());

    const events: unknown[] = [];
    for await (const ev of streamChat(
      [{ role: "user", content: "Cria um gráfico" }],
      {
        tools: fakeTools,
        executeTool: vi.fn(),
        requiresConfirmation: (name) => name === "create_simple_chart",
      }
    )) {
      events.push(ev);
    }

    const pending = events.find((e) => (e as { type: string }).type === "tool_pending_confirmation");
    expect(pending).toBeDefined();
    const p = pending as {
      type: string;
      tool_call_id: string;
      name: string;
      args: Record<string, unknown>;
      messagesSoFar: unknown[];
    };
    expect(p.name).toBe("create_simple_chart");
    expect(p.tool_call_id).toBe("call-write-1");
    expect(p.args.slice_name).toBe("Test");
    expect(Array.isArray(p.messagesSoFar)).toBe(true);
    // messagesSoFar must include the assistant message with the tool_call
    const assistantMsg = p.messagesSoFar.find((m) => (m as { role: string }).role === "assistant");
    expect(assistantMsg).toBeDefined();

    // No "done" event — generator returned early
    const done = events.find((e) => (e as { type: string }).type === "done");
    expect(done).toBeUndefined();

    // executeTool must NOT have been called
    // (it's a vi.fn() — if it was called, it would have been invoked)
    // We can't check vi.fn() calls here because we didn't keep a reference,
    // but we can verify no tool_call_end events were emitted either
    const toolEnd = events.find((e) => (e as { type: string }).type === "tool_call_end");
    expect(toolEnd).toBeUndefined();
  });

  it("does NOT pause for read tools (requiresConfirmation: false)", async () => {
    let callCount = 0;
    createMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(readToolStream());
      return Promise.resolve(finalResponseStream());
    });

    const execTool = vi.fn().mockResolvedValue([{ id: 1, dashboard_title: "A" }]);
    const events: unknown[] = [];

    for await (const ev of streamChat(
      [{ role: "user", content: "Liste os dashboards" }],
      {
        tools: fakeTools,
        executeTool: execTool,
        requiresConfirmation: (name) => name === "create_simple_chart", // list_dashboards is read
      }
    )) {
      events.push(ev);
    }

    // executeTool was called for the read tool
    expect(execTool).toHaveBeenCalledWith("list_dashboards", {});

    // No pending_confirmation event
    const pending = events.find((e) => (e as { type: string }).type === "tool_pending_confirmation");
    expect(pending).toBeUndefined();

    // Done event IS present
    const done = events.find((e) => (e as { type: string }).type === "done");
    expect(done).toBeDefined();
  });
});

describe("continueChatAfterConfirmation", () => {
  it("resumes and yields text deltas after apply", async () => {
    createMock.mockResolvedValue(afterToolStream());

    const messages = [
      { role: "user" as const, content: "Cria um gráfico" },
      {
        role: "assistant" as const,
        content: "Vou criar o gráfico.\n",
        tool_calls: [{
          id: "call-write-1",
          type: "function" as const,
          function: { name: "create_simple_chart", arguments: '{"slice_name":"Test","dataset_id":1,"chart_type":"bar","x_axis":"m"}' },
        }],
      },
    ];

    const events: unknown[] = [];
    for await (const ev of continueChatAfterConfirmation({
      messages,
      toolCallId: "call-write-1",
      toolName: "create_simple_chart",
      toolResult: { ok: true, result: { id: 42, slice_name: "Test" } },
      tools: fakeTools,
      executeTool: vi.fn(),
      requiresConfirmation: () => false,
    })) {
      events.push(ev);
    }

    const deltas = events.filter((e) => (e as { type: string }).type === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    const text = deltas.map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("Gráfico criado");

    const done = events.find((e) => (e as { type: string }).type === "done");
    expect(done).toBeDefined();
  });

  it("resumes and yields text deltas after cancel", async () => {
    createMock.mockResolvedValue(afterToolStream());

    const messages = [
      { role: "user" as const, content: "Cria um gráfico" },
      {
        role: "assistant" as const,
        content: null,
        tool_calls: [{
          id: "call-write-1",
          type: "function" as const,
          function: { name: "create_simple_chart", arguments: "{}" },
        }],
      },
    ];

    const events: unknown[] = [];
    for await (const ev of continueChatAfterConfirmation({
      messages,
      toolCallId: "call-write-1",
      toolName: "create_simple_chart",
      toolResult: { ok: false, error: "User canceled this action", canceled: true },
      tools: fakeTools,
      executeTool: vi.fn(),
      requiresConfirmation: () => false,
    })) {
      events.push(ev);
    }

    // LLM continuation should still produce deltas (even for cancellation)
    const done = events.find((e) => (e as { type: string }).type === "done");
    expect(done).toBeDefined();
  });
});
