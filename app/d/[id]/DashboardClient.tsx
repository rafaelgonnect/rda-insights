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
  // Bumped whenever a Dev-mode write is applied, to force the embed to reload
  // and reflect the change.
  const [embedKey, setEmbedKey] = useState(0);

  return (
    <div className="flex h-full">
      <div className="flex-1">
        <DashboardEmbed
          key={embedKey}
          dashboardId={dashboardId}
          supersetUrl={supersetUrl}
          onCrossFilter={setFilter}
        />
      </div>
      <ChatSidebar
        dashboardId={dashboardId}
        pendingFilter={filter}
        onDashboardMutated={() => setEmbedKey((k) => k + 1)}
      />
    </div>
  );
}
