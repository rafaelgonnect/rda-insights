import { describe, it, expect, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: createMock };
  },
}));

import { streamInsight } from "@/lib/llm";

describe("streamInsight", () => {
  it("yields text chunks and final usage", async () => {
    async function* fakeStream() {
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "Padrão" } };
      yield { type: "content_block_delta", delta: { type: "text_delta", text: " principal." } };
      yield {
        type: "message_delta",
        usage: { input_tokens: 1200, output_tokens: 50 },
      };
    }
    createMock.mockReturnValue(fakeStream());

    const chunks: string[] = [];
    let usage: { input_tokens: number; output_tokens: number } | null = null;
    for await (const ev of streamInsight({ system: "s", user: "u" })) {
      if (ev.type === "delta") chunks.push(ev.text);
      if (ev.type === "done") usage = ev.usage;
    }
    expect(chunks.join("")).toBe("Padrão principal.");
    expect(usage).toEqual({ input_tokens: 1200, output_tokens: 50 });
  });
});
