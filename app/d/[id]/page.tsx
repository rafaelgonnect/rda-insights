import { McpClient } from "@/lib/mcp";
import { env } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const dashboardId = Number(id);
  const charts = await new McpClient().getDashboardCharts(dashboardId);
  return (
    <AppShell>
      <DashboardClient
        dashboardId={dashboardId}
        supersetUrl={env.SUPERSET_URL}
        charts={charts}
      />
    </AppShell>
  );
}
