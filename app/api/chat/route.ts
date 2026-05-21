import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import { McpClient } from "@/lib/mcp";
import { streamChat } from "@/lib/llm";
import { toolsForOpenAI, executeTool, ToolContext } from "@/lib/mcp-tools";
import { incrCost, getMonthlyCost, currentMonthKey } from "@/lib/cache";
import { calculateCost } from "@/lib/cost";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { sseStream } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().min(1).max(2000),
  dashboard_id: z.number().int().positive().optional(),
  filter_context: z.record(z.string(), z.unknown()).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .max(20)
    .optional()
    .default([]),
});

function buildSystemPrompt(dashboardId?: number, filterContext?: Record<string, unknown>): string {
  const dashLabel = dashboardId ? `#${dashboardId}` : "(nenhum dashboard ativo)";
  const filterLine =
    filterContext && Object.keys(filterContext).length > 0
      ? `\nFiltro ativo: ${JSON.stringify(filterContext)}`
      : "";

  return `Você é um analista de dados embarcado em um dashboard do Apache Superset.
O usuário está visualizando o dashboard ${dashLabel}.${filterLine}

Você tem acesso a um conjunto de tools para consultar dados, charts e datasets reais
do Superset. SEMPRE use as tools antes de fazer afirmações sobre dados; nunca invente
nomes de colunas, IDs ou números. Responda em português brasileiro, conciso e direto.
Use markdown leve (bullets, **negrito**) — sem títulos grandes (H1/H2). Quando for
chamar uma tool, escreva 1 linha curta explicando o que vai fazer antes de chamá-la.`;
}

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

  const { message, dashboard_id, filter_context, history } = body;

  return sseStream(async function* () {
    const systemPrompt = buildSystemPrompt(dashboard_id, filter_context);

    type HistoryMsg = { role: "user" | "assistant"; content: string };
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      ...history.map((h: HistoryMsg) => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    const ctx: ToolContext = {
      mcp: new McpClient(),
      dashboardId: dashboard_id,
      filterContext: filter_context,
    };

    const execTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const result = await executeTool(name, args, ctx);
      if (!result.ok) {
        // Return the error as a value so the LLM can self-correct
        return { error: result.error };
      }
      return result.result;
    };

    const tools = toolsForOpenAI();

    let usage = { input_tokens: 0, output_tokens: 0 };
    let generationId: string | undefined;

    for await (const ev of streamChat(
      messages as ChatCompletionMessageParam[],
      {
        tools,
        executeTool: execTool,
        maxTokens: settings.maxTokens,
        model: settings.model,
        maxIterations: 6,
      }
    )) {
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
        event: "chat.generated",
        model: settings.model,
        tokens_in: usage.input_tokens,
        tokens_out: usage.output_tokens,
        cost_usd: costUsd,
        dashboard_id: dashboard_id ?? null,
      })
    );
  });
}
