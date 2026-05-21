import { McpClient } from "@/lib/mcp";
import { streamInsight } from "@/lib/llm";
import { buildChartSummaryPrompt } from "@/lib/prompts/insights";
import { chartInsightKey } from "@/lib/cache-keys";
import { getCached, setCached, incrCost, getMonthlyCost, currentMonthKey } from "@/lib/cache";
import { calculateCost } from "@/lib/cost";
import { checkRateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { sseStream } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SEC = 3600;
const DATA_ROW_LIMIT = 100;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const chartId = Number(id);
  if (!Number.isInteger(chartId) || chartId <= 0) {
    return new Response(JSON.stringify({ error: "Invalid id" }), { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit", retry_after: rl.retryAfterSec }), {
      status: 429,
      headers: { "retry-after": String(rl.retryAfterSec ?? 60) },
    });
  }

  const month = currentMonthKey();
  if ((await getMonthlyCost(month)) >= env.MAX_USD_MONTH) {
    return new Response(JSON.stringify({ error: "Monthly cost cap reached" }), { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { filters?: Record<string, unknown> };
  const filters = body.filters ?? {};
  const cacheKey = chartInsightKey(chartId, filters);

  return sseStream(async function* () {
    const t0 = Date.now();
    const cached = await getCached(cacheKey);
    if (cached) {
      yield { data: JSON.stringify({ text: cached }) };
      yield { event: "done", data: JSON.stringify({ cache_hit: true }) };
      console.log(JSON.stringify({ event: "insight.cached", chart_id: chartId, latency_ms: Date.now() - t0 }));
      return;
    }

    const mcp = new McpClient();
    const tMcp0 = Date.now();
    const chart = await mcp.getChart(chartId);
    const columns = await mcp.getDatasetColumns(chart.datasource_id);
    const data = await mcp.getChartData(chartId);
    const latencyMcp = Date.now() - tMcp0;

    if (!data.rows || data.rows.length === 0) {
      const msg = "Esse gráfico está sem dados pro filtro atual.";
      yield { data: JSON.stringify({ text: msg }) };
      yield { event: "done", data: JSON.stringify({ empty: true }) };
      console.log(JSON.stringify({ event: "insight.empty", chart_id: chartId, latency_mcp_ms: latencyMcp }));
      return;
    }

    const prompt = buildChartSummaryPrompt({
      slice_name: chart.slice_name,
      viz_type: chart.viz_type,
      columns: columns.map((c) => ({ name: c.column_name, type: c.type })),
      filters,
      data: data.rows.slice(0, DATA_ROW_LIMIT),
    });

    const tLlm0 = Date.now();
    let acc = "";
    let usage = { input_tokens: 0, output_tokens: 0 };
    for await (const ev of streamInsight(prompt)) {
      if (ev.type === "delta") {
        acc += ev.text;
        yield { data: JSON.stringify({ text: ev.text }) };
      } else if (ev.type === "done") {
        usage = ev.usage;
      }
    }
    const latencyLlm = Date.now() - tLlm0;

    await setCached(cacheKey, acc, CACHE_TTL_SEC);
    const costUsd = calculateCost(env.OPENROUTER_MODEL, usage.input_tokens, usage.output_tokens);
    await incrCost(month, costUsd);

    yield { event: "done", data: JSON.stringify({ cache_hit: false, usage, cost_usd: costUsd }) };
    console.log(
      JSON.stringify({
        event: "insight.generated",
        route: "chart",
        chart_id: chartId,
        latency_mcp_ms: latencyMcp,
        latency_llm_ms: latencyLlm,
        tokens_in: usage.input_tokens,
        tokens_out: usage.output_tokens,
        cost_usd: costUsd,
        cache_hit: false,
      })
    );
  });
}
