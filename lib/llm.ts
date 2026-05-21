import OpenAI from "openai";
import { env } from "./env";

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/rafaelgonnect/rda-insights",
    "X-Title": "RDA Insights",
  },
});

export type LlmEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      usage: { input_tokens: number; output_tokens: number };
      generation_id?: string;
    };

export async function* streamInsight(
  prompt: { system: string; user: string },
  opts: { signal?: AbortSignal; maxTokens?: number; model?: string } = {}
): AsyncGenerator<LlmEvent> {
  const stream = await client.chat.completions.create(
    {
      model: opts.model ?? env.OPENROUTER_MODEL,
      max_tokens: opts.maxTokens ?? 600,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    },
    { signal: opts.signal }
  );

  let usage = { input_tokens: 0, output_tokens: 0 };
  let generationId: string | undefined;

  for await (const chunk of stream as AsyncIterable<{
    id?: string;
    choices?: { delta?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>) {
    if (chunk.id && !generationId) generationId = chunk.id;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      yield { type: "delta", text: delta };
    }
    if (chunk.usage) {
      usage = {
        input_tokens: chunk.usage.prompt_tokens ?? usage.input_tokens,
        output_tokens: chunk.usage.completion_tokens ?? usage.output_tokens,
      };
    }
  }

  yield { type: "done", usage, generation_id: generationId };
}
