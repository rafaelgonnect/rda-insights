"use client";
import { NavLink } from "@/components/NavLink";
import { CheckCircle2 } from "lucide-react";
import { useChatSession } from "@/lib/use-chat-session";
import { MessageList } from "@/components/MessageList";
import { ChatComposer } from "@/components/ChatComposer";

export function ChatSessionClient({ sessionId }: { sessionId: string }) {
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
    confirm,
    createdDashboardId,
    createdDashboardTitle,
  } = useChatSession({
    mode: "create",
    sessionId,
    consumeAutostart: true,
  });

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-sm text-muted-foreground mt-10">
            Conte o que você quer analisar e a IA monta o painel.
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

      <div className="border-t bg-background/80 backdrop-blur px-4 py-3 flex flex-col gap-3">
        {createdDashboardId !== null && (
          <div className="flex items-center gap-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-500/40 px-4 py-3">
            <CheckCircle2 className="size-5 text-green-600 dark:text-green-400 shrink-0" />
            <span className="text-sm text-green-800 dark:text-green-200 flex-1 min-w-0 truncate">
              {createdDashboardTitle
                ? `Dashboard "${createdDashboardTitle}" criado!`
                : "Dashboard criado com sucesso!"}
            </span>
            <NavLink
              href={`/d/${createdDashboardId}`}
              className="shrink-0 h-8 px-4 rounded-md bg-green-700 hover:bg-green-800 text-white text-sm font-medium inline-flex items-center transition-colors"
            >
              Abrir dashboard
            </NavLink>
          </div>
        )}
        <ChatComposer
          value={input}
          onChange={setInput}
          onSubmit={submit}
          onStop={stop}
          streaming={streaming}
          autoFocus
          placeholder="Continue a conversa…"
        />
      </div>
    </div>
  );
}
