"use client";
import { useState } from "react";
import { DashboardEmbed, CrossFilterEvent } from "@/components/DashboardEmbed";
import { ChatSidebar } from "@/components/ChatSidebar";

export function DashboardClient({
  dashboardId,
  supersetUrl,
}: {
  dashboardId: number;
  supersetUrl: string;
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
      <ChatSidebar dashboardId={dashboardId} pendingFilter={filter} />
    </div>
  );
}
