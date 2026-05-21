"use client";
import { useRef, useEffect, KeyboardEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertCircle, Send, Square, CheckCircle2 } from "lucide-react";
import { useChatSession } from "@/lib/use-chat-session";
import { ChatMessageItem } from "@/components/ChatMessage";

// ─── Example prompts ──────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "Dashboard de NBA com top scorers",
  "Quero ver o gap entre escolas",
  "Painel de avaliações BNCC",
];

// ─── HomeChat ─────────────────────────────────────────────────────────────────

export function HomeChat() {
  const session = useChatSession({
    mode: "create",
    storageKey: "chat:create",
  });

  const {
    messages,
    input,
    setInput,
    streaming,
    error,
    clearError,
    submit,
    stop,
    confirm,
    createdDashboardId,
    createdDashboardTitle,
  } = session;

  // DOM refs
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const hasMessages = messages.length > 0;

  // Auto-scroll to bottom as new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-grow textarea
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    const maxH = 200;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    autoGrow(e.target);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!streaming && input.trim()) {
        void submit(input.trim());
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
    }
  }

  function handleSubmit() {
    if (!input.trim() || streaming) return;
    void submit(input.trim());
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleExampleClick(prompt: string) {
    setInput(prompt);
    textareaRef.current?.focus();
  }

  return (
    <Card className="max-w-3xl mx-auto p-6 flex flex-col gap-4">
      {/* Title + description (shown before first message) */}
      {!hasMessages && (
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Criar um novo dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Conte o que você quer analisar e a IA vai buscar os dados, criar os
            gráficos e montar o painel automaticamente.
          </p>
        </div>
      )}

      {/* Sticky "Dashboard created" banner */}
      {createdDashboardId !== null && (
        <div className="flex items-center gap-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-500/40 px-4 py-3">
          <CheckCircle2 className="size-5 text-green-600 dark:text-green-400 shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-200 flex-1 min-w-0 truncate">
            {createdDashboardTitle
              ? `Dashboard "${createdDashboardTitle}" criado!`
              : "Dashboard criado com sucesso!"}
          </span>
          <Link
            href={`/d/${createdDashboardId}`}
            className="shrink-0 h-8 px-4 rounded-md bg-green-700 hover:bg-green-800 text-white text-sm font-medium inline-flex items-center transition-colors"
          >
            Abrir dashboard
          </Link>
        </div>
      )}

      {/* Message thread (shown after first submit) */}
      {hasMessages && (
        <div className="flex flex-col gap-0 max-h-[520px] overflow-y-auto pr-1">
          {messages.map((msg) => (
            <ChatMessageItem
              key={
                msg.role === "tool_activity"
                  ? msg.toolCallId
                  : msg.role === "tool_confirmation"
                  ? msg.id
                  : (msg as { id: string }).id
              }
              msg={msg}
              onConfirm={confirm}
            />
          ))}

          {error && (
            <div className="mb-3 p-3 rounded-lg border border-destructive/40 bg-destructive/5 flex gap-2 items-start">
              <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-destructive break-words">{error}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 h-7"
                  onClick={clearError}
                >
                  Fechar
                </Button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}

      {/* Input area */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={hasMessages ? 1 : 3}
            className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50 min-h-[2.25rem]"
            style={{ minHeight: hasMessages ? "2.25rem" : "5rem" }}
            placeholder={
              hasMessages
                ? "Continue a conversa…"
                : "Ex: Quero um dashboard mostrando as notas médias por escola e a taxa de presença"
            }
            value={input}
            disabled={streaming}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          {streaming ? (
            <Button
              size="icon-sm"
              variant="outline"
              onClick={stop}
              title="Parar"
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              disabled={!input.trim()}
              onClick={handleSubmit}
              title="Enviar (Ctrl+Enter)"
            >
              <Send className="size-3.5" />
            </Button>
          )}
        </div>

        {/* Example prompts (only before first message) */}
        {!hasMessages && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground font-medium">Exemplos:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className="text-xs px-3 py-1.5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => handleExampleClick(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
