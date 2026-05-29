import { McpClient } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight list for the sidebar. Degrades to [] if Superset is unreachable
// so the shell/nav still renders.
export async function GET() {
  try {
    const list = await new McpClient().listDashboards();
    return Response.json(
      list.map((d) => ({ id: d.id, dashboard_title: d.dashboard_title }))
    );
  } catch {
    return Response.json([]);
  }
}
