import { describe, it, expect } from "vitest";
import { buildChartSummaryPrompt, buildRowExplainPrompt } from "@/lib/prompts/insights";

describe("prompt builders", () => {
  it("buildChartSummaryPrompt produces expected shape", () => {
    const out = buildChartSummaryPrompt({
      slice_name: "Vendas por região",
      viz_type: "echarts_timeseries_bar",
      columns: [
        { name: "regiao", type: "VARCHAR" },
        { name: "vendas", type: "NUMERIC" },
      ],
      filters: { ano: 2025 },
      data: [
        { regiao: "Sul", vendas: 1000 },
        { regiao: "Sudeste", vendas: 2500 },
      ],
    });
    expect(out).toMatchSnapshot();
  });

  it("buildRowExplainPrompt produces expected shape", () => {
    const out = buildRowExplainPrompt({
      slice_name: "Vendas por região",
      viz_type: "echarts_timeseries_bar",
      columns: [
        { name: "regiao", type: "VARCHAR" },
        { name: "vendas", type: "NUMERIC" },
      ],
      filter_values: { regiao: "Sul" },
      selected: [{ regiao: "Sul", vendas: 1000 }],
      peers: [
        { regiao: "Sudeste", vendas: 2500 },
        { regiao: "Norte", vendas: 800 },
      ],
    });
    expect(out).toMatchSnapshot();
  });
});
