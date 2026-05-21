import { z } from "zod";
import { McpClient } from "@/lib/mcp";
import { streamInsight } from "@/lib/llm";
import { buildRowExplainPrompt } from "@/lib/prompts/insights";
import { rowInsightKey } from "@/lib/cache-keys";
import { getCached, setCached, incrCost, getMonthlyCost, currentMonthKey } from "@/lib/cache";
import { calculateCost } from "@/lib/cost";
import { checkRateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { sseStream } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SEC = 3600;
const PEER_LIMIT = 10;

const Body = z.object({
  chart_id: z.number().int().positive(),
  filter_values: z.record(z.string(), z.unknown()),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid body" }), { status: 400 });
  }
  const { chart_id, filter_values } = parsed.data;

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

  const cacheKey = rowInsightKey(chart_id, filter_values);

  return sseStream(async function* () {
    const t0 = Date.now();
    const cached = await getCached(cacheKey);
    if (cached) {
      yield { data: JSON.stringify({ text: cached }) };
      yield { event: "done", data: JSON.stringify({ cache_hit: true }) };
      console.log(
        JSON.stringify({ event: "insight.cached", route: "row", chart_id, latency_ms: Date.now() - t0 })
      );
      return;
    }

    const mcp = new McpClient();
    const tMcp0 = Date.now();
    const chart = await mcp.getChart(chart_id);
    const columns = await mcp.getDatasetColumns(chart.datasource_id);
    const all = await mcp.getChartData(chart_id);
    const latencyMcp = Date.now() - tMcp0;

    const matchesAll = (row: Record<string, unknown>) =>
      Object.entries(filter_values).every(([k, v]) => row[k] === v);
    const selected = (all.rows ?? []).filter(matchesAll);
    const peers = (all.rows ?? []).filter((r) => !matchesAll(r)).slice(0, PEER_LIMIT);

    if (selected.length === 0) {
      const msg = "Não encontrei linhas que combinem com essa seleção no resultado atual.";
      yield { data: JSON.stringify({ text: msg }) };
      yield { event: "done", data: JSON.stringify({ empty: true }) };
      console.log(
        JSON.stringify({ event: "insight.empty", route: "row", chart_id, latency_mcp_ms: latencyMcp })
      );
      return;
    }

    const prompt = buildRowExplainPrompt({
      slice_name: chart.slice_name,
      viz_type: chart.viz_type,
      columns: columns.map((c) => ({ name: c.column_name, type: c.type })),
      filter_values,
      selected,
      peers,
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
        route: "row",
        chart_id,
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
