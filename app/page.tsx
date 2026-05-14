import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { McpClient } from "@/lib/mcp";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function Home() {
  let dashboards: { id: number; dashboard_title: string }[] = [];
  let error: string | null = null;
  try {
    dashboards = await new McpClient().listDashboards();
  } catch (e) {
    error = String(e);
  }
  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Dashboards</h1>
        {error ? (
          <div className="text-destructive">Erro ao carregar: {error}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dashboards.map((d) => (
              <Link key={d.id} href={`/d/${d.id}`}>
                <Card className="p-4 hover:bg-accent transition cursor-pointer">
                  <div className="font-medium">{d.dashboard_title}</div>
                  <div className="text-xs text-muted-foreground">#{d.id}</div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
