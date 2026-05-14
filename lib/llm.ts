import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export type LlmEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage: { input_tokens: number; output_tokens: number } };

export async function* streamInsight(
  prompt: { system: string; user: string },
  opts: { signal?: AbortSignal; maxTokens?: number } = {}
): AsyncGenerator<LlmEvent> {
  const stream = client.messages.stream(
    {
      model: env.ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 600,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    },
    { signal: opts.signal }
  );
  let usage = { input_tokens: 0, output_tokens: 0 };
  for await (const ev of stream as AsyncIterable<{
    type: string;
    delta?: { type: string; text?: string };
    usage?: { input_tokens?: number; output_tokens?: number };
  }>) {
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
      yield { type: "delta", text: ev.delta.text };
    }
    if (ev.type === "message_delta" && ev.usage) {
      usage = {
        input_tokens: ev.usage.input_tokens ?? usage.input_tokens,
        output_tokens: ev.usage.output_tokens ?? usage.output_tokens,
      };
    }
  }
  yield { type: "done", usage };
}
