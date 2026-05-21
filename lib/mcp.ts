// Superset REST API client.
//
// Named McpClient for historical reasons (originally backed by SIP-187 MCP
// service). The SIP-187 PoC wasn't actually shipped in apache/superset:6.0.0,
// so this implementation talks to Superset's REST API directly. Public surface
// is preserved so route handlers don't need to change.

import { env, embedAllowedDomains } from "./env";

export class McpError extends Error {
  constructor(public code: number | undefined, message: string) {
    super(message);
  }
}

type SupersetAuth = { accessToken: string; csrfToken: string; cookie: string };

function updateJar(jar: Map<string, string>, res: Response): void {
  const headers = res.headers.getSetCookie?.() ?? [];
  for (const h of headers) {
    const [pair] = h.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function jarToHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

export class McpClient {
  private auth: SupersetAuth | null = null;
  private timeoutMs = 15_000;

  private get baseUrl(): string {
    return env.SUPERSET_INTERNAL_URL ?? env.SUPERSET_URL;
  }

  private async login(): Promise<SupersetAuth> {
    const loginUrl = `${this.baseUrl}/api/v1/security/login`;
    console.error("[mcp.login] POST", loginUrl, "user=", env.SUPERSET_USERNAME);
    const jar = new Map<string, string>();
    let loginRes: Response;
    try {
      loginRes = await fetch(loginUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: env.SUPERSET_USERNAME,
          password: env.SUPERSET_PASSWORD,
          provider: "db",
          refresh: true,
        }),
      });
    } catch (e) {
      console.error("[mcp.login] fetch threw:", e);
      throw e;
    }
    if (!loginRes.ok) {
      const body = await loginRes.text().catch(() => "<no body>");
      console.error("[mcp.login] HTTP", loginRes.status, "body:", body);
      throw new McpError(loginRes.status, `Superset login failed (${loginRes.status}): ${body}`);
    }
    updateJar(jar, loginRes);
    const loginJson = (await loginRes.json()) as { access_token: string };
    const accessToken = loginJson.access_token;

    const csrfRes = await fetch(`${this.baseUrl}/api/v1/security/csrf_token`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        cookie: jarToHeader(jar),
      },
    });
    if (!csrfRes.ok) {
      const body = await csrfRes.text().catch(() => "<no body>");
      console.error("[mcp.login] csrf HTTP", csrfRes.status, "body:", body);
      throw new McpError(csrfRes.status, `Superset csrf_token failed (${csrfRes.status}): ${body}`);
    }
    updateJar(jar, csrfRes);
    const csrfJson = (await csrfRes.json()) as { result: string };
    return { accessToken, csrfToken: csrfJson.result, cookie: jarToHeader(jar) };
  }

  private async ensureAuth(): Promise<SupersetAuth> {
    if (!this.auth) this.auth = await this.login();
    return this.auth;
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit = {},
    retryOn401: boolean = true
  ): Promise<T> {
    const auth = await this.ensureAuth();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: ctl.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${auth.accessToken}`,
          "x-csrftoken": auth.csrfToken,
          cookie: auth.cookie,
          referer: this.baseUrl,
          ...(init.headers || {}),
        },
      });
      if (res.status === 401 && retryOn401) {
        this.auth = null;
        return this.fetchJson(path, init, false);
      }
      if (res.status >= 500) {
        throw new McpError(res.status, `Superset ${res.status}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new McpError(res.status, `Superset ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async listDashboards(): Promise<{ id: number; dashboard_title: string; thumbnail_url: string | null }[]> {
    const r = await this.fetchJson<{
      result: { id: number; dashboard_title: string; thumbnail_url?: string | null }[];
    }>("/api/v1/dashboard/?q=(page_size:100)");
    return r.result.map((d) => ({
      id: d.id,
      dashboard_title: d.dashboard_title,
      thumbnail_url: d.thumbnail_url ?? null,
    }));
  }

  getDashboard = (id: number) => this.fetchJson<unknown>(`/api/v1/dashboard/${id}`);

  async getDashboardCharts(id: number): Promise<{ id: number; slice_name: string }[]> {
    const r = await this.fetchJson<{
      result: { id: number; slice_name: string }[];
    }>(`/api/v1/dashboard/${id}/charts`);
    return r.result.map((c) => ({ id: c.id, slice_name: c.slice_name }));
  }

  async getChart(
    id: number
  ): Promise<{ slice_name: string; viz_type: string; datasource_id: number; datasource_type: string; params: unknown }> {
    const r = await this.fetchJson<{
      result: {
        slice_name: string;
        viz_type: string;
        datasource_id: number;
        datasource_type?: string;
        params: string | null;
      };
    }>(`/api/v1/chart/${id}`);
    return {
      slice_name: r.result.slice_name,
      viz_type: r.result.viz_type,
      datasource_id: r.result.datasource_id,
      datasource_type: r.result.datasource_type ?? "table",
      params: r.result.params ? safeJsonParse(r.result.params) : {},
    };
  }

  async getChartData(
    id: number
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    type ChartDataResp = { result: { colnames?: string[]; data?: Record<string, unknown>[] }[] };

    // Helper to normalise GET and POST responses into { columns, rows }.
    function normalise(r: ChartDataResp): { columns: string[]; rows: Record<string, unknown>[] } | null {
      const slice = r.result?.[0];
      if (!slice) return null;
      return { columns: slice.colnames ?? [], rows: slice.data ?? [] };
    }

    // Path A — GET /api/v1/chart/{id}/data/ (works when chart has stored query_context).
    let pathAError: unknown;
    try {
      const r = await this.fetchJson<ChartDataResp>(`/api/v1/chart/${id}/data/`);
      const out = normalise(r);
      if (out) return out;
      // Empty result: fall through to path B.
      pathAError = new Error("no rows in GET response");
    } catch (e) {
      pathAError = e;
      // Only fall back to path B for query_context errors or 400s that suggest missing context.
      // For non-400 errors (e.g., 500, network), propagate immediately.
      if (e instanceof McpError && e.code !== undefined && e.code !== 400) throw e;
    }

    // Path B — synthesize query from chart form_data and POST /api/v1/chart/data.
    let pathBError: unknown;
    try {
      const chart = await this.getChart(id);
      const params = chart.params as {
        x_axis?: string | string[];
        groupby?: string[];
        metric?: unknown;
        metrics?: unknown[];
        row_limit?: number;
      };

      const colsRaw: unknown[] = [];
      if (typeof params.x_axis === "string" && params.x_axis) colsRaw.push(params.x_axis);
      else if (Array.isArray(params.x_axis)) colsRaw.push(...params.x_axis);
      for (const g of params.groupby ?? []) if (!colsRaw.includes(g)) colsRaw.push(g);
      const columns = colsRaw.filter((c): c is string => typeof c === "string");

      let metrics: unknown[] = params.metrics ?? (params.metric ? [params.metric] : []);
      metrics = metrics.filter((m) => m !== null && m !== undefined);

      const queryBody = {
        datasource: { id: chart.datasource_id, type: chart.datasource_type ?? "table" },
        queries: [{ columns, metrics, row_limit: params.row_limit ?? 100, filters: [] }],
        result_format: "json",
        result_type: "full",
      };

      const r = await this.fetchJson<ChartDataResp>(`/api/v1/chart/data`, {
        method: "POST",
        body: JSON.stringify(queryBody),
      });
      const out = normalise(r);
      if (out) return out;
      pathBError = new Error("no rows in POST response");
    } catch (e) {
      pathBError = e;
    }

    throw new McpError(
      undefined,
      `getChartData failed for chart ${id}. Path A: ${String(pathAError)}; Path B: ${String(pathBError)}`
    );
  }

  async getDatasetColumns(
    id: number
  ): Promise<{ column_name: string; type: string }[]> {
    const r = await this.fetchJson<{
      result: { columns: { column_name: string; type: string | null }[] };
    }>(`/api/v1/dataset/${id}`);
    return r.result.columns.map((c) => ({ column_name: c.column_name, type: c.type ?? "" }));
  }

  async getDashboardEmbedUuid(dashboardId: number): Promise<string> {
    // GET returns the existing embedded record. If embedding was never
    // enabled for this dashboard, Superset answers 404 — in that case we
    // POST to create it, using EMBED_ALLOWED_DOMAINS as the allowlist.
    try {
      const r = await this.fetchJson<{ result: { uuid: string } }>(
        `/api/v1/dashboard/${dashboardId}/embedded`
      );
      return r.result.uuid;
    } catch (e) {
      if (!(e instanceof McpError) || e.code !== 404) throw e;
      const created = await this.fetchJson<{ result: { uuid: string } }>(
        `/api/v1/dashboard/${dashboardId}/embedded`,
        {
          method: "POST",
          body: JSON.stringify({ allowed_domains: embedAllowedDomains }),
        }
      );
      return created.result.uuid;
    }
  }

  async createGuestToken(
    dashboardId: number,
    ttl: number = 300
  ): Promise<{ token: string; uuid: string }> {
    void ttl; // Superset controls TTL via GUEST_TOKEN_JWT_EXP_SECONDS config
    const uuid = await this.getDashboardEmbedUuid(dashboardId);
    const r = await this.fetchJson<{ token: string }>("/api/v1/security/guest_token/", {
      method: "POST",
      body: JSON.stringify({
        user: { username: "viewer", first_name: "Guest", last_name: "Viewer" },
        resources: [{ type: "dashboard", id: uuid }],
        rls: [],
      }),
    });
    return { token: r.token, uuid };
  }

  async executeSql(
    databaseId: number,
    sql: string,
    schema?: string,
    limit: number = 100
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    const r = await this.fetchJson<{
      data?: Record<string, unknown>[];
      columns?: { name: string }[];
    }>("/api/v1/sqllab/execute/", {
      method: "POST",
      body: JSON.stringify({
        client_id: `rda-${Date.now()}`,
        database_id: databaseId,
        sql,
        schema,
        queryLimit: limit,
        runAsync: false,
        select_as_cta: false,
      }),
    });
    return {
      columns: (r.columns ?? []).map((c) => c.name),
      rows: r.data ?? [],
    };
  }

  async getDatasetMeta(
    id: number
  ): Promise<{ database_id: number; schema: string | null; table_name: string }> {
    const r = await this.fetchJson<{
      result: { database?: { id: number }; schema?: string | null; table_name: string };
    }>(`/api/v1/dataset/${id}`);
    return {
      database_id: r.result.database?.id ?? 0,
      schema: r.result.schema ?? null,
      table_name: r.result.table_name,
    };
  }

  async findDashboards(
    nameContains: string,
    limit = 20
  ): Promise<{ id: number; dashboard_title: string }[]> {
    const val = nameContains.replace(/'/g, "\\'");
    const q = encodeURIComponent(
      `(filters:!((col:dashboard_title,opr:ct,value:'${val}')),page_size:${limit})`
    );
    const r = await this.fetchJson<{
      result: { id: number; dashboard_title: string }[];
    }>(`/api/v1/dashboard/?q=${q}`);
    return r.result.map((d) => ({ id: d.id, dashboard_title: d.dashboard_title }));
  }

  async findCharts(
    nameContains?: string,
    vizType?: string,
    limit = 20
  ): Promise<{ id: number; slice_name: string; viz_type: string }[]> {
    const filters: string[] = [];
    if (nameContains) {
      const val = nameContains.replace(/'/g, "\\'");
      filters.push(`(col:slice_name,opr:ct,value:'${val}')`);
    }
    if (vizType) {
      const val = vizType.replace(/'/g, "\\'");
      filters.push(`(col:viz_type,opr:eq,value:'${val}')`);
    }
    const filterStr = filters.length > 0 ? `filters:!(${filters.join(",")}),` : "";
    const q = encodeURIComponent(`(${filterStr}page_size:${limit})`);
    const r = await this.fetchJson<{
      result: { id: number; slice_name: string; viz_type: string }[];
    }>(`/api/v1/chart/?q=${q}`);
    return r.result.map((c) => ({ id: c.id, slice_name: c.slice_name, viz_type: c.viz_type }));
  }

  async findDatasets(
    nameContains: string,
    limit = 20
  ): Promise<{ id: number; table_name: string }[]> {
    const val = nameContains.replace(/'/g, "\\'");
    const q = encodeURIComponent(
      `(filters:!((col:table_name,opr:ct,value:'${val}')),page_size:${limit})`
    );
    const r = await this.fetchJson<{
      result: { id: number; table_name: string }[];
    }>(`/api/v1/dataset/?q=${q}`);
    return r.result.map((d) => ({ id: d.id, table_name: d.table_name }));
  }

  async getHealth(): Promise<{ status: string }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: ctl.signal });
      if (!res.ok) throw new McpError(res.status, `Superset health ${res.status}`);
      return { status: "ok" };
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── WRITE METHODS (Fase 4) ───────────────────────────────────────────────

  // Chart CRUD

  async createSimpleChart(body: {
    slice_name: string;
    dataset_id: number;
    chart_type: string;
    x_axis?: string;
    dimension?: string;
    metric_column?: string;
    metric_aggregate?: string;
    row_limit?: number;
    dashboards?: number[];
    description?: string;
  }): Promise<{ id: number; slice_name: string }> {
    const LEGACY_VIZ: Record<string, string> = {
      dist_bar: "echarts_timeseries_bar",
      bar: "echarts_timeseries_bar",
      line: "echarts_timeseries_line",
      area: "echarts_area",
      dual_line: "mixed_timeseries",
    };
    const MODERN_VIZ: Record<string, string> = {
      bar: "echarts_timeseries_bar",
      line: "echarts_timeseries_line",
      area: "echarts_area",
      scatter: "echarts_timeseries_scatter",
      pie: "pie",
      big_number: "big_number_total",
      big_number_trend: "big_number",
      table: "table",
      histogram: "histogram",
      heatmap: "heatmap_v2",
      treemap: "treemap_v2",
      sankey: "sankey_v2",
    };

    const chartType = body.chart_type;
    if (chartType in LEGACY_VIZ) {
      throw new McpError(400, `chart_type "${chartType}" is a legacy Superset 5 viz removed in 6.0. Use "${LEGACY_VIZ[chartType]}" instead.`);
    }
    if (!(chartType in MODERN_VIZ)) {
      throw new McpError(400, `chart_type must be one of ${Object.keys(MODERN_VIZ).sort().join(", ")}; got "${chartType}"`);
    }

    const vizType = MODERN_VIZ[chartType];
    const metricColumn = body.metric_column ?? "";
    const metricAggregate = (body.metric_aggregate ?? "AVG").toUpperCase();
    const rowLimit = body.row_limit ?? 100;

    const metric = metricColumn
      ? { expressionType: "SIMPLE", aggregate: metricAggregate, column: { column_name: metricColumn }, label: `${metricAggregate}(${metricColumn})`, hasCustomLabel: false }
      : { expressionType: "SQL", sqlExpression: "COUNT(*)", label: "COUNT(*)", aggregate: null, column: null, hasCustomLabel: false };

    const params: Record<string, unknown> = {
      datasource: `${body.dataset_id}__table`,
      viz_type: vizType,
      adhoc_filters: [],
      row_limit: rowLimit,
      color_scheme: "supersetColors",
    };

    if (["bar", "line", "area", "scatter"].includes(chartType)) {
      if (!body.x_axis) throw new McpError(400, `chart_type="${chartType}" requires x_axis`);
      params.x_axis = body.x_axis;
      params.metrics = [metric];
      params.groupby = [];
      params.show_legend = true;
      params.orientation = "vertical";
      params.y_axis_format = "SMART_NUMBER";
      if (chartType === "bar") params.show_value = true;
    } else if (["pie", "treemap", "sankey"].includes(chartType)) {
      if (!body.dimension) throw new McpError(400, `chart_type="${chartType}" requires dimension`);
      params.groupby = [body.dimension];
      params.metric = metric;
      params.show_legend = true;
      params.show_labels = true;
      params.label_type = "key_percent";
      params.labels_outside = chartType === "pie";
    } else if (["big_number", "big_number_trend"].includes(chartType)) {
      params.metric = metric;
      params.header_font_size = 0.4;
      params.subheader_font_size = 0.15;
      params.y_axis_format = "SMART_NUMBER";
    } else if (chartType === "histogram") {
      if (!metricColumn) throw new McpError(400, "histogram requires metric_column");
      params.all_columns_x = [metricColumn];
      params.bins = 20;
      params.x_axis_format = "SMART_NUMBER";
    } else if (chartType === "heatmap") {
      if (!body.x_axis || !body.dimension || !metricColumn) throw new McpError(400, "heatmap requires x_axis, dimension, and metric_column");
      params.x_axis = body.x_axis;
      params.groupby = [body.dimension];
      params.metric = metric;
    } else if (chartType === "table") {
      params.query_mode = metricColumn || body.x_axis ? "aggregate" : "raw";
      if (params.query_mode === "aggregate") {
        params.metrics = [metric];
        if (body.x_axis) params.groupby = [body.x_axis];
      }
    }

    const reqBody: Record<string, unknown> = {
      slice_name: body.slice_name,
      viz_type: vizType,
      datasource_id: body.dataset_id,
      datasource_type: "table",
      params: JSON.stringify(params),
      description: body.description ?? "",
    };
    if (body.dashboards && body.dashboards.length > 0) reqBody.dashboards = body.dashboards;

    const r = await this.fetchJson<{ id: number; result: { slice_name: string } }>("/api/v1/chart/", {
      method: "POST",
      body: JSON.stringify(reqBody),
    });
    return { id: r.id, slice_name: r.result?.slice_name ?? body.slice_name };
  }

  async updateChart(chartId: number, payload: Record<string, unknown>): Promise<unknown> {
    return this.fetchJson<unknown>(`/api/v1/chart/${chartId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async deleteChart(chartId: number): Promise<{ message: string }> {
    return this.fetchJson<{ message: string }>(`/api/v1/chart/${chartId}`, {
      method: "DELETE",
    });
  }

  // Dashboard CRUD

  async createDashboard(body: {
    dashboard_title: string;
    slug?: string;
    published?: boolean;
    owners?: number[];
  }): Promise<{ id: number; dashboard_title: string }> {
    const reqBody: Record<string, unknown> = {
      dashboard_title: body.dashboard_title,
      slug: body.slug ?? "",
      published: body.published ?? false,
    };
    if (body.owners && body.owners.length > 0) reqBody.owners = body.owners;
    const r = await this.fetchJson<{ id: number; result: { dashboard_title: string } }>("/api/v1/dashboard/", {
      method: "POST",
      body: JSON.stringify(reqBody),
    });
    return { id: r.id, dashboard_title: r.result?.dashboard_title ?? body.dashboard_title };
  }

  async updateDashboard(dashboardId: number, payload: Record<string, unknown>): Promise<unknown> {
    return this.fetchJson<unknown>(`/api/v1/dashboard/${dashboardId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async deleteDashboard(dashboardId: number): Promise<{ message: string }> {
    return this.fetchJson<{ message: string }>(`/api/v1/dashboard/${dashboardId}`, {
      method: "DELETE",
    });
  }

  async attachChartsToDashboard(dashboardId: number, chartIds: number[]): Promise<{ linked: number[]; already_linked: number[] }> {
    const linked: number[] = [];
    const alreadyLinked: number[] = [];
    for (const cid of chartIds) {
      const ch = await this.fetchJson<{ result: { dashboards?: { id: number }[] } }>(`/api/v1/chart/${cid}`);
      const existing = (ch.result?.dashboards ?? []).map((d) => d.id);
      if (existing.includes(dashboardId)) {
        alreadyLinked.push(cid);
        continue;
      }
      const merged = Array.from(new Set([...existing, dashboardId])).sort((a, b) => a - b);
      await this.fetchJson<unknown>(`/api/v1/chart/${cid}`, {
        method: "PUT",
        body: JSON.stringify({ dashboards: merged }),
      });
      linked.push(cid);
    }
    return { linked, already_linked: alreadyLinked };
  }

  async buildDashboardLayout(dashboardId: number, chartsSpec: { chart_id: number; width: number; height: number; slice_name?: string }[]): Promise<{ dashboard_id: number; layout_keys: number; rows: number; applied_chart_ids: number[] }> {
    type LayoutNode = {
      type: string;
      id: string;
      children: string[];
      parents?: string[];
      meta?: Record<string, unknown>;
    };
    const layout: Record<string, LayoutNode> = {
      DASHBOARD_VERSION_KEY: { type: "DASHBOARD_VERSION_KEY", id: "DASHBOARD_VERSION_KEY", children: [] },
      ROOT_ID: { type: "ROOT", id: "ROOT_ID", children: ["GRID_ID"] },
      GRID_ID: { type: "GRID", id: "GRID_ID", children: [], parents: ["ROOT_ID"] },
    };
    // Remove the version key from the layout object since it's a string value, not a node
    delete layout["DASHBOARD_VERSION_KEY"];

    // Add version as a plain field
    const finalLayout: Record<string, unknown> = { DASHBOARD_VERSION_KEY: "v2" };

    let curRow: string | null = null;
    let rowW = 0;
    const appliedChartIds: number[] = [];
    let rowCount = 0;

    const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 12)}`;

    for (const spec of chartsSpec) {
      const cid = spec.chart_id;
      const w = Math.max(1, Math.min(12, spec.width));
      const h = spec.height;
      let name = spec.slice_name;
      if (!name) {
        try {
          const chart = await this.fetchJson<{ result: { slice_name?: string } }>(`/api/v1/chart/${cid}`);
          name = chart.result?.slice_name ?? `chart ${cid}`;
        } catch {
          name = `chart ${cid}`;
        }
      }

      if (curRow === null || rowW + w > 12) {
        const rid = newId("ROW");
        layout[rid] = {
          children: [], id: rid,
          meta: { background: "BACKGROUND_TRANSPARENT" },
          parents: ["ROOT_ID", "GRID_ID"], type: "ROW",
        };
        layout["GRID_ID"].children.push(rid);
        curRow = rid;
        rowW = 0;
        rowCount++;
      }

      const cbId = newId("CHART");
      layout[cbId] = {
        children: [], id: cbId,
        meta: {
          chartId: cid, sliceName: name,
          width: w, height: h,
          uuid: crypto.randomUUID(),
        },
        parents: ["ROOT_ID", "GRID_ID", curRow],
        type: "CHART",
      };
      layout[curRow].children.push(cbId);
      rowW += w;
      appliedChartIds.push(cid);
    }

    // Merge layout into finalLayout
    for (const [k, v] of Object.entries(layout)) {
      finalLayout[k] = v;
    }

    const jsonMetadata = {
      chart_configuration: {},
      global_chart_configuration: {
        scope: { rootPath: ["ROOT_ID"], excluded: [] },
        chartsInScope: appliedChartIds,
      },
      color_scheme: "",
      refresh_frequency: 0,
      cross_filters_enabled: true,
      shared_label_colors: {},
      label_colors: {},
    };

    await this.fetchJson<unknown>(`/api/v1/dashboard/${dashboardId}`, {
      method: "PUT",
      body: JSON.stringify({
        position_json: JSON.stringify(finalLayout),
        json_metadata: JSON.stringify(jsonMetadata),
      }),
    });

    return {
      dashboard_id: dashboardId,
      layout_keys: Object.keys(finalLayout).length,
      rows: rowCount,
      applied_chart_ids: appliedChartIds,
    };
  }

  // Dataset CRUD

  async createDataset(body: {
    database_id: number;
    table_name: string;
    schema?: string;
    owners?: number[];
  }): Promise<{ id: number; table_name: string }> {
    const reqBody: Record<string, unknown> = {
      database: body.database_id,
      table_name: body.table_name,
    };
    if (body.schema) reqBody.schema = body.schema;
    if (body.owners && body.owners.length > 0) reqBody.owners = body.owners;
    const r = await this.fetchJson<{ id: number; result: { table_name: string } }>("/api/v1/dataset/", {
      method: "POST",
      body: JSON.stringify(reqBody),
    });
    return { id: r.id, table_name: r.result?.table_name ?? body.table_name };
  }

  async deleteDataset(datasetId: number): Promise<{ message: string }> {
    return this.fetchJson<{ message: string }>(`/api/v1/dataset/${datasetId}`, {
      method: "DELETE",
    });
  }

  async refreshDataset(datasetId: number): Promise<unknown> {
    return this.fetchJson<unknown>(`/api/v1/dataset/${datasetId}/refresh`, {
      method: "PUT",
    });
  }

  // Grant dataset to role

  async grantDatasetToRole(roleId: number, datasetId: number): Promise<{
    role_id: number;
    added_pvm_id: number;
    view_menu: string;
    already_granted: boolean;
    permissions: number[];
  }> {
    // Step 1: get dataset metadata to build the view_menu name
    const ds = await this.fetchJson<{
      result: { database?: { database_name?: string; id?: number } | string; table_name: string };
    }>(`/api/v1/dataset/${datasetId}`);
    const result = ds.result;
    const database = result.database;
    const dbName = (typeof database === "object" && database !== null)
      ? (database.database_name ?? "")
      : String(database ?? "");
    const tableName = result.table_name;
    if (!dbName || !tableName) throw new McpError(400, `Could not determine database_name or table_name for dataset ${datasetId}`);
    const viewMenu = `[${dbName}].[${tableName}](id:${datasetId})`;

    // Step 2: paginate permissions-resources to find the PVM id
    let pvmId: number | null = null;
    let page = 0;
    const pageSize = 1000;
    while (pvmId === null) {
      const resp = await this.fetchJson<{
        result: { id: number; permission?: { name: string }; view_menu?: { name: string } }[];
        count: number;
      }>(`/api/v1/security/permissions-resources/?q=${encodeURIComponent(JSON.stringify({ page, page_size: pageSize }))}`);
      const items = resp.result ?? [];
      for (const item of items) {
        if (item.permission?.name === "datasource_access" && item.view_menu?.name === viewMenu) {
          pvmId = item.id;
          break;
        }
      }
      if (pvmId !== null || items.length < pageSize) break;
      page++;
    }
    if (pvmId === null) {
      throw new McpError(404, `No permission_view_menu found for datasource_access on ${viewMenu}. The dataset may not be registered or the PVM wasn't created yet.`);
    }

    // Step 3: get the role's current permissions
    const roleResp = await this.fetchJson<{
      result: { name?: string; permissions?: (number | { id: number })[] };
    }>(`/api/v1/security/roles/${roleId}`);
    const roleResult = roleResp.result ?? {};
    const existing: number[] = (roleResult.permissions ?? []).map((p) =>
      typeof p === "number" ? p : p.id
    );
    const alreadyGranted = existing.includes(pvmId);
    const merged = alreadyGranted ? existing : [...existing, pvmId];

    // Step 4: PUT merged permissions back (only if not already granted)
    if (!alreadyGranted) {
      await this.fetchJson<unknown>(`/api/v1/security/roles/${roleId}`, {
        method: "PUT",
        body: JSON.stringify({ name: roleResult.name, permissions: merged }),
      });
    }

    return { role_id: roleId, added_pvm_id: pvmId, view_menu: viewMenu, already_granted: alreadyGranted, permissions: merged };
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
