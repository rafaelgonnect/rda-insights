// Probe live MCP service to verify wire format assumed by lib/mcp.ts.
//
// Run with all required env vars set (see Phase 2.2 of the rda-insights plan).
// On success: prints get_health and list_dashboards results.
// On failure: prints raw HTTP response so the wire format can be diagnosed.

import { McpClient } from "../lib/mcp";
import { mintMcpToken } from "../lib/jwt";
import { env } from "../lib/env";

async function rawDump(name: string, body: object) {
  const token = await mintMcpToken("probe");
  const url = `${env.MCP_INTERNAL_URL}/mcp`;
  console.log(`\n--- raw POST ${url} (${name}) ---`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  console.log("status:", res.status, res.statusText);
  console.log("content-type:", res.headers.get("content-type"));
  console.log("server:", res.headers.get("server"));
  const text = await res.text();
  console.log("body (first 500 chars):", text.slice(0, 500));
}

async function main() {
  console.log("MCP_INTERNAL_URL =", env.MCP_INTERNAL_URL);
  console.log("MCP_JWT_ISSUER   =", env.MCP_JWT_ISSUER);
  console.log("MCP_JWT_AUDIENCE =", env.MCP_JWT_AUDIENCE);

  const c = new McpClient();
  console.log("\n=== get_health ===");
  try {
    const health = await c.getHealth();
    console.log(JSON.stringify(health, null, 2));
  } catch (e) {
    console.error("health failed:", e);
    await rawDump("get_health", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_health", arguments: {} },
    });
  }

  console.log("\n=== list_dashboards (top 3) ===");
  try {
    const dashboards = await c.listDashboards();
    console.log(JSON.stringify((dashboards as unknown[]).slice(0, 3), null, 2));
  } catch (e) {
    console.error("list_dashboards failed:", e);
    await rawDump("list_dashboards", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_dashboards", arguments: {} },
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
