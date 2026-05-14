"use client";
import { useState } from "react";
import { DashboardEmbed, CrossFilterEvent } from "@/components/DashboardEmbed";
import { InsightsSidebar } from "@/components/InsightsSidebar";

export function DashboardClient({
  dashboardId,
  supersetUrl,
  charts,
}: {
  dashboardId: number;
  supersetUrl: string;
  charts: { id: number; slice_name: string }[];
}) {
  const [filter, setFilter] = useState<CrossFilterEvent | null>(null);
  return (
    <div className="flex h-full">
      <div className="flex-1">
        <DashboardEmbed
          dashboardId={dashboardId}
          supersetUrl={supersetUrl}
          onCrossFilter={setFilter}
        />
      </div>
      <InsightsSidebar dashboardId={dashboardId} charts={charts} pendingFilter={filter} />
    </div>
  );
}
