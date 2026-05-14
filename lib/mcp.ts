import { mintMcpToken } from "./jwt";
import { env } from "./env";

export class McpError extends Error {
  constructor(public code: number | undefined, message: string) {
    super(message);
  }
}

export class McpClient {
  private id = 0;
  private timeoutMs = 15_000;

  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.withRetry(async () => {
      const token = await mintMcpToken("rda-insights-backend");
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${env.MCP_INTERNAL_URL}/mcp`, {
          method: "POST",
          signal: ctl.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++this.id,
            method: "tools/call",
            params: { name, arguments: args },
          }),
        });
        if (res.status >= 500) throw new McpError(res.status, `MCP ${res.status}`);
        const json = (await res.json()) as {
          result?: { content: { type: string; text: string }[] };
          error?: { code: number; message: string };
        };
        if (json.error) throw new McpError(json.error.code, json.error.message);
        const text = json.result?.content?.[0]?.text;
        if (!text) throw new McpError(undefined, "MCP returned empty content");
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof McpError && (e.code === undefined || e.code >= 500)) {
        await new Promise((r) => setTimeout(r, 300));
        return await fn();
      }
      throw e;
    }
  }

  listDashboards = () => this.callTool<{ id: number; dashboard_title: string }[]>("list_dashboards");
  getDashboard = (id: number) => this.callTool<unknown>("get_dashboard", { dashboard_id: id });
  getDashboardCharts = (id: number) =>
    this.callTool<{ id: number; slice_name: string }[]>("get_dashboard_charts", { dashboard_id: id });
  getChart = (id: number) =>
    this.callTool<{ slice_name: string; viz_type: string; datasource_id: number; params: unknown }>(
      "get_chart",
      { chart_id: id }
    );
  getChartData = (id: number) =>
    this.callTool<{ columns: string[]; rows: Record<string, unknown>[] }>("get_chart_data", {
      chart_id: id,
    });
  getDatasetColumns = (id: number) =>
    this.callTool<{ column_name: string; type: string }[]>("get_dataset_columns", { dataset_id: id });
  createGuestToken = (dashboardId: number, ttl: number = 300) =>
    this.callTool<{ token: string }>("create_guest_token", {
      dashboard_id: dashboardId,
      username: "viewer",
      ttl_seconds: ttl,
    });
  executeSql = (databaseId: number, sql: string, schema?: string, limit: number = 100) =>
    this.callTool<{ columns: string[]; rows: Record<string, unknown>[] }>("execute_sql", {
      database_id: databaseId,
      sql,
      schema,
      limit,
    });
  getHealth = () => this.callTool<{ status: string }>("get_health");
}
