import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
} from "openai/resources/chat/completions/completions";
import { env } from "./env";

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/rafaelgonnect/rda-insights",
    "X-Title": "Colab Insights",
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

// ─── streamChat ───────────────────────────────────────────────────────────────

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call_start"; tool_call_id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_call_end"; tool_call_id: string; ok: boolean; durationMs: number; resultPreview?: string }
  | {
      type: "tool_pending_confirmation";
      tool_call_id: string;
      name: string;
      args: Record<string, unknown>;
      /** Conversation history INCLUDING the assistant message with the tool_call.
       *  The controller persists this so it can resume after confirmation. */
      messagesSoFar: ChatCompletionMessageParam[];
    }
  | { type: "done"; usage: { input_tokens: number; output_tokens: number }; generation_id?: string };

// ─── Shared iteration loop ────────────────────────────────────────────────────
//
// Both streamChat and continueChatAfterConfirmation share this helper to avoid
// duplication. Mutates `msgs` in-place (append assistant + tool result msgs).
//
// Decision on multiple tool_calls in one turn: if ANY call in the turn requires
// confirmation, we pause on the FIRST one and skip the rest. This is simpler
// than executing some and pausing on others, avoids partial side-effects, and
// gives the user a clean "one action at a time" confirmation experience.

async function* _runIterationLoop(
  msgs: ChatCompletionMessageParam[],
  opts: {
    tools?: ChatCompletionFunctionTool[];
    executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    requiresConfirmation: (name: string) => boolean;
    signal?: AbortSignal;
    maxTokens: number;
    model: string;
    maxIterations: number;
  },
  totalUsageRef: { input_tokens: number; output_tokens: number },
  generationIdRef: { value: string | undefined }
): AsyncGenerator<ChatEvent> {
  const { tools, executeTool, requiresConfirmation, signal, maxTokens, model, maxIterations } = opts;

  for (let iter = 0; iter < maxIterations; iter++) {
    type RawChunk = {
      id?: string;
      choices?: {
        delta?: {
          content?: string | null;
          tool_calls?: {
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
        finish_reason?: string | null;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const stream = await client.chat.completions.create(
      {
        model,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: msgs,
        ...(tools && tools.length > 0 ? { tools } : {}),
      },
      { signal }
    );

    // Accumulate tool_calls across stream chunks (OpenAI sends them fragmented)
    const toolCallsAcc: {
      id: string;
      name: string;
      argumentsRaw: string;
    }[] = [];

    let assistantTextAcc = "";
    let finishReason: string | null = null;

    for await (const chunk of stream as AsyncIterable<RawChunk>) {
      if (chunk.id && !generationIdRef.value) generationIdRef.value = chunk.id;

      const choice = chunk.choices?.[0];
      if (!choice) {
        if (chunk.usage) {
          totalUsageRef.input_tokens += chunk.usage.prompt_tokens ?? 0;
          totalUsageRef.output_tokens += chunk.usage.completion_tokens ?? 0;
        }
        continue;
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (!delta) continue;

      // Text content
      if (delta.content) {
        assistantTextAcc += delta.content;
        yield { type: "delta", text: delta.content };
      }

      // Tool call fragments
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          while (toolCallsAcc.length <= tc.index) {
            toolCallsAcc.push({ id: "", name: "", argumentsRaw: "" });
          }
          const slot = toolCallsAcc[tc.index];
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.argumentsRaw += tc.function.arguments;
        }
      }

      if (chunk.usage) {
        totalUsageRef.input_tokens += chunk.usage.prompt_tokens ?? 0;
        totalUsageRef.output_tokens += chunk.usage.completion_tokens ?? 0;
      }
    }

    // If no tool calls, we're done
    if (toolCallsAcc.length === 0 || finishReason === "stop") {
      yield { type: "done", usage: { ...totalUsageRef }, generation_id: generationIdRef.value };
      return;
    }

    // Build the assistant message with tool_calls to append
    const assistantMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: "assistant",
      content: assistantTextAcc || null,
      tool_calls: toolCallsAcc.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.argumentsRaw },
      })),
    };
    msgs.push(assistantMsg);

    // Check if any tool call in this turn requires confirmation.
    // If so, pause on the FIRST one and return immediately (skip the rest).
    for (const tc of toolCallsAcc) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argumentsRaw || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      if (requiresConfirmation(tc.name)) {
        // Pause: yield the confirmation event with full conversation state.
        // The caller saves msgs to Redis and closes the stream.
        yield {
          type: "tool_pending_confirmation",
          tool_call_id: tc.id,
          name: tc.name,
          args,
          messagesSoFar: [...msgs],
        };
        return; // Generator ends here; continuation via continueChatAfterConfirmation
      }
    }

    // No confirmation needed — execute all tools in this turn
    for (const tc of toolCallsAcc) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argumentsRaw || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      yield { type: "tool_call_start", tool_call_id: tc.id, name: tc.name, args };

      const t0 = Date.now();
      let result: unknown;
      let ok = true;
      try {
        result = await executeTool(tc.name, args);
      } catch (e) {
        result = { error: String(e) };
        ok = false;
      }
      const durationMs = Date.now() - t0;
      const resultPreview = JSON.stringify(result).slice(0, 80);

      yield { type: "tool_call_end", tool_call_id: tc.id, ok, durationMs, resultPreview };

      msgs.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Loop guard hit
  yield {
    type: "delta",
    text: "\n\n_(limite de iterações atingido: muitas chamadas de ferramentas encadeadas)_",
  };
  yield { type: "done", usage: { ...totalUsageRef }, generation_id: generationIdRef.value };
}

/**
 * Multi-iteration streaming chat with tool-calling support.
 *
 * Loops until the LLM stops requesting tools OR maxIterations is reached.
 * Text deltas are yielded immediately so the UI sees streaming text.
 * Tool calls are fully buffered (OpenAI splits them across chunks) before
 * executing, then results are appended to the message list for the next round.
 *
 * When a tool with requiresConfirmation(name) === true is encountered, the
 * generator pauses: it yields a tool_pending_confirmation event (containing
 * the full conversation history at that point) and returns. The route handler
 * saves the state to Redis and the client resumes via continueChatAfterConfirmation.
 */
export async function* streamChat(
  messages: ChatCompletionMessageParam[],
  opts: {
    tools?: ChatCompletionFunctionTool[];
    executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    requiresConfirmation?: (name: string) => boolean;
    signal?: AbortSignal;
    maxTokens?: number;
    model?: string;
    maxIterations?: number;
  }
): AsyncGenerator<ChatEvent> {
  const {
    tools,
    executeTool,
    requiresConfirmation = () => false,
    signal,
    maxTokens = 1200,
    model = env.OPENROUTER_MODEL,
    maxIterations = 6,
  } = opts;

  const msgs = [...messages];
  const totalUsageRef = { input_tokens: 0, output_tokens: 0 };
  const generationIdRef = { value: undefined as string | undefined };

  yield* _runIterationLoop(msgs, { tools, executeTool, requiresConfirmation, signal, maxTokens, model, maxIterations }, totalUsageRef, generationIdRef);
}

/**
 * Resume the chat after a user confirmation decision.
 *
 * Receives the saved conversation state (from Redis), appends the tool result
 * (or cancellation), and continues the iteration loop with the same pause logic.
 */
export async function* continueChatAfterConfirmation(opts: {
  messages: ChatCompletionMessageParam[];
  toolCallId: string;
  toolName: string;
  toolResult: { ok: true; result: unknown } | { ok: false; error: string; canceled?: boolean };
  tools: ChatCompletionFunctionTool[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  requiresConfirmation: (name: string) => boolean;
  signal?: AbortSignal;
  model?: string;
  maxTokens?: number;
  maxIterations?: number;
}): AsyncGenerator<ChatEvent> {
  const {
    toolCallId,
    toolResult,
    tools,
    executeTool,
    requiresConfirmation,
    signal,
    model = env.OPENROUTER_MODEL,
    maxTokens = 1200,
    maxIterations = 6,
  } = opts;

  // Append the tool result message to the saved history
  const msgs = [...opts.messages];
  const toolContent = toolResult.ok
    ? JSON.stringify(toolResult.result)
    : JSON.stringify({ canceled: !!("canceled" in toolResult && toolResult.canceled), error: toolResult.error });

  msgs.push({
    role: "tool",
    tool_call_id: toolCallId,
    content: toolContent,
  });

  const totalUsageRef = { input_tokens: 0, output_tokens: 0 };
  const generationIdRef = { value: undefined as string | undefined };

  yield* _runIterationLoop(msgs, { tools, executeTool, requiresConfirmation, signal, maxTokens, model, maxIterations }, totalUsageRef, generationIdRef);
}
