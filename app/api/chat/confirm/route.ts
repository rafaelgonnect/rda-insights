import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import { McpClient } from "@/lib/mcp";
import { continueChatAfterConfirmation } from "@/lib/llm";
import { toolsForOpenAI, executeTool, getToolByName, ToolContext } from "@/lib/mcp-tools";
import {
  incrCost,
  getMonthlyCost,
  currentMonthKey,
  getPendingToolCall,
  deletePendingToolCall,
} from "@/lib/cache";
import { calculateCost } from "@/lib/cost";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { sseStream } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  pending_id: z.string().min(1),
  decision: z.enum(["apply", "cancel"]),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit", retry_after: rl.retryAfterSec }), {
      status: 429,
      headers: { "retry-after": String(rl.retryAfterSec ?? 60) },
    });
  }

  const settings = await getSettings();
  const month = currentMonthKey();
  if ((await getMonthlyCost(month)) >= settings.maxUsdMonth) {
    return new Response(JSON.stringify({ error: "Monthly cost cap reached" }), { status: 429 });
  }

  let body: z.infer<typeof Body>;
  try {
    const raw = await req.json();
    body = Body.parse(raw);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid request body", detail: String(e) }), {
      status: 400,
    });
  }

  const pending = await getPendingToolCall(body.pending_id);
  if (!pending) {
    return new Response(JSON.stringify({ error: "Pending tool call not found or expired" }), {
      status: 404,
    });
  }

  // Delete the pending record immediately so it can't be replayed
  await deletePendingToolCall(body.pending_id);

  const ctx: ToolContext = {
    mcp: new McpClient(),
    dashboardId: pending.dashboardId,
    filterContext: pending.filterContext,
  };

  const execTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const result = await executeTool(name, args, ctx);
    if (!result.ok) {
      return { error: result.error };
    }
    return result.result;
  };

  const tools = toolsForOpenAI();
  const requiresConfirmation = (name: string) => getToolByName(name)?.requiresConfirmation === true;

  return sseStream(async function* () {
    let toolResult: { ok: true; result: unknown } | { ok: false; error: string; canceled?: boolean };

    if (body.decision === "apply") {
      const r = await executeTool(pending.toolName, pending.toolArgs, ctx);
      if (r.ok) {
        toolResult = { ok: true, result: r.result };
      } else {
        toolResult = { ok: false, error: r.error };
      }
    } else {
      toolResult = { ok: false, error: "User canceled this action", canceled: true };
    }

    let usage = { input_tokens: 0, output_tokens: 0 };
    let generationId: string | undefined;

    for await (const ev of continueChatAfterConfirmation({
      messages: pending.messages as ChatCompletionMessageParam[],
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      toolResult,
      tools,
      executeTool: execTool,
      requiresConfirmation,
      maxTokens: settings.maxTokens,
      model: settings.model,
      maxIterations: 6,
    })) {
      if (ev.type === "delta") {
        yield { data: JSON.stringify({ text: ev.text }) };
      } else if (ev.type === "tool_call_start") {
        yield {
          event: "tool_call_start",
          data: JSON.stringify({ id: ev.tool_call_id, name: ev.name, args: ev.args }),
        };
      } else if (ev.type === "tool_call_end") {
        yield {
          event: "tool_call_end",
          data: JSON.stringify({
            id: ev.tool_call_id,
            ok: ev.ok,
            durationMs: ev.durationMs,
            resultPreview: ev.resultPreview,
          }),
        };
      } else if (ev.type === "tool_pending_confirmation") {
        // Another write tool requested — save state and pause again
        const { randomUUID } = await import("crypto");
        const nextPendingId = randomUUID();
        const { savePendingToolCall: save } = await import("@/lib/cache");
        await save({
          id: nextPendingId,
          createdAt: Date.now(),
          messages: ev.messagesSoFar,
          toolCallId: ev.tool_call_id,
          toolName: ev.name,
          toolArgs: ev.args,
          dashboardId: pending.dashboardId,
          filterContext: pending.filterContext,
        });
        yield {
          event: "tool_pending_confirmation",
          data: JSON.stringify({
            pending_id: nextPendingId,
            tool_call_id: ev.tool_call_id,
            name: ev.name,
            args: ev.args,
          }),
        };
        return;
      } else if (ev.type === "done") {
        usage = ev.usage;
        generationId = ev.generation_id;
      }
    }

    const costUsd = calculateCost(settings.model, usage.input_tokens, usage.output_tokens);
    await incrCost(month, costUsd);

    yield {
      event: "done",
      data: JSON.stringify({
        usage,
        cost_usd: costUsd,
        model: settings.model,
        generation_id: generationId,
      }),
    };

    console.log(
      JSON.stringify({
        event: "chat.confirm.generated",
        decision: body.decision,
        tool: pending.toolName,
        model: settings.model,
        tokens_in: usage.input_tokens,
        tokens_out: usage.output_tokens,
        cost_usd: costUsd,
      })
    );
  });
}
