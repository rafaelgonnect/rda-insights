/**
 * Tests for Fase 4 WRITE tools in lib/mcp-tools.ts.
 * Verifies: Zod schema validation, handler return shape, requiresConfirmation flags.
 */
import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@/lib/mcp-tools";

// ─── Mock McpClient ───────────────────────────────────────────────────────────

vi.mock("@/lib/mcp", () => {
  class MockMcpClient {
    // READ stubs (needed by existing tools)
    async listDashboards() { return []; }
    async getDashboardCharts() { return []; }
    async getChart(id: number) {
      return { slice_name: `Chart ${id}`, viz_type: "bar", datasource_id: 1, datasource_type: "table", params: {} };
    }
    async getChartData() { return { columns: [], rows: [] }; }
    async getDatasetColumns() { return []; }
    async getDatasetMeta(id: number) { return { database_id: 1, schema: null, table_name: `table_${id}` }; }
    async executeSql() { return { columns: ["id"], rows: [{ id: 1 }] }; }
    async findDashboards() { return []; }
    async findCharts() { return []; }
    async findDatasets() { return []; }

    // WRITE stubs
    async createSimpleChart(body: { slice_name: string }) {
      return { id: 42, slice_name: body.slice_name };
    }
    async updateChart(id: number) {
      return { result: { id } };
    }
    async deleteChart(id: number) {
      return { message: `Deleted chart ${id}` };
    }
    async createDashboard(body: { dashboard_title: string }) {
      return { id: 99, dashboard_title: body.dashboard_title };
    }
    async updateDashboard(id: number) {
      return { result: { id } };
    }
    async deleteDashboard(id: number) {
      return { message: `Deleted dashboard ${id}` };
    }
    async attachChartsToDashboard(dashboardId: number, chartIds: number[]) {
      return { linked: chartIds, already_linked: [] };
    }
    async buildDashboardLayout(dashboardId: number) {
      return { dashboard_id: dashboardId, layout_keys: 5, rows: 1, applied_chart_ids: [1] };
    }
    async createDataset(body: { table_name: string }) {
      return { id: 7, table_name: body.table_name };
    }
    async deleteDataset(id: number) {
      return { message: `Deleted dataset ${id}` };
    }
    async refreshDataset(id: number) {
      return { message: `Refreshed dataset ${id}` };
    }
    async grantDatasetToRole(roleId: number, datasetId: number) {
      return { role_id: roleId, added_pvm_id: 228, view_menu: `[db].[tbl](id:${datasetId})`, already_granted: false, permissions: [228] };
    }
  }
  return { McpClient: MockMcpClient, McpError: class McpError extends Error { constructor(public code: number | undefined, msg: string) { super(msg); } } };
});

import { executeTool, getTools, getToolByName } from "@/lib/mcp-tools";
import { McpClient } from "@/lib/mcp";

function makeCtx(): ToolContext {
  return { mcp: new McpClient() as ToolContext["mcp"] };
}

// ─── requiresConfirmation flags ───────────────────────────────────────────────

const WRITE_TOOL_NAMES = [
  "create_simple_chart",
  "update_chart",
  "delete_chart",
  "create_dashboard",
  "update_dashboard",
  "delete_dashboard",
  "attach_charts_to_dashboard",
  "build_dashboard_layout",
  "create_dataset",
  "delete_dataset",
  "refresh_dataset",
  "execute_sql",
  "grant_dataset_to_role",
];

const READ_TOOL_NAMES = [
  "list_dashboards",
  "get_dashboard_charts",
  "get_chart",
  "get_chart_data",
  "get_dataset_columns",
  "get_dataset_sample",
  "find_dashboards",
  "find_charts",
  "find_datasets",
  "describe_chart",
  "summarize_dashboard_outline",
  "get_active_filter",
];

describe("requiresConfirmation flags", () => {
  it("all WRITE tools have requiresConfirmation: true", () => {
    for (const name of WRITE_TOOL_NAMES) {
      const tool = getToolByName(name);
      expect(tool, `tool ${name} should be registered`).toBeDefined();
      expect(tool?.requiresConfirmation, `tool ${name}`).toBe(true);
    }
  });

  it("all READ tools have requiresConfirmation: false", () => {
    for (const name of READ_TOOL_NAMES) {
      const tool = getToolByName(name);
      expect(tool, `tool ${name} should be registered`).toBeDefined();
      expect(tool?.requiresConfirmation, `tool ${name}`).toBe(false);
    }
  });

  it("registers 25 tools total (12 read + 13 write)", () => {
    expect(getTools()).toHaveLength(25);
  });
});

// ─── Zod schema validation ────────────────────────────────────────────────────

describe("create_simple_chart schema", () => {
  it("accepts valid args", async () => {
    const r = await executeTool("create_simple_chart", {
      slice_name: "My Bar",
      dataset_id: 1,
      chart_type: "bar",
      x_axis: "month",
      metric_column: "revenue",
    }, makeCtx());
    expect(r.ok).toBe(true);
  });

  it("rejects missing slice_name", async () => {
    const r = await executeTool("create_simple_chart", { dataset_id: 1, chart_type: "bar" }, makeCtx());
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toMatch(/Invalid arguments/);
  });

  it("rejects non-number dataset_id", async () => {
    const r = await executeTool("create_simple_chart", { slice_name: "x", dataset_id: "abc", chart_type: "bar" }, makeCtx());
    expect(r.ok).toBe(false);
  });
});

describe("update_chart schema", () => {
  it("accepts chart_id + payload", async () => {
    const r = await executeTool("update_chart", { chart_id: 1, payload: { slice_name: "New Name" } }, makeCtx());
    expect(r.ok).toBe(true);
  });

  it("rejects missing payload", async () => {
    const r = await executeTool("update_chart", { chart_id: 1 }, makeCtx());
    expect(r.ok).toBe(false);
  });
});

describe("delete_chart schema", () => {
  it("accepts chart_id", async () => {
    const r = await executeTool("delete_chart", { chart_id: 5 }, makeCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect((r.result as { message: string }).message).toContain("5");
  });

  it("rejects float chart_id", async () => {
    const r = await executeTool("delete_chart", { chart_id: 1.5 }, makeCtx());
    expect(r.ok).toBe(false);
  });
});

describe("create_dashboard schema", () => {
  it("accepts dashboard_title", async () => {
    const r = await executeTool("create_dashboard", { dashboard_title: "My Dashboard" }, makeCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect((r.result as { dashboard_title: string }).dashboard_title).toBe("My Dashboard");
  });

  it("rejects missing dashboard_title", async () => {
    const r = await executeTool("create_dashboard", {}, makeCtx());
    expect(r.ok).toBe(false);
  });
});

describe("attach_charts_to_dashboard schema", () => {
  it("accepts dashboard_id + chart_ids", async () => {
    const r = await executeTool("attach_charts_to_dashboard", { dashboard_id: 1, chart_ids: [2, 3] }, makeCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const res = r.result as { linked: number[] };
    expect(res.linked).toContain(2);
  });

  it("rejects empty chart_ids", async () => {
    const r = await executeTool("attach_charts_to_dashboard", { dashboard_id: 1, chart_ids: [] }, makeCtx());
    expect(r.ok).toBe(false);
  });
});

describe("build_dashboard_layout schema", () => {
  it("accepts valid charts_spec", async () => {
    const r = await executeTool("build_dashboard_layout", {
      dashboard_id: 1,
      charts_spec: [{ chart_id: 10, width: 6, height: 50 }],
    }, makeCtx());
    expect(r.ok).toBe(true);
  });

  it("rejects width > 12", async () => {
    const r = await executeTool("build_dashboard_layout", {
      dashboard_id: 1,
      charts_spec: [{ chart_id: 10, width: 13, height: 50 }],
    }, makeCtx());
    expect(r.ok).toBe(false);
  });
});

describe("create_dataset schema", () => {
  it("accepts database_id + table_name", async () => {
    const r = await executeTool("create_dataset", { database_id: 1, table_name: "my_table" }, makeCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect((r.result as { table_name: string }).table_name).toBe("my_table");
  });
});

describe("execute_sql schema", () => {
  it("accepts database_id + sql", async () => {
    const r = await executeTool("execute_sql", { database_id: 1, sql: "SELECT 1" }, makeCtx());
    expect(r.ok).toBe(true);
  });

  it("rejects limit > 1000", async () => {
    const r = await executeTool("execute_sql", { database_id: 1, sql: "SELECT 1", limit: 9999 }, makeCtx());
    expect(r.ok).toBe(false);
  });

  it("rejects empty sql", async () => {
    const r = await executeTool("execute_sql", { database_id: 1, sql: "" }, makeCtx());
    expect(r.ok).toBe(false);
  });
});

describe("grant_dataset_to_role schema", () => {
  it("accepts role_id + dataset_id", async () => {
    const r = await executeTool("grant_dataset_to_role", { role_id: 3, dataset_id: 7 }, makeCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const res = r.result as { added_pvm_id: number };
    expect(res.added_pvm_id).toBe(228);
  });

  it("rejects missing dataset_id", async () => {
    const r = await executeTool("grant_dataset_to_role", { role_id: 3 }, makeCtx());
    expect(r.ok).toBe(false);
  });
});
