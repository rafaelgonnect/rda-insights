import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@/lib/mcp-tools";

// ─── Mock McpClient so no real HTTP calls happen ──────────────────────────────

vi.mock("@/lib/mcp", () => {
  class MockMcpClient {
    async listDashboards() {
      return [
        { id: 1, dashboard_title: "Sales", thumbnail_url: null },
        { id: 2, dashboard_title: "Marketing", thumbnail_url: null },
      ];
    }
    async getDashboardCharts(_id: number) {
      return [{ id: 10, slice_name: "Revenue" }];
    }
    async getChart(id: number) {
      return {
        slice_name: `Chart ${id}`,
        viz_type: "bar",
        datasource_id: 1,
        datasource_type: "table",
        params: { x_axis: "month", metrics: ["sum__revenue"] },
      };
    }
    async getChartData(_id: number) {
      return {
        columns: ["month", "revenue"],
        rows: Array.from({ length: 60 }, (_, i) => ({ month: `2024-${i + 1}`, revenue: i * 100 })),
      };
    }
    async getDatasetColumns(_id: number) {
      return [
        { column_name: "id", type: "INT" },
        { column_name: "name", type: "VARCHAR" },
      ];
    }
    async getDatasetMeta(_id: number) {
      return { database_id: 1, schema: "public", table_name: "sales" };
    }
    async executeSql(_dbId: number, _sql: string) {
      return { columns: ["id", "name"], rows: [{ id: 1, name: "Alice" }] };
    }
    async findDashboards(_name: string, _limit: number) {
      return [{ id: 3, dashboard_title: "Found Dashboard" }];
    }
    async findCharts(_name?: string, _viz?: string, _limit?: number) {
      return [{ id: 20, slice_name: "Found Chart", viz_type: "table" }];
    }
    async findDatasets(_name: string, _limit: number) {
      return [{ id: 5, table_name: "found_dataset" }];
    }
  }
  return { McpClient: MockMcpClient, McpError: class McpError extends Error {} };
});

// Import AFTER the mock is in place
import { executeTool, getTools, getToolByName, toolsForOpenAI } from "@/lib/mcp-tools";
import { McpClient } from "@/lib/mcp";

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    mcp: new McpClient() as ToolContext["mcp"],
    dashboardId: 1,
    filterContext: { region: "SP" },
    ...overrides,
  };
}

// ─── Registry shape ────────────────────────────────────────────────────────────

describe("Tool registry", () => {
  it("registers 25 tools (12 read + 13 write)", () => {
    expect(getTools()).toHaveLength(25);
  });

  it("getToolByName returns undefined for unknown tool", () => {
    expect(getToolByName("nonexistent_tool")).toBeUndefined();
  });

  it("all READ tools have requiresConfirmation: false", () => {
    const readTools = [
      "list_dashboards", "get_dashboard_charts", "get_chart", "get_chart_data",
      "get_dataset_columns", "get_dataset_sample", "find_dashboards", "find_charts",
      "find_datasets", "describe_chart", "summarize_dashboard_outline", "get_active_filter",
    ];
    for (const name of readTools) {
      const tool = getToolByName(name);
      expect(tool, `tool ${name}`).toBeDefined();
      expect(tool?.requiresConfirmation, `tool ${name}`).toBe(false);
    }
  });

  it("all WRITE tools have requiresConfirmation: true", () => {
    const writeTools = [
      "create_simple_chart", "update_chart", "delete_chart",
      "create_dashboard", "update_dashboard", "delete_dashboard",
      "attach_charts_to_dashboard", "build_dashboard_layout",
      "create_dataset", "delete_dataset", "refresh_dataset",
      "execute_sql", "grant_dataset_to_role",
    ];
    for (const name of writeTools) {
      const tool = getToolByName(name);
      expect(tool, `tool ${name}`).toBeDefined();
      expect(tool?.requiresConfirmation, `tool ${name}`).toBe(true);
    }
  });

  it("toolsForOpenAI() defaults to READ-only (Bate-papo) — 12 tools", () => {
    const tools = toolsForOpenAI();
    expect(tools).toHaveLength(12);
    const names = tools.map(
      (t) => (t as { function: { name: string } }).function.name
    );
    // No write tool leaks into read-only mode
    expect(names).not.toContain("create_dashboard");
    expect(names).not.toContain("execute_sql");
  });

  it("toolsForOpenAI({ writable: true }) (Dev) returns all 25 with correct shape", () => {
    const tools = toolsForOpenAI({ writable: true });
    expect(tools).toHaveLength(25);
    for (const t of tools) {
      expect(t.type).toBe("function");
      // Cast to access function property (ChatCompletionFunctionTool)
      const fn = (t as { type: "function"; function: { name: string; description: string; parameters: unknown } }).function;
      expect(fn.name).toBeTruthy();
      expect(fn.description).toBeTruthy();
      expect(typeof fn.parameters).toBe("object");
    }
  });
});

// ─── executeTool — list_dashboards ────────────────────────────────────────────

describe("executeTool('list_dashboards')", () => {
  it("returns ok:true with array of dashboards", async () => {
    const ctx = makeCtx();
    const r = await executeTool("list_dashboards", {}, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const result = r.result as { id: number; dashboard_title: string }[];
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ id: 1, dashboard_title: "Sales" });
  });

  it("unknown tool name returns ok:false without throwing", async () => {
    const ctx = makeCtx();
    const r = await executeTool("does_not_exist", {}, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toMatch(/Unknown tool/);
  });
});

// ─── executeTool — get_chart_data ─────────────────────────────────────────────

describe("executeTool('get_chart_data')", () => {
  it("caps rows at 50", async () => {
    const ctx = makeCtx();
    const r = await executeTool("get_chart_data", { chart_id: 999 }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const result = r.result as { columns: string[]; rows: unknown[] };
    // Mock returns 60 rows; tool must cap at 50
    expect(result.rows.length).toBeLessThanOrEqual(50);
    expect(result.columns).toEqual(["month", "revenue"]);
  });

  it("invalid args (chart_id is string) returns ok:false", async () => {
    const ctx = makeCtx();
    const r = await executeTool("get_chart_data", { chart_id: "abc" }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toMatch(/Invalid arguments/);
  });

  it("missing required arg returns ok:false", async () => {
    const ctx = makeCtx();
    const r = await executeTool("get_chart_data", {}, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toMatch(/Invalid arguments/);
  });
});

// ─── executeTool — get_dataset_sample ────────────────────────────────────────

describe("executeTool('get_dataset_sample')", () => {
  it("calls getDatasetMeta and executeSql", async () => {
    const ctx = makeCtx();
    const r = await executeTool("get_dataset_sample", { dataset_id: 1 }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const result = r.result as { columns: string[]; rows: unknown[] };
    expect(result.columns).toBeDefined();
    expect(result.rows).toBeDefined();
  });
});

// ─── executeTool — get_dashboard_charts without dashboardId ──────────────────

describe("executeTool('get_dashboard_charts')", () => {
  it("uses ctx.dashboardId when dashboard_id arg is omitted", async () => {
    const ctx = makeCtx({ dashboardId: 1 });
    const r = await executeTool("get_dashboard_charts", {}, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const result = r.result as { id: number; slice_name: string }[];
    expect(result[0].id).toBe(10);
  });

  it("returns ok:false when no dashboard_id and no ctx.dashboardId", async () => {
    const ctx = makeCtx({ dashboardId: undefined });
    const r = await executeTool("get_dashboard_charts", {}, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toMatch(/No dashboard_id/);
  });
});

// ─── executeTool — get_active_filter ─────────────────────────────────────────

describe("executeTool('get_active_filter')", () => {
  it("returns filterContext from ctx", async () => {
    const ctx = makeCtx({ filterContext: { region: "SP" } });
    const r = await executeTool("get_active_filter", {}, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.result).toEqual({ region: "SP" });
  });

  it("returns null when no filterContext", async () => {
    const ctx = makeCtx({ filterContext: undefined });
    const r = await executeTool("get_active_filter", {}, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.result).toBeNull();
  });
});

// ─── executeTool — describe_chart ─────────────────────────────────────────────

describe("executeTool('describe_chart')", () => {
  it("returns a description string", async () => {
    const ctx = makeCtx();
    const r = await executeTool("describe_chart", { chart_id: 5 }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const result = r.result as { description: string };
    expect(typeof result.description).toBe("string");
    expect(result.description).toMatch(/bar/);
  });
});
