"use client";
import {
  useRef,
  useEffect,
  useCallback,
  KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AlertCircle, Send, Square } from "lucide-react";
import { useChatSession } from "@/lib/use-chat-session";
import {
  ChatMessageItem,
} from "@/components/ChatMessage";

// ─── Constants ────────────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "Resuma este painel",
  "Quais gráficos têm filtro de ano?",
  "Mostre uma amostra do dataset principal",
];

// ─── ChatSidebar ──────────────────────────────────────────────────────────────

export function ChatSidebar({
  dashboardId,
  charts,
  pendingFilter,
}: {
  dashboardId: number;
  charts: { id: number; slice_name: string }[];
  pendingFilter: { chartId: number; filterValues: Record<string, unknown> } | null;
}) {
  const session = useChatSession({
    mode: "dashboard",
    dashboardId,
    filterContext: pendingFilter?.filterValues ?? null,
    storageKey: `chat:dashboard:${dashboardId}`,
  });

  const { messages, input, setInput, streaming, error, clearError, submit, stop, clear, confirm } = session;

  // DOM-specific refs (not in hook)
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isPinnedRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to bottom when pinned
  useEffect(() => {
    if (isPinnedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Track scroll position to detect "scrolled up"
  const handleScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const nearBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 60;
    isPinnedRef.current = nearBottom;
  }, []);

  // Auto-grow textarea
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    const lineH = 20;
    const maxH = lineH * 6;
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
        isPinnedRef.current = true;
        void submit(input.trim());
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
    }
  }

  function handleSubmitClick() {
    isPinnedRef.current = true;
    void submit(input.trim());
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function fillFromFilter() {
    if (!pendingFilter) return;
    const vals = Object.entries(pendingFilter.filterValues)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    setInput(`Explica essa seleção: ${vals}`);
    textareaRef.current?.focus();
  }

  const hasMessages = messages.filter((m) => m.role !== "tool_activity").length > 0;

  return (
    <aside className="w-96 border-l flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-semibold text-sm">Chat IA</h2>
          <p className="text-xs text-muted-foreground">Dashboard #{dashboardId}</p>
        </div>
        <Button
          size="xs"
          variant="ghost"
          onClick={clear}
          disabled={streaming}
          className="text-xs"
        >
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
        <div
          ref={(el) => {
            if (el) {
              const vp = el.querySelector<HTMLDivElement>(
                "[data-slot='scroll-area-viewport']"
              );
              if (vp && vp !== viewportRef.current) {
                viewportRef.current = vp;
                vp.addEventListener("scroll", handleScroll, { passive: true });
              }
            }
          }}
        >
          <div className="p-3">
            {!hasMessages && !streaming && (
              <div className="flex flex-col items-center gap-3 mt-8 text-center">
                <p className="text-xs text-muted-foreground">
                  Faça uma pergunta sobre este dashboard
                </p>
                <div className="flex flex-col gap-1.5 w-full">
                  {EXAMPLE_PROMPTS.map((prompt) => (
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
              <Card className="p-3 border-destructive mb-2 flex gap-2 items-start">
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
              </Card>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t shrink-0 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          rows={1}
          className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50 min-h-[2.25rem] max-h-[7.5rem]"
          placeholder="Pergunte sobre o dashboard…"
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
            onClick={handleSubmitClick}
            title="Enviar (Ctrl+Enter)"
          >
            <Send className="size-3.5" />
          </Button>
        )}
      </div>
    </aside>
  );
}
