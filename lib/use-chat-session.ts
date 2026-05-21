"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { streamPostSse } from "@/lib/sse-client";
import type { ChatMessageType, ToolCallEvent } from "@/components/ChatMessage";

// ─── Types ────────────────────────────────────────────────────────────────────

type HistoryEntry = { role: "user" | "assistant"; content: string };

const MAX_HISTORY = 20;

function loadMessages(storageKey: string): ChatMessageType[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessageType[];
  } catch {
    return [];
  }
}

function saveMessages(storageKey: string, messages: ChatMessageType[]) {
  if (typeof window === "undefined") return;
  try {
    const keep = messages.slice(-MAX_HISTORY);
    localStorage.setItem(storageKey, JSON.stringify(keep));
  } catch {
    // quota exceeded — ignore
  }
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseChatSessionOpts {
  mode: "dashboard" | "create";
  dashboardId?: number;
  filterContext?: Record<string, unknown> | null;
  storageKey: string;
  apiUrl?: string;
  confirmUrl?: string;
  initialMessages?: ChatMessageType[];
}

export interface UseChatSessionResult {
  messages: ChatMessageType[];
  input: string;
  setInput: (v: string) => void;
  streaming: boolean;
  error: string | null;
  clearError: () => void;
  submit: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  confirm: (pendingId: string, decision: "apply" | "cancel") => Promise<void>;
  createdDashboardId: number | null;
  createdDashboardTitle: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChatSession(opts: UseChatSessionOpts): UseChatSessionResult {
  const {
    mode,
    dashboardId,
    filterContext,
    storageKey,
    apiUrl = "/api/chat",
    confirmUrl = "/api/chat/confirm",
    initialMessages,
  } = opts;

  const [messages, setMessages] = useState<ChatMessageType[]>(
    initialMessages ?? []
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdDashboardId, setCreatedDashboardId] = useState<number | null>(null);
  const [createdDashboardTitle, setCreatedDashboardTitle] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);

  // Hydrate from localStorage on mount (once)
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (initialMessages && initialMessages.length > 0) return;
    const stored = loadMessages(storageKey);
    if (stored.length > 0) setMessages(stored);
  }, [storageKey, initialMessages]);

  // Persist on change
  useEffect(() => {
    if (messages.length > 0) saveMessages(storageKey, messages);
  }, [messages, storageKey]);

  const clearError = useCallback(() => setError(null), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
    if (typeof window !== "undefined") {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  // ─── Shared SSE event handlers ──────────────────────────────────────────────

  function makeAppendDelta(assistantId: string) {
    return (delta: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && m.id === assistantId
            ? { ...m, content: m.content + delta }
            : m
        )
      );
    };
  }

  function makeUpsertToolCall(assistantId: string) {
    return (tc: Partial<ToolCallEvent> & { id: string }) => {
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
    };
  }

  // ─── submit ──────────────────────────────────────────────────────────────────

  const submit = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;
      setInput("");
      setError(null);

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

      // Capture current messages for history before updating state
      setMessages((prev) => {
        const historyEntries: HistoryEntry[] = prev
          .filter(
            (m): m is Extract<ChatMessageType, { role: "user" | "assistant" }> =>
              m.role === "user" || m.role === "assistant"
          )
          .slice(-MAX_HISTORY)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const requestBody = {
          message: text,
          mode,
          dashboard_id: dashboardId,
          filter_context: filterContext ?? undefined,
          history: historyEntries,
        };

        const ctl = new AbortController();
        abortRef.current = ctl;

        const appendDelta = makeAppendDelta(assistantId);
        const upsertToolCall = makeUpsertToolCall(assistantId);

        // Fire off the request (side-effect inside setState is intentional —
        // we need the snapshot of prev messages)
        setStreaming(true);

        streamPostSse({
          url: apiUrl,
          body: requestBody,
          signal: ctl.signal,
          onEvent(event, data) {
            const d = data as Record<string, unknown>;
            if (event === "" || event === "delta") {
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
                durationMs:
                  typeof d.durationMs === "number" ? d.durationMs : undefined,
                resultPreview:
                  typeof d.resultPreview === "string"
                    ? d.resultPreview
                    : undefined,
              });
            } else if (event === "dashboard_created") {
              const id = typeof d.id === "number" ? d.id : Number(d.id);
              const title = typeof d.title === "string" ? d.title : null;
              setCreatedDashboardId(id);
              setCreatedDashboardTitle(title);
            } else if (event === "tool_pending_confirmation") {
              const confirmMsg: ChatMessageType = {
                role: "tool_confirmation",
                id: crypto.randomUUID(),
                pendingId: String(d.pending_id),
                toolCallId: String(d.tool_call_id),
                name: String(d.name),
                args: (d.args as Record<string, unknown>) ?? {},
                status: "pending",
              };
              setMessages((p) => [...p, confirmMsg]);
              setStreaming(false);
            } else if (event === "done") {
              console.log("[chat] done", d);
            }
          },
          onClose() {
            setStreaming(false);
          },
        }).catch((e) => {
          if ((e as Error).name === "AbortError") {
            setStreaming(false);
            return;
          }
          setError(String(e));
          setStreaming(false);
        });

        return [...prev, userMsg, assistantMsg];
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming, mode, dashboardId, filterContext, apiUrl]
  );

  // ─── confirm ─────────────────────────────────────────────────────────────────

  const confirm = useCallback(
    async (pendingId: string, decision: "apply" | "cancel") => {
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "tool_confirmation" && m.pendingId === pendingId
            ? { ...m, status: decision === "apply" ? "applying" : "canceled" }
            : m
        )
      );

      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessageType = {
        role: "assistant",
        content: "",
        id: assistantId,
        createdAt: Date.now(),
        toolCalls: [],
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreaming(true);

      const ctl = new AbortController();
      abortRef.current = ctl;

      const appendDelta = makeAppendDelta(assistantId);
      const upsertToolCall = makeUpsertToolCall(assistantId);

      try {
        await streamPostSse({
          url: confirmUrl,
          body: { pending_id: pendingId, decision },
          signal: ctl.signal,
          onEvent(event, data) {
            const d = data as Record<string, unknown>;
            if (event === "" || event === "delta") {
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
                durationMs:
                  typeof d.durationMs === "number" ? d.durationMs : undefined,
                resultPreview:
                  typeof d.resultPreview === "string"
                    ? d.resultPreview
                    : undefined,
              });
            } else if (event === "dashboard_created") {
              const id = typeof d.id === "number" ? d.id : Number(d.id);
              const title = typeof d.title === "string" ? d.title : null;
              setCreatedDashboardId(id);
              setCreatedDashboardTitle(title);
            } else if (event === "tool_pending_confirmation") {
              const confirmMsg: ChatMessageType = {
                role: "tool_confirmation",
                id: crypto.randomUUID(),
                pendingId: String(d.pending_id),
                toolCallId: String(d.tool_call_id),
                name: String(d.name),
                args: (d.args as Record<string, unknown>) ?? {},
                status: "pending",
              };
              setMessages((prev) => [...prev, confirmMsg]);
              setStreaming(false);
            } else if (event === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.role === "tool_confirmation" &&
                  m.pendingId === pendingId &&
                  m.status === "applying"
                    ? { ...m, status: "applied" }
                    : m
                )
              );
              console.log("[chat.confirm] done", d);
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
        setMessages((prev) =>
          prev.map((m) =>
            m.role === "tool_confirmation" && m.pendingId === pendingId
              ? { ...m, status: "error", errorMessage: String(e) }
              : m
          )
        );
        setStreaming(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirmUrl]
  );

  return {
    messages,
    input,
    setInput,
    streaming,
    error,
    clearError,
    submit,
    stop,
    clear,
    confirm,
    createdDashboardId,
    createdDashboardTitle,
  };
}
