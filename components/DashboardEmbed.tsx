"use client";
import { useEffect, useRef } from "react";
import { embedDashboard } from "@superset-ui/embedded-sdk";

export type CrossFilterEvent = { chartId: number; filterValues: Record<string, unknown> };

export function DashboardEmbed({
  dashboardId,
  supersetUrl,
  onCrossFilter,
}: {
  dashboardId: number;
  supersetUrl: string;
  onCrossFilter?: (ev: CrossFilterEvent) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    let disposed = false;
    let unobserve: (() => void) | undefined;

    (async () => {
      const fetchTokenResponse = async () => {
        const res = await fetch("/api/guest-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dashboard_id: dashboardId }),
        });
        if (!res.ok) throw new Error("guest token failed");
        return (await res.json()) as { token: string; uuid: string };
      };

      const initial = await fetchTokenResponse();
      if (disposed) return;

      const ctx = await embedDashboard({
        id: initial.uuid,
        supersetDomain: supersetUrl,
        mountPoint: mountRef.current!,
        fetchGuestToken: async () => (await fetchTokenResponse()).token,
        dashboardUiConfig: { hideTitle: false, hideTab: false, hideChartControls: false },
      });

      if (disposed) return;

      try {
        unobserve = await (ctx as unknown as {
          observeDataMask: (cb: (mask: Record<string, unknown>) => void) => () => void;
        }).observeDataMask?.((mask) => {
          for (const [k, v] of Object.entries(mask ?? {})) {
            const m = v as { extraFormData?: { filters?: { col: string; val: unknown }[] } };
            const filters = m?.extraFormData?.filters ?? [];
            if (filters.length > 0) {
              const filterValues: Record<string, unknown> = {};
              for (const f of filters) filterValues[f.col] = f.val;
              const chartId = Number(k.replace(/^NATIVE_FILTER-/, "").replace(/^\D+/, "")) || 0;
              onCrossFilter?.({ chartId, filterValues });
            }
          }
        });
      } catch {
        // observeDataMask may not be available in older SDKs; fail silently
      }
    })();

    return () => {
      disposed = true;
      unobserve?.();
    };
  }, [dashboardId, supersetUrl, onCrossFilter]);

  return (
    <div
      ref={mountRef}
      className="w-full h-full [&>iframe]:w-full [&>iframe]:h-full [&>iframe]:border-0 [&>iframe]:block"
    />
  );
}
