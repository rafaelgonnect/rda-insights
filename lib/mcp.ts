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
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
