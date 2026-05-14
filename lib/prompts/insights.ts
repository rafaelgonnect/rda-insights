export type Column = { name: string; type: string };

export type ChartSummaryInput = {
  slice_name: string;
  viz_type: string;
  columns: Column[];
  filters: Record<string, unknown>;
  data: Record<string, unknown>[];
};

export type RowExplainInput = {
  slice_name: string;
  viz_type: string;
  columns: Column[];
  filter_values: Record<string, unknown>;
  selected: Record<string, unknown>[];
  peers: Record<string, unknown>[];
};

const SYSTEM_SUMMARY = `Você é um analista de dados sênior. Dada a configuração e o resultado de um gráfico Apache Superset, produza exatamente 3 bullets em português:
(1) **Padrão principal**: a tendência mais óbvia
(2) **Anomalia**: o ponto fora da curva mais relevante (se houver)
(3) **Hipótese**: causa plausível ou pergunta de follow-up
Seja conciso. Use números do dado. Nunca invente colunas ou valores.`;

const SYSTEM_ROW = `Você é um analista de dados sênior. Dada UMA seleção dentro de um gráfico Apache Superset e dados comparativos, explique por que essa seleção é notável (ou não), em português, em até 4 frases curtas. Compare com peers. Use números. Nunca invente colunas.`;

export function buildChartSummaryPrompt(i: ChartSummaryInput) {
  return {
    system: SYSTEM_SUMMARY,
    user: [
      `Chart: ${i.slice_name}`,
      `Viz type: ${i.viz_type}`,
      `Colunas: ${JSON.stringify(i.columns)}`,
      `Filtros aplicados: ${JSON.stringify(i.filters)}`,
      `Dados (top ${i.data.length} rows):`,
      JSON.stringify(i.data, null, 2),
    ].join("\n"),
  };
}

export function buildRowExplainPrompt(i: RowExplainInput) {
  return {
    system: SYSTEM_ROW,
    user: [
      `Chart: ${i.slice_name}`,
      `Viz type: ${i.viz_type}`,
      `Colunas: ${JSON.stringify(i.columns)}`,
      `Seleção: ${JSON.stringify(i.filter_values)}`,
      `Linha(s) selecionada(s):`,
      JSON.stringify(i.selected, null, 2),
      `Peers de comparação:`,
      JSON.stringify(i.peers, null, 2),
    ].join("\n"),
  };
}
