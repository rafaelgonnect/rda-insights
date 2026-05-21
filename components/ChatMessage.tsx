"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Check, X, Wrench, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolCallEvent = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  durationMs?: number;
  resultPreview?: string;
};

export type ToolConfirmationStatus = "pending" | "applying" | "applied" | "canceled" | "error";

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
    }
  | {
      role: "tool_confirmation";
      id: string;
      pendingId: string;
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolConfirmationStatus;
      errorMessage?: string;
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
  // Write tools
  create_simple_chart: "criar gráfico",
  update_chart: "atualizar gráfico",
  delete_chart: "deletar gráfico",
  create_dashboard: "criar dashboard",
  update_dashboard: "atualizar dashboard",
  delete_dashboard: "deletar dashboard",
  attach_charts_to_dashboard: "anexar gráficos ao dashboard",
  build_dashboard_layout: "ajustar layout do dashboard",
  create_dataset: "criar dataset",
  delete_dataset: "deletar dataset",
  refresh_dataset: "atualizar dataset",
  execute_sql: "executar SQL",
  grant_dataset_to_role: "conceder permissão",
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

// ─── ToolConfirmationCard ─────────────────────────────────────────────────────

type ToolConfirmationCardProps = {
  msg: Extract<ChatMessageType, { role: "tool_confirmation" }>;
  onConfirm: (pendingId: string, decision: "apply" | "cancel") => void;
};

function ToolConfirmationCard({ msg, onConfirm }: ToolConfirmationCardProps) {
  const isPending = msg.status === "pending";
  const isApplying = msg.status === "applying";

  return (
    <div className="mb-3 border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
        <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
          {humanizeTool(msg.name)} — vai modificar o Superset
        </span>
      </div>

      {/* Args */}
      <div className="px-3 py-2">
        <dl className="space-y-1">
          {Object.entries(msg.args).map(([key, value]) => {
            const strVal = typeof value === "string" ? value : JSON.stringify(value);
            const displayVal = strVal.length > 120 ? strVal.slice(0, 120) + "…" : strVal;
            return (
              <div key={key} className="flex gap-2 text-xs">
                <dt className="font-mono text-amber-700 dark:text-amber-400 shrink-0">{key}</dt>
                <dd className="text-amber-900 dark:text-amber-200 break-all">{displayVal}</dd>
              </div>
            );
          })}
        </dl>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-amber-500/20 flex items-center gap-2">
        {msg.status === "applied" && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <Check className="size-3" /> Aplicado
          </span>
        )}
        {msg.status === "canceled" && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <X className="size-3" /> Cancelado
          </span>
        )}
        {msg.status === "error" && (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <X className="size-3" /> {msg.errorMessage ?? "Erro"}
          </span>
        )}
        {(isPending || isApplying) && (
          <>
            {isApplying ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Aplicando…
              </span>
            ) : (
              <>
                <button
                  onClick={() => onConfirm(msg.pendingId, "apply")}
                  disabled={!isPending}
                  className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Aplicar
                </button>
                <button
                  onClick={() => onConfirm(msg.pendingId, "cancel")}
                  disabled={!isPending}
                  className="h-7 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  Cancelar
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── ChatMessage component ────────────────────────────────────────────────────

type ChatMessageItemProps = {
  msg: ChatMessageType;
  onConfirm?: (pendingId: string, decision: "apply" | "cancel") => void;
};

export function ChatMessageItem({ msg, onConfirm }: ChatMessageItemProps) {
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

  if (msg.role === "tool_confirmation") {
    return (
      <ToolConfirmationCard
        msg={msg}
        onConfirm={onConfirm ?? (() => {})}
      />
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
