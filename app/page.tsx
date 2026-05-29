import { McpClient } from "@/lib/mcp";
import { Card } from "@/components/ui/card";
import { HomeLauncher } from "@/components/HomeLauncher";
import { NavLink } from "@/components/NavLink";

export const dynamic = "force-dynamic";

export default async function Home() {
  let dashboards: { id: number; dashboard_title: string; thumbnail_url: string | null }[] = [];
  let error: string | null = null;
  try {
    dashboards = await new McpClient().listDashboards();
  } catch (e) {
    error = String(e);
  }
  return (
    <div className="p-6 max-w-4xl mx-auto flex flex-col gap-8 overflow-y-auto h-full">
        {/* Home launcher — create a new dashboard from scratch */}
        <div className="max-w-3xl mx-auto w-full py-2">
          <HomeLauncher />
        </div>

        {/* Existing dashboards grid */}
        <div>
          <h1 className="text-2xl font-semibold mb-4">Dashboards</h1>
          {error ? (
            <div className="text-destructive">Erro ao carregar: {error}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dashboards.map((d) => (
                <NavLink key={d.id} href={`/d/${d.id}`}>
                  <Card className="overflow-hidden hover:bg-accent transition cursor-pointer">
                    <div className="aspect-video bg-gradient-to-br from-muted to-muted-foreground/10 relative">
                      {d.thumbnail_url ? (
                        // Use <img> (not next/image) — thumbnails are small and
                        // the proxy is same-origin, so no Image domain config needed.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/dashboard-thumb/${d.id}?path=${encodeURIComponent(d.thumbnail_url)}`}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-2xl font-semibold text-muted-foreground">
                          {d.dashboard_title.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="font-medium">{d.dashboard_title}</div>
                      <div className="text-xs text-muted-foreground">#{d.id}</div>
                    </div>
                  </Card>
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </div>
  );
}
