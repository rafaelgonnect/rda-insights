import { z } from "zod";
import { randomUUID } from "crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import { McpClient } from "@/lib/mcp";
import { streamChat } from "@/lib/llm";
import { toolsForOpenAI, executeTool, getToolByName, ToolContext } from "@/lib/mcp-tools";
import { incrCost, getMonthlyCost, currentMonthKey, savePendingToolCall } from "@/lib/cache";
import { calculateCost } from "@/lib/cost";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { sseStream } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().min(1).max(2000),
  mode: z.enum(["chat", "dev"]).optional().default("chat"),
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

function buildSystemPrompt(
  mode: "chat" | "dev",
  dashboardId?: number,
  filterContext?: Record<string, unknown>
): string {
  const dashLabel = dashboardId ? `#${dashboardId}` : "(nenhum dashboard ativo)";
  const filterLine =
    filterContext && Object.keys(filterContext).length > 0
      ? `\nFiltro ativo: ${JSON.stringify(filterContext)}`
      : "";

  if (mode === "dev") {
    return `Você é o Colab Insights em MODO DEV — um assistente que CRIA e ALTERA
dashboards, gráficos e datasets no Apache Superset. Dashboard em foco: ${dashLabel}.${filterLine}

Você tem tools de leitura E de escrita. TODA alteração (criar/editar/excluir chart,
dashboard, dataset, layout, SQL) passa por um card de confirmação Aplicar/Cancelar —
descreva claramente o que vai fazer ANTES de chamar a tool de escrita.

Fluxos:
• Criar do zero: find_datasets → get_dataset_columns/get_dataset_sample → proponha
  3-6 gráficos (nome, tipo, dimensões, métricas) → create_dashboard →
  create_simple_chart (um por gráfico) → attach_charts_to_dashboard →
  build_dashboard_layout (12 colunas, height em unidades de 100px).
• Alterar um dashboard existente: get_dashboard_charts/describe_chart para entender o
  estado atual, depois update_chart / create_simple_chart / attach_charts_to_dashboard /
  build_dashboard_layout conforme o pedido.

Regras: faça no MÁXIMO 1 pergunta clarificadora antes de agir. Nunca invente nomes de
colunas, IDs ou números — confirme via tool de leitura primeiro. Português brasileiro,
conciso, markdown leve (bullets, **negrito**) — sem títulos H1/H2.`;
  }

  return `Você é o Colab Insights em MODO BATE-PAPO — um analista de dados consultivo do
Apache Superset. Dashboard em foco: ${dashLabel}.${filterLine}

Seu papel é PLANEJAR, TIRAR DÚVIDAS e fazer BRAINSTORMING em cima dos dados reais. Você
NÃO altera nada — só tem tools de LEITURA (consultar dados, charts, datasets, amostras).
SEMPRE use as tools antes de afirmar algo sobre os dados; nunca invente nomes de colunas,
IDs ou números.

Quando o usuário quiser efetivamente CRIAR ou ALTERAR um dashboard/gráfico, ajude a
desenhar a proposta e sugira: "troque para o modo Dev (botão acima do campo) para eu
aplicar essas mudanças". Português brasileiro, conciso, markdown leve (bullets,
**negrito**) — sem títulos H1/H2. Antes de chamar uma tool, escreva 1 linha curta
explicando o que vai consultar.`;
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

  const { message, mode, dashboard_id, filter_context, history } = body;

  return sseStream(async function* () {
    const systemPrompt = buildSystemPrompt(mode, dashboard_id, filter_context);

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

    // Side events queue: emitted after tool_call_end for special tools
    const pendingSideEvents: { event: string; data: string }[] = [];

    const execTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const result = await executeTool(name, args, ctx);
      if (!result.ok) {
        return { error: result.error };
      }
      // Detect successful create_dashboard and queue side event
      if (
        name === "create_dashboard" &&
        result.result &&
        typeof result.result === "object" &&
        "id" in result.result
      ) {
        pendingSideEvents.push({
          event: "dashboard_created",
          data: JSON.stringify({
            id: (result.result as Record<string, unknown>).id,
            title: args.dashboard_title,
          }),
        });
      }
      return result.result;
    };

    // Bate-papo (chat) exposes READ tools only; Dev exposes read + write.
    const tools = toolsForOpenAI({ writable: mode === "dev" });

    const requiresConfirmation = (name: string) => getToolByName(name)?.requiresConfirmation === true;

    let usage = { input_tokens: 0, output_tokens: 0 };
    let generationId: string | undefined;
    let paused = false;

    for await (const ev of streamChat(
      messages as ChatCompletionMessageParam[],
      {
        tools,
        executeTool: execTool,
        requiresConfirmation,
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
        // Flush any pending side events immediately after tool_call_end
        while (pendingSideEvents.length > 0) {
          const sideEv = pendingSideEvents.shift()!;
          yield { event: sideEv.event, data: sideEv.data };
        }
      } else if (ev.type === "tool_pending_confirmation") {
        // Save the conversation state to Redis so the confirm endpoint can resume
        const pendingId = randomUUID();
        await savePendingToolCall({
          id: pendingId,
          createdAt: Date.now(),
          messages: ev.messagesSoFar,
          toolCallId: ev.tool_call_id,
          toolName: ev.name,
          toolArgs: ev.args,
          dashboardId: dashboard_id,
          filterContext: filter_context,
        });
        yield {
          event: "tool_pending_confirmation",
          data: JSON.stringify({
            pending_id: pendingId,
            tool_call_id: ev.tool_call_id,
            name: ev.name,
            args: ev.args,
          }),
        };
        paused = true;
        // Do NOT yield a done event here — the confirm endpoint will resume the conversation
        return;
      } else if (ev.type === "done") {
        usage = ev.usage;
        generationId = ev.generation_id;
      }
    }

    if (paused) return;

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
        mode,
        model: settings.model,
        tokens_in: usage.input_tokens,
        tokens_out: usage.output_tokens,
        cost_usd: costUsd,
        dashboard_id: dashboard_id ?? null,
      })
    );
  });
}
