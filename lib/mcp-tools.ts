/**
 * Central tool registry for the chat endpoint.
 *
 * Each ToolDef maps an LLM-facing function description + Zod input schema to a
 * handler that calls McpClient (Superset REST). Fase 2 ships only READ tools;
 * WRITE tools (requiresConfirmation: true) come in Fase 4.
 */

import { z, ZodSchema } from "zod";
import { McpClient } from "./mcp";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions/completions";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface ToolContext {
  mcp: McpClient;
  dashboardId?: number;
  filterContext?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDef<I = any, O = unknown> {
  name: string;
  description: string;
  parameters: ZodSchema<I>;
  requiresConfirmation: boolean;
  handler: (input: I, ctx: ToolContext) => Promise<O>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [];

function register<I, O>(def: ToolDef<I, O>): void {
  TOOLS.push(def as ToolDef);
}

// ─── Helper: metric label (mirrors Python _metric_label) ─────────────────────

function metricLabel(m: unknown): string | null {
  if (typeof m === "string") return m;
  if (m && typeof m === "object") {
    const o = m as Record<string, unknown>;
    if (typeof o.label === "string" && o.label) return o.label;
    if (typeof o.column === "object" && o.column) {
      const col = o.column as Record<string, unknown>;
      if (typeof col.column_name === "string") {
        return `${String(o.expressionType ?? "").toLowerCase()}(${col.column_name})`;
      }
    }
    if (typeof o.expressionType === "string" && typeof o.sqlExpression === "string") {
      return o.sqlExpression.slice(0, 60);
    }
  }
  return null;
}

// ─── 1. list_dashboards ───────────────────────────────────────────────────────

register({
  name: "list_dashboards",
  description:
    "Lists all dashboards available on the Superset instance. Use this to discover dashboard IDs and titles before diving into a specific dashboard.",
  parameters: z.object({}),
  requiresConfirmation: false,
  handler: async (_input, ctx) => {
    return ctx.mcp.listDashboards();
  },
});

// ─── 2. get_dashboard_charts ──────────────────────────────────────────────────

register({
  name: "get_dashboard_charts",
  description:
    "Lists all charts attached to a dashboard. Pass dashboard_id or omit to use the currently active dashboard. Returns chart IDs and names.",
  parameters: z.object({
    dashboard_id: z.number().int().positive().optional(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    const id = input.dashboard_id ?? ctx.dashboardId;
    if (!id) throw new Error("No dashboard_id provided and no active dashboard in context.");
    return ctx.mcp.getDashboardCharts(id);
  },
});

// ─── 3. get_chart ─────────────────────────────────────────────────────────────

register({
  name: "get_chart",
  description:
    "Get a chart's metadata: viz_type, dataset ID, and form_data params (dimensions, metrics, filters). Use before get_chart_data to understand what the chart measures.",
  parameters: z.object({
    chart_id: z.number().int().positive(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    return ctx.mcp.getChart(input.chart_id);
  },
});

// ─── 4. get_chart_data ────────────────────────────────────────────────────────

register({
  name: "get_chart_data",
  description:
    "Run a chart's underlying query and return up to 50 rows. Use this to make data-grounded statements about a specific chart. Returns columns and rows.",
  parameters: z.object({
    chart_id: z.number().int().positive(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    const data = await ctx.mcp.getChartData(input.chart_id);
    return {
      columns: data.columns,
      rows: data.rows.slice(0, 50),
    };
  },
});

// ─── 5. get_dataset_columns ───────────────────────────────────────────────────

register({
  name: "get_dataset_columns",
  description:
    "Get column metadata for a dataset (names + types). Use this to understand what data is available before writing SQL or interpreting chart params.",
  parameters: z.object({
    dataset_id: z.number().int().positive(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    return ctx.mcp.getDatasetColumns(input.dataset_id);
  },
});

// ─── 6. get_dataset_sample ────────────────────────────────────────────────────

register({
  name: "get_dataset_sample",
  description:
    "Get sample rows from a dataset by running SELECT * LIMIT n. Useful for understanding data shape and values. Default limit is 10 rows.",
  parameters: z.object({
    dataset_id: z.number().int().positive(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    const limit = input.limit ?? 10;
    const meta = await ctx.mcp.getDatasetMeta(input.dataset_id);
    const table = meta.schema
      ? `"${meta.schema}"."${meta.table_name}"`
      : `"${meta.table_name}"`;
    const sql = `SELECT * FROM ${table} LIMIT ${limit}`;
    return ctx.mcp.executeSql(meta.database_id, sql, meta.schema ?? undefined, limit);
  },
});

// ─── 7. find_dashboards ───────────────────────────────────────────────────────

register({
  name: "find_dashboards",
  description:
    "Search dashboards by title substring. Use this when the user mentions a dashboard by name and you need to find its ID.",
  parameters: z.object({
    name_contains: z.string().min(1),
    limit: z.number().int().positive().max(50).optional(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    return ctx.mcp.findDashboards(input.name_contains, input.limit ?? 20);
  },
});

// ─── 8. find_charts ───────────────────────────────────────────────────────────

register({
  name: "find_charts",
  description:
    "Search charts by name substring or viz_type. Use when the user asks about a specific chart by name or wants to find all charts of a given type.",
  parameters: z.object({
    name_contains: z.string().optional(),
    viz_type: z.string().optional(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    return ctx.mcp.findCharts(input.name_contains, input.viz_type, input.limit ?? 20);
  },
});

// ─── 9. find_datasets ─────────────────────────────────────────────────────────

register({
  name: "find_datasets",
  description:
    "Search datasets by name substring. Use when you need a dataset ID to call get_dataset_columns or get_dataset_sample.",
  parameters: z.object({
    name_contains: z.string().min(1),
    limit: z.number().int().positive().max(50).optional(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    return ctx.mcp.findDatasets(input.name_contains, input.limit ?? 20);
  },
});

// ─── 10. describe_chart ───────────────────────────────────────────────────────

register({
  name: "describe_chart",
  description:
    "Returns a natural-language one-line description of a chart: viz_type, dataset, dimensions, metrics, and active filters. No extra API calls beyond chart metadata.",
  parameters: z.object({
    chart_id: z.number().int().positive(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    const chart = await ctx.mcp.getChart(input.chart_id);
    const params = (chart.params ?? {}) as Record<string, unknown>;

    // Dimensions
    const dimBits: string[] = [];
    const xAxis = params.x_axis;
    if (typeof xAxis === "string" && xAxis) {
      dimBits.push(`groups by ${xAxis}`);
    } else if (Array.isArray(xAxis) && xAxis.length > 0) {
      dimBits.push(`groups by ${xAxis.join(", ")}`);
    }
    const groupby = Array.isArray(params.groupby) ? (params.groupby as string[]) : [];
    if (groupby.length > 0) {
      const label = dimBits.length > 0 ? "broken down by" : "groups by";
      dimBits.push(`${label} ${groupby.join(", ")}`);
    }

    // Metrics
    const metricStrs: string[] = [];
    const metricsArr = Array.isArray(params.metrics) ? params.metrics : [];
    for (const m of metricsArr) {
      const lbl = metricLabel(m);
      if (lbl && !metricStrs.includes(lbl)) metricStrs.push(lbl);
    }
    const single = params.metric;
    if (single) {
      const lbl = metricLabel(single);
      if (lbl && !metricStrs.includes(lbl)) metricStrs.push(lbl);
    }

    const metricPhrase =
      metricStrs.length === 0
        ? ""
        : metricStrs.length === 1
        ? `, metric ${metricStrs[0]}`
        : `, metrics ${metricStrs.join(", ")}`;

    // Extras
    const extras: string[] = [];
    const orientation = params.orientation;
    if (typeof orientation === "string" && orientation) {
      extras.push(`${orientation.charAt(0).toUpperCase() + orientation.slice(1)} orientation`);
    }
    const rowLimit = params.row_limit;
    if (typeof rowLimit === "number") extras.push(`${rowLimit} rows max`);

    const adhocFilters = Array.isArray(params.adhoc_filters) ? params.adhoc_filters : [];
    const filterStrs: string[] = [];
    for (const f of adhocFilters) {
      if (f && typeof f === "object") {
        const fo = f as Record<string, unknown>;
        const col =
          typeof fo.subject === "string"
            ? fo.subject
            : typeof fo.col === "string"
            ? fo.col
            : null;
        const op = typeof fo.comparator === "string" ? fo.comparator : typeof fo.op === "string" ? fo.op : null;
        const val = fo.comparator ?? fo.val;
        if (col && op) filterStrs.push(`${col} ${op} ${String(val ?? "")}`);
      }
    }
    if (filterStrs.length > 0) {
      extras.push(
        filterStrs.length === 1 ? `filter ${filterStrs[0]}` : `filters ${filterStrs.join(" AND ")}`
      );
    }

    const dimsPhrase = dimBits.length > 0 ? dimBits.join(", ") : "no grouping";
    const head = `${chart.viz_type} chart '${chart.slice_name}': ${dimsPhrase}${metricPhrase}.`;
    const tail = extras.length > 0 ? `${extras.join(". ")}.` : "";
    return { description: (head + (tail ? " " + tail : "")).trim() };
  },
});

// ─── 11. summarize_dashboard_outline ─────────────────────────────────────────

register({
  name: "summarize_dashboard_outline",
  description:
    "Returns a list of all charts on a dashboard with a one-line description for each. Use this for a quick overview of what a dashboard contains before diving into specific charts.",
  parameters: z.object({
    dashboard_id: z.number().int().positive().optional(),
  }),
  requiresConfirmation: false,
  handler: async (input, ctx) => {
    const dashId = input.dashboard_id ?? ctx.dashboardId;
    if (!dashId) throw new Error("No dashboard_id provided and no active dashboard in context.");

    const charts = await ctx.mcp.getDashboardCharts(dashId);
    const results: { chart_id: number; slice_name: string; description: string }[] = [];

    for (const chart of charts) {
      try {
        const c = await ctx.mcp.getChart(chart.id);
        const params = (c.params ?? {}) as Record<string, unknown>;
        const xAxis = params.x_axis;
        const dimBits: string[] = [];
        if (typeof xAxis === "string" && xAxis) dimBits.push(`groups by ${xAxis}`);
        else if (Array.isArray(xAxis) && xAxis.length > 0) dimBits.push(`groups by ${(xAxis as string[]).join(", ")}`);
        const groupby = Array.isArray(params.groupby) ? (params.groupby as string[]) : [];
        if (groupby.length > 0) {
          const label = dimBits.length > 0 ? "broken down by" : "groups by";
          dimBits.push(`${label} ${groupby.join(", ")}`);
        }
        const metricsArr = Array.isArray(params.metrics) ? params.metrics : [];
        const metricStrs: string[] = [];
        for (const m of metricsArr) {
          const lbl = metricLabel(m);
          if (lbl && !metricStrs.includes(lbl)) metricStrs.push(lbl);
        }
        const single = params.metric;
        if (single) {
          const lbl = metricLabel(single);
          if (lbl && !metricStrs.includes(lbl)) metricStrs.push(lbl);
        }
        const metricPhrase =
          metricStrs.length === 0 ? "" : metricStrs.length === 1 ? `, metric ${metricStrs[0]}` : `, metrics ${metricStrs.join(", ")}`;
        const dimsPhrase = dimBits.length > 0 ? dimBits.join(", ") : "no grouping";
        const description = `${c.viz_type} chart: ${dimsPhrase}${metricPhrase}.`;
        results.push({ chart_id: chart.id, slice_name: chart.slice_name, description });
      } catch {
        results.push({ chart_id: chart.id, slice_name: chart.slice_name, description: "(could not load chart details)" });
      }
    }
    return results;
  },
});

// ─── 12. get_active_filter ────────────────────────────────────────────────────

register({
  name: "get_active_filter",
  description:
    "Returns the current cross-filter state that the user has applied in the dashboard embed. Use this to understand what the user is currently focused on before interpreting data.",
  parameters: z.object({}),
  requiresConfirmation: false,
  handler: async (_input, ctx) => {
    return ctx.filterContext ?? null;
  },
});

// ─── WRITE TOOLS (requiresConfirmation: true) ─────────────────────────────────

// ─── 13. create_simple_chart ──────────────────────────────────────────────────

register({
  name: "create_simple_chart",
  description:
    "Create a new chart in Superset from high-level inputs without hand-building form_data. This creates a REAL chart that will appear in the chart library. chart_type must be one of: bar, line, area, scatter, pie, big_number, big_number_trend, table, histogram, heatmap, treemap, sankey. Required args by chart_type: bar/line/area/scatter require x_axis + metric_column; pie/treemap/sankey require dimension (metric_column optional, defaults to COUNT(*)); big_number/big_number_trend require metric_column (optional, defaults to COUNT(*)). Returns the new chart_id.",
  parameters: z.object({
    slice_name: z.string().min(1),
    dataset_id: z.number().int().positive(),
    chart_type: z.string().min(1),
    x_axis: z.string().optional(),
    dimension: z.string().optional(),
    metric_column: z.string().optional(),
    metric_aggregate: z.string().optional(),
    row_limit: z.number().int().positive().max(10000).optional(),
    dashboards: z.array(z.number().int().positive()).optional(),
    description: z.string().optional(),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.createSimpleChart(input);
  },
});

// ─── 14. update_chart ─────────────────────────────────────────────────────────

register({
  name: "update_chart",
  description:
    "Update an existing chart in Superset (partial update). Modifies REAL data. payload can include: slice_name, viz_type, params (form_data JSON string), datasource_id, description, dashboards (list of dashboard IDs). Returns the updated chart.",
  parameters: z.object({
    chart_id: z.number().int().positive(),
    payload: z.record(z.string(), z.unknown()),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.updateChart(input.chart_id, input.payload);
  },
});

// ─── 15. delete_chart ─────────────────────────────────────────────────────────

register({
  name: "delete_chart",
  description:
    "Permanently delete a chart from Superset. This action CANNOT be undone. The chart is removed from all dashboards. Returns a confirmation message.",
  parameters: z.object({
    chart_id: z.number().int().positive(),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.deleteChart(input.chart_id);
  },
});

// ─── 16. create_dashboard ─────────────────────────────────────────────────────

register({
  name: "create_dashboard",
  description:
    "Create a new empty dashboard in Superset. This creates a REAL dashboard that will appear in the dashboard list. Use attach_charts_to_dashboard and build_dashboard_layout afterwards to populate it. Returns the new dashboard_id.",
  parameters: z.object({
    dashboard_title: z.string().min(1),
    slug: z.string().optional(),
    published: z.boolean().optional(),
    owners: z.array(z.number().int().positive()).optional(),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.createDashboard(input);
  },
});

// ─── 17. update_dashboard ─────────────────────────────────────────────────────

register({
  name: "update_dashboard",
  description:
    "Update an existing dashboard in Superset (partial update). Modifies REAL data. payload can include: dashboard_title, slug, published, position_json (layout), css, json_metadata, owners, roles. Returns the updated dashboard.",
  parameters: z.object({
    dashboard_id: z.number().int().positive(),
    payload: z.record(z.string(), z.unknown()),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.updateDashboard(input.dashboard_id, input.payload);
  },
});

// ─── 18. delete_dashboard ─────────────────────────────────────────────────────

register({
  name: "delete_dashboard",
  description:
    "Permanently delete a dashboard from Superset. This action CANNOT be undone. Charts are NOT deleted (only the dashboard container). Returns a confirmation message.",
  parameters: z.object({
    dashboard_id: z.number().int().positive(),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.deleteDashboard(input.dashboard_id);
  },
});

// ─── 19. attach_charts_to_dashboard ──────────────────────────────────────────

register({
  name: "attach_charts_to_dashboard",
  description:
    "Link existing charts to a dashboard (chart-dashboard association). This is needed so charts referenced in position_json actually render. Does NOT change the layout — call build_dashboard_layout to set positions. Returns { linked: [...], already_linked: [...] }.",
  parameters: z.object({
    dashboard_id: z.number().int().positive(),
    chart_ids: z.array(z.number().int().positive()).min(1),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.attachChartsToDashboard(input.dashboard_id, input.chart_ids);
  },
});

// ─── 20. build_dashboard_layout ───────────────────────────────────────────────

register({
  name: "build_dashboard_layout",
  description:
    "Greedy-pack charts into rows and apply the layout to a dashboard (overwrites position_json and json_metadata). charts_spec items: { chart_id, width (1-12), height (rows ~50px), slice_name? }. Width up to 12 per row; overflow wraps to a new row. Also sets cross_filters_enabled. Returns { dashboard_id, layout_keys, rows, applied_chart_ids }.",
  parameters: z.object({
    dashboard_id: z.number().int().positive(),
    charts_spec: z.array(z.object({
      chart_id: z.number().int().positive(),
      width: z.number().int().min(1).max(12),
      height: z.number().int().positive(),
      slice_name: z.string().optional(),
    })).min(1),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.buildDashboardLayout(input.dashboard_id, input.charts_spec);
  },
});

// ─── 21. create_dataset ───────────────────────────────────────────────────────

register({
  name: "create_dataset",
  description:
    "Register a new dataset (table or view) in Superset by pointing it at a database table. This creates a REAL dataset. database_id: use list_databases or find_datasets to find valid IDs. Returns the new dataset_id.",
  parameters: z.object({
    database_id: z.number().int().positive(),
    table_name: z.string().min(1),
    schema: z.string().optional(),
    owners: z.array(z.number().int().positive()).optional(),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.createDataset(input);
  },
});

// ─── 22. delete_dataset ───────────────────────────────────────────────────────

register({
  name: "delete_dataset",
  description:
    "Permanently delete a dataset from Superset. This action CANNOT be undone. Charts that use this dataset will break. Returns a confirmation message.",
  parameters: z.object({
    dataset_id: z.number().int().positive(),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.deleteDataset(input.dataset_id);
  },
});

// ─── 23. refresh_dataset ──────────────────────────────────────────────────────

register({
  name: "refresh_dataset",
  description:
    "Refresh a dataset's column metadata from the source database. Safe to run repeatedly — does not delete data. Use after DDL changes (ALTER TABLE, new columns). Returns the refresh result.",
  parameters: z.object({
    dataset_id: z.number().int().positive(),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.refreshDataset(input.dataset_id);
  },
});

// ─── 24. execute_sql ──────────────────────────────────────────────────────────

register({
  name: "execute_sql",
  description:
    "Execute raw SQL against a database via SQL Lab. SENSITIVE: can modify data if SQL contains INSERT/UPDATE/DELETE/DROP. Returns { columns, rows }. Default limit 100 rows. Use get_dataset_sample for safe read-only sampling instead.",
  parameters: z.object({
    database_id: z.number().int().positive(),
    sql: z.string().min(1),
    schema: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.executeSql(input.database_id, input.sql, input.schema, input.limit ?? 100);
  },
});

// ─── 25. grant_dataset_to_role ────────────────────────────────────────────────

register({
  name: "grant_dataset_to_role",
  description:
    "Grant datasource_access on a specific dataset to a Superset role. This allows users with that role to query the dataset and view charts that use it. Workflow: looks up the permission_view_menu (PVM) for the dataset via paginated scan, then PUTs the merged permission list to the role. Returns { role_id, added_pvm_id, view_menu, already_granted, permissions }.",
  parameters: z.object({
    role_id: z.number().int().positive(),
    dataset_id: z.number().int().positive(),
  }),
  requiresConfirmation: true,
  handler: async (input, ctx) => {
    return ctx.mcp.grantDatasetToRole(input.role_id, input.dataset_id);
  },
});

// ─── Public API ───────────────────────────────────────────────────────────────

export function getTools(): ToolDef[] {
  return TOOLS;
}

export function getToolByName(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = getToolByName(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool: "${name}". Available tools: ${TOOLS.map((t) => t.name).join(", ")}` };
  }

  const parsed = tool.parameters.safeParse(rawArgs);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Invalid arguments for tool "${name}": ${msg}` };
  }

  try {
    const result = await tool.handler(parsed.data, ctx);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: `Tool "${name}" execution failed: ${String(e)}` };
  }
}

export function toolsForOpenAI(): ChatCompletionFunctionTool[] {
  return TOOLS.map((t) => {
    // Use Zod v4's built-in toJSONSchema
    const schema = z.toJSONSchema(t.parameters, { target: "draft-7" });
    // Remove $schema meta from the parameters object — OpenAI doesn't want it
    const { $schema: _omit, ...parameters } = schema as Record<string, unknown>;
    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: parameters as Record<string, unknown>,
      },
    };
  });
}
