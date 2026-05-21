import { describe, it, expect, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

import { streamInsight } from "@/lib/llm";

describe("streamInsight (OpenRouter via OpenAI SDK)", () => {
  it("yields text chunks and final usage with generation_id", async () => {
    async function* fakeStream() {
      yield { id: "gen-abc123", choices: [{ delta: { content: "Padrão" } }] };
      yield { id: "gen-abc123", choices: [{ delta: { content: " principal." } }] };
      yield {
        id: "gen-abc123",
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 1200, completion_tokens: 50 },
      };
    }
    createMock.mockResolvedValue(fakeStream());

    const chunks: string[] = [];
    let usage: { input_tokens: number; output_tokens: number } | null = null;
    let generationId: string | undefined;
    for await (const ev of streamInsight({ system: "s", user: "u" })) {
      if (ev.type === "delta") chunks.push(ev.text);
      if (ev.type === "done") {
        usage = ev.usage;
        generationId = ev.generation_id;
      }
    }
    expect(chunks.join("")).toBe("Padrão principal.");
    expect(usage).toEqual({ input_tokens: 1200, output_tokens: 50 });
    expect(generationId).toBe("gen-abc123");
  });
});
