import { env } from "@/lib/env";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const dashboardId = Number(id);
  return <DashboardClient dashboardId={dashboardId} supersetUrl={env.SUPERSET_URL} />;
}
