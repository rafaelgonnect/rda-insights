"use client";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AlertCircle, Loader2, Send, Square } from "lucide-react";
import { streamPostSse } from "@/lib/sse-client";
import {
  ChatMessageItem,
  ChatMessageType,
  ToolCallEvent,
  humanizeTool,
} from "@/components/ChatMessage";

// ─── Types ────────────────────────────────────────────────────────────────────

type HistoryEntry = { role: "user" | "assistant"; content: string };

const EXAMPLE_PROMPTS = [
  "Resuma este painel",
  "Quais gráficos têm filtro de ano?",
  "Mostre uma amostra do dataset principal",
];

const MAX_HISTORY = 20;
const STORAGE_KEY = (id: number) => `chat:${id}`;

function loadHistory(dashboardId: number): ChatMessageType[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY(dashboardId));
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessageType[];
  } catch {
    return [];
  }
}

function saveHistory(dashboardId: number, messages: ChatMessageType[]) {
  if (typeof window === "undefined") return;
  try {
    const keep = messages.slice(-MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY(dashboardId), JSON.stringify(keep));
  } catch {
    // quota exceeded — ignore
  }
}

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
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isPinnedRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = loadHistory(dashboardId);
    if (stored.length > 0) setMessages(stored);
  }, [dashboardId]);

  // Persist on change
  useEffect(() => {
    if (messages.length > 0) saveHistory(dashboardId, messages);
  }, [messages, dashboardId]);

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
      if (!streaming && input.trim()) void submit(input.trim());
    }
  }

  function clearChat() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
    if (typeof window !== "undefined")
      localStorage.removeItem(STORAGE_KEY(dashboardId));
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  function fillFromFilter() {
    if (!pendingFilter) return;
    const vals = Object.entries(pendingFilter.filterValues)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    setInput(`Explica essa seleção: ${vals}`);
    textareaRef.current?.focus();
  }

  async function submit(text: string) {
    if (!text.trim() || streaming) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setError(null);
    isPinnedRef.current = true;

    const userMsg: ChatMessageType = {
      role: "user",
      content: text,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessageType = {
      role: "assistant",
      content: "",
      id: assistantId,
      createdAt: Date.now(),
      toolCalls: [],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const ctl = new AbortController();
    abortRef.current = ctl;

    // Build history from current messages (before this turn)
    const historyEntries: HistoryEntry[] = messages
      .filter((m): m is Extract<ChatMessageType, { role: "user" | "assistant" }> =>
        m.role === "user" || m.role === "assistant"
      )
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const requestBody = {
      message: text,
      dashboard_id: dashboardId,
      filter_context: pendingFilter?.filterValues ?? undefined,
      history: historyEntries,
    };

    // Helpers to mutate the assistant message in state
    function appendDelta(delta: string) {
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && m.id === assistantId
            ? { ...m, content: m.content + delta }
            : m
        )
      );
    }

    function upsertToolCall(tc: Partial<ToolCallEvent> & { id: string }) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.role !== "assistant" || m.id !== assistantId) return m;
          const existing = m.toolCalls.find((t) => t.id === tc.id);
          if (existing) {
            return {
              ...m,
              toolCalls: m.toolCalls.map((t) =>
                t.id === tc.id ? { ...t, ...tc } : t
              ),
            };
          }
          // new tool call
          const newTc: ToolCallEvent = {
            id: tc.id,
            name: tc.name ?? "",
            args: tc.args ?? {},
            status: tc.status ?? "running",
            durationMs: tc.durationMs,
            resultPreview: tc.resultPreview,
          };
          return { ...m, toolCalls: [...m.toolCalls, newTc] };
        })
      );
    }

    try {
      await streamPostSse({
        url: "/api/chat",
        body: requestBody,
        signal: ctl.signal,
        onEvent(event, data) {
          const d = data as Record<string, unknown>;
          if (event === "" || event === "delta") {
            // default block → text delta
            if (typeof d.text === "string") appendDelta(d.text);
          } else if (event === "tool_call_start") {
            upsertToolCall({
              id: String(d.id),
              name: String(d.name),
              args: (d.args as Record<string, unknown>) ?? {},
              status: "running",
            });
          } else if (event === "tool_call_end") {
            upsertToolCall({
              id: String(d.id),
              status: d.ok ? "ok" : "error",
              durationMs: typeof d.durationMs === "number" ? d.durationMs : undefined,
              resultPreview: typeof d.resultPreview === "string" ? d.resultPreview : undefined,
            });
          } else if (event === "done") {
            console.log("[chat] done", d);
          }
        },
        onClose() {
          setStreaming(false);
        },
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setStreaming(false);
        return;
      }
      setError(String(e));
      setStreaming(false);
    }
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
          onClick={clearChat}
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
            // Attach scroll listener to the inner viewport element
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
              <ChatMessageItem key={msg.role === "tool_activity" ? msg.toolCallId : (msg as { id: string }).id} msg={msg} />
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
                    onClick={() => setError(null)}
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
            onClick={stopStreaming}
            title="Parar"
          >
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            disabled={!input.trim()}
            onClick={() => void submit(input.trim())}
            title="Enviar (Ctrl+Enter)"
          >
            <Send className="size-3.5" />
          </Button>
        )}
      </div>
    </aside>
  );
}
