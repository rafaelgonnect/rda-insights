"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useChatSession } from "@/lib/use-chat-session";
import { MessageList } from "@/components/MessageList";
import { ChatComposer } from "@/components/ChatComposer";
import type { ChatSessionMode } from "@/lib/chat-sessions";

const EXAMPLE_PROMPTS: Record<ChatSessionMode, string[]> = {
  chat: [
    "Resuma este painel",
    "Quais gráficos têm filtro de ano?",
    "Mostre uma amostra do dataset principal",
  ],
  dev: [
    "Adicione um gráfico de barras de notas por escola",
    "Mude o título do dashboard",
    "Troque o gráfico de pizza por uma tabela",
  ],
};

export function ChatSidebar({
  dashboardId,
  pendingFilter,
  onDashboardMutated,
}: {
  dashboardId: number;
  pendingFilter: { chartId: number; filterValues: Record<string, unknown> } | null;
  onDashboardMutated?: (d: { dashboardId: number; tool?: string }) => void;
}) {
  const [mode, setMode] = useState<ChatSessionMode>("chat");
  const {
    messages,
    input,
    setInput,
    streaming,
    error,
    clearError,
    submit,
    regenerate,
    stop,
    clear,
    confirm,
  } = useChatSession({
    mode,
    dashboardId,
    filterContext: pendingFilter?.filterValues ?? null,
    onDashboardMutated,
    storageKey: `chat:dashboard:${dashboardId}`,
  });

  const hasMessages = messages.filter((m) => m.role !== "tool_activity").length > 0;

  function fillFromFilter() {
    if (!pendingFilter) return;
    const vals = Object.entries(pendingFilter.filterValues)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    setInput(`Explica essa seleção: ${vals}`);
  }

  return (
    <aside className="w-96 border-l flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-semibold text-sm">Colab Insights</h2>
          <p className="text-xs text-muted-foreground">Dashboard #{dashboardId}</p>
        </div>
        <Button size="xs" variant="ghost" onClick={clear} disabled={streaming} className="text-xs">
          Limpar
        </Button>
      </div>

      {/* Pending filter chip */}
      {pendingFilter && (
        <div className="px-3 py-2 border-b shrink-0 flex items-center gap-2">
          <Badge variant="secondary" className="text-xs shrink-0">
            Filtro ativo
          </Badge>
          <span className="text-xs text-muted-foreground truncate">
            {Object.entries(pendingFilter.filterValues)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(", ")}
          </span>
          <Button
            size="xs"
            variant="outline"
            className="shrink-0 text-xs"
            onClick={fillFromFilter}
            disabled={streaming}
          >
            Perguntar
          </Button>
        </div>
      )}

      {/* Message list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          {!hasMessages && !streaming && (
            <div className="flex flex-col items-center gap-3 mt-8 text-center">
              <p className="text-xs text-muted-foreground">
                {mode === "dev"
                  ? "Descreva uma mudança neste dashboard"
                  : "Faça uma pergunta sobre este dashboard"}
              </p>
              <div className="flex flex-col gap-1.5 w-full">
                {EXAMPLE_PROMPTS[mode].map((prompt) => (
                  <button
                    key={prompt}
                    className="text-xs px-3 py-1.5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-left"
                    onClick={() => setInput(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <MessageList
            messages={messages}
            streaming={streaming}
            error={error}
            clearError={clearError}
            onConfirm={confirm}
            onRegenerate={regenerate}
          />
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t shrink-0">
        <ChatComposer
          value={input}
          onChange={setInput}
          onSubmit={submit}
          onStop={stop}
          streaming={streaming}
          maxHeight={120}
          mode={mode}
          onModeChange={setMode}
          placeholder={
            mode === "dev"
              ? "Descreva a mudança no dashboard…"
              : "Pergunte sobre o dashboard…"
          }
        />
      </div>
    </aside>
  );
}
