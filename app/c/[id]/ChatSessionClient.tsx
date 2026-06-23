"use client";
import { useState } from "react";
import { NavLink } from "@/components/NavLink";
import { CheckCircle2 } from "lucide-react";
import { useChatSession } from "@/lib/use-chat-session";
import { MessageList } from "@/components/MessageList";
import { ChatComposer } from "@/components/ChatComposer";
import {
  getSession,
  updateSession,
  type ChatSessionMode,
} from "@/lib/chat-sessions";

export function ChatSessionClient({ sessionId }: { sessionId: string }) {
  const [mode, setMode] = useState<ChatSessionMode>(
    () => getSession(sessionId)?.mode ?? "chat"
  );
  // Dashboard this session is anchored to (set once a dashboard is created),
  // so Dev-mode edits target it.
  const [dashboardId, setDashboardId] = useState<number | undefined>(
    () => getSession(sessionId)?.createdDashboardId ?? undefined
  );

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
    mode,
    dashboardId,
    sessionId,
    consumeAutostart: true,
  });

  // Once the conversation produces a dashboard, anchor Dev-mode edits to it.
  // Adjusting state during render (guarded) is React's recommended alternative
  // to a setState-in-effect; it re-runs the hook with the new dashboardId.
  if (createdDashboardId != null && createdDashboardId !== dashboardId) {
    setDashboardId(createdDashboardId);
  }

  function changeMode(m: ChatSessionMode) {
    setMode(m);
    updateSession(sessionId, { mode: m });
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-sm text-muted-foreground mt-10">
            {mode === "dev"
              ? "Modo Dev: descreva o dashboard ou a mudança que você quer e a IA aplica (com sua confirmação)."
              : "Modo Bate-papo: planeje, tire dúvidas e faça brainstorming sobre os dados."}
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
          mode={mode}
          onModeChange={changeMode}
          placeholder={
            mode === "dev"
              ? "Descreva a mudança no dashboard…"
              : "Pergunte ou planeje sobre os dados…"
          }
        />
      </div>
    </div>
  );
}
