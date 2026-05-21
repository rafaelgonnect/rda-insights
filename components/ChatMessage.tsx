"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Check, X, Wrench } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolCallEvent = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  durationMs?: number;
  resultPreview?: string;
};

export type ChatMessageType =
  | { role: "user"; content: string; id: string; createdAt: number }
  | {
      role: "assistant";
      content: string;
      id: string;
      createdAt: number;
      toolCalls: ToolCallEvent[];
    }
  | {
      role: "tool_activity";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      status: "running" | "ok" | "error";
      durationMs?: number;
      resultPreview?: string;
    };

// ─── Tool name humanizer ──────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  list_dashboards: "listando dashboards",
  get_dashboard_charts: "lendo charts do dashboard",
  get_chart: "lendo metadados do gráfico",
  get_chart_data: "buscando dados do gráfico",
  get_dataset_columns: "vendo colunas do dataset",
  get_dataset_sample: "amostrando dataset",
  find_dashboards: "buscando dashboards",
  find_charts: "buscando gráficos",
  find_datasets: "buscando datasets",
  describe_chart: "descrevendo gráfico",
  summarize_dashboard_outline: "lendo todo o dashboard",
  get_active_filter: "checando filtro ativo",
};

export function humanizeTool(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

// ─── ToolPill ─────────────────────────────────────────────────────────────────

function ToolPill({ tc }: { tc: ToolCallEvent }) {
  return (
    <span className="inline-flex items-center gap-1 h-6 text-xs px-2 rounded-full bg-muted/60 mr-1 mb-1">
      {tc.status === "running" ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : tc.status === "ok" ? (
        <Check className="size-3 text-green-500" />
      ) : (
        <X className="size-3 text-destructive" />
      )}
      <Wrench className="size-3 text-muted-foreground" />
      <span className="text-muted-foreground">{humanizeTool(tc.name)}</span>
      {tc.durationMs !== undefined && (
        <span className="text-muted-foreground/60">{tc.durationMs}ms</span>
      )}
    </span>
  );
}

// ─── ChatMessage component ────────────────────────────────────────────────────

export function ChatMessageItem({ msg }: { msg: ChatMessageType }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[85%] text-sm break-words">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === "tool_activity") {
    const tc: ToolCallEvent = {
      id: msg.toolCallId,
      name: msg.name,
      args: msg.args,
      status: msg.status,
      durationMs: msg.durationMs,
      resultPreview: msg.resultPreview,
    };
    return (
      <div className="flex mb-1">
        <ToolPill tc={tc} />
      </div>
    );
  }

  // assistant
  return (
    <div className="flex flex-col mb-3 max-w-[92%]">
      {msg.toolCalls.length > 0 && (
        <div className="flex flex-wrap mb-1">
          {msg.toolCalls.map((tc) => (
            <ToolPill key={tc.id} tc={tc} />
          ))}
        </div>
      )}
      {msg.content && (
        <div className="text-sm [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_p]:mb-1 max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
