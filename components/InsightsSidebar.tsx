"use client";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { streamPost } from "@/lib/sse-client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Pending = "chart" | "row" | null;

export function InsightsSidebar({
  dashboardId,
  charts,
  pendingFilter,
}: {
  dashboardId: number;
  charts: { id: number; slice_name: string }[];
  pendingFilter: { chartId: number; filterValues: Record<string, unknown> } | null;
}) {
  const [selectedChart, setSelectedChart] = useState<number | null>(charts[0]?.id ?? null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const ctlRef = useRef<AbortController | null>(null);

  async function runChartSummary() {
    if (!selectedChart) return;
    setOutput(""); setError(null); setPending("chart");
    ctlRef.current?.abort();
    const ctl = new AbortController(); ctlRef.current = ctl;
    try {
      await streamPost(
        `/api/insights/chart/${selectedChart}`,
        { filters: {} },
        (t) => setOutput((s) => s + t),
        undefined,
        ctl.signal
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  }

  async function runRowExplain() {
    if (!pendingFilter) return;
    setOutput(""); setError(null); setPending("row");
    ctlRef.current?.abort();
    const ctl = new AbortController(); ctlRef.current = ctl;
    try {
      await streamPost(
        `/api/insights/row`,
        { chart_id: pendingFilter.chartId, filter_values: pendingFilter.filterValues },
        (t) => setOutput((s) => s + t),
        undefined,
        ctl.signal
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <aside className="w-96 border-l flex flex-col h-full">
      <div className="p-3 border-b">
        <h2 className="font-semibold text-sm">Insights de IA</h2>
        <p className="text-xs text-muted-foreground">Dashboard #{dashboardId}</p>
      </div>

      <div className="p-3 border-b space-y-2">
        <label className="text-xs font-medium">Gráfico</label>
        <select
          className="w-full text-sm border rounded px-2 py-1"
          value={selectedChart ?? ""}
          onChange={(e) => setSelectedChart(Number(e.target.value))}
        >
          {charts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.slice_name}
            </option>
          ))}
        </select>
        <Button size="sm" className="w-full" disabled={!selectedChart || pending !== null} onClick={runChartSummary}>
          {pending === "chart" ? "Gerando…" : "Resumir gráfico"}
        </Button>
      </div>

      {pendingFilter && (
        <div className="p-3 border-b">
          <Badge variant="secondary" className="mb-1">🔍 Cross-filter</Badge>
          <p className="text-xs mb-2">
            {Object.entries(pendingFilter.filterValues)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(", ")}
          </p>
          <Button size="sm" variant="outline" className="w-full" disabled={pending !== null} onClick={runRowExplain}>
            {pending === "row" ? "Gerando…" : "Explicar seleção"}
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1 p-3">
        {error && (
          <Card className="p-3 border-destructive mb-2 flex gap-2 items-start">
            <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-destructive break-words">{error}</p>
              <Button size="sm" variant="ghost" className="mt-2 h-7" onClick={() => setError(null)}>
                Tentar novamente
              </Button>
            </div>
          </Card>
        )}

        {pending && !output && !error && (
          <Card className="p-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </Card>
        )}

        {output && (
          <Card className="p-3 text-sm">
            <div className="[&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
            </div>
          </Card>
        )}
      </ScrollArea>
    </aside>
  );
}
