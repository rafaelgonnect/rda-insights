"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { streamPostSse } from "@/lib/sse-client";
import type { ChatMessageType, ToolCallEvent } from "@/components/ChatMessage";
import {
  loadSessionMessages,
  saveSessionMessages,
  getSession,
  updateSession,
  touchSession,
  takeAutostart,
} from "@/lib/chat-sessions";

// ─── Types ────────────────────────────────────────────────────────────────────

type HistoryEntry = { role: "user" | "assistant"; content: string };

const MAX_HISTORY = 20;

// Turn raw/relayed errors into a short, user-facing message. The raw error is
// always logged to the console for debugging.
function friendlyError(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e)).replace(/^(Error:\s*)+/i, "").trim();
  if (/401|unauthor|user not found|api key/i.test(raw))
    return "Falha de autenticação com o provedor de IA. Verifique a chave em Configurações.";
  if (/429|rate.?limit|cost cap|monthly/i.test(raw))
    return "Limite de uso atingido. Tente novamente em instantes.";
  if (/network|fetch failed|econn|timeout|socket/i.test(raw))
    return "Erro de conexão. Verifique sua rede e tente novamente.";
  return raw || "Algo deu errado. Tente novamente.";
}

// Legacy single-slot persistence (used by the dashboard sidebar).
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
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-MAX_HISTORY)));
  } catch {
    // quota exceeded — ignore
  }
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseChatSessionOpts {
  mode: "dashboard" | "create";
  dashboardId?: number;
  filterContext?: Record<string, unknown> | null;
  /** Legacy single-slot persistence key (dashboard sidebar). */
  storageKey?: string;
  /** Session-based persistence (home / create chats). Takes precedence. */
  sessionId?: string;
  /** If true, consume the session's handoff prompt and auto-submit it once. */
  consumeAutostart?: boolean;
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
  regenerate: () => void;
  canRegenerate: boolean;
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
    sessionId,
    consumeAutostart,
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
  const submitRef = useRef<(text: string) => void>(() => {});

  // ─── Persistence resolution (session store vs legacy slot) ──────────────────

  const persistLoad = useCallback((): ChatMessageType[] => {
    if (sessionId) return loadSessionMessages(sessionId);
    if (storageKey) return loadMessages(storageKey);
    return [];
  }, [sessionId, storageKey]);

  const persistSave = useCallback(
    (msgs: ChatMessageType[]) => {
      if (sessionId) saveSessionMessages(sessionId, msgs);
      else if (storageKey) saveMessages(storageKey, msgs);
    },
    [sessionId, storageKey]
  );

  // Hydrate from storage on mount (once). Also consumes the autostart handoff
  // prompt here (inside an effect, guarded — never during render).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (initialMessages && initialMessages.length > 0) return;
    const stored = persistLoad();
    if (stored.length > 0) setMessages(stored);
    if (sessionId) {
      const meta = getSession(sessionId);
      if (meta?.createdDashboardId != null) {
        setCreatedDashboardId(meta.createdDashboardId);
        setCreatedDashboardTitle(meta.createdDashboardTitle ?? null);
      }
      if (consumeAutostart && stored.length === 0) {
        const prompt = takeAutostart(sessionId);
        if (prompt && prompt.trim()) void submitRef.current(prompt.trim());
      }
    }
  }, [persistLoad, initialMessages, sessionId, consumeAutostart]);

  // Persist on change
  useEffect(() => {
    if (messages.length > 0) persistSave(messages);
  }, [messages, persistSave]);

  const clearError = useCallback(() => setError(null), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
    if (sessionId) saveSessionMessages(sessionId, []);
    else if (storageKey && typeof window !== "undefined") {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey, sessionId]);

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

  function handleDashboardCreated(d: Record<string, unknown>) {
    const id = typeof d.id === "number" ? d.id : Number(d.id);
    const title = typeof d.title === "string" ? d.title : null;
    setCreatedDashboardId(id);
    setCreatedDashboardTitle(title);
    if (sessionId && Number.isFinite(id)) {
      updateSession(sessionId, {
        createdDashboardId: id,
        createdDashboardTitle: title ?? undefined,
      });
    }
  }

  // Build the OpenAI-style onEvent handler shared by submit/regenerate/confirm.
  function makeOnEvent(assistantId: string, opts?: { confirmPendingId?: string }) {
    const appendDelta = makeAppendDelta(assistantId);
    const upsertToolCall = makeUpsertToolCall(assistantId);
    return (event: string, data: unknown) => {
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
          durationMs: typeof d.durationMs === "number" ? d.durationMs : undefined,
          resultPreview:
            typeof d.resultPreview === "string" ? d.resultPreview : undefined,
        });
      } else if (event === "dashboard_created") {
        handleDashboardCreated(d);
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
        if (opts?.confirmPendingId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.role === "tool_confirmation" &&
              m.pendingId === opts.confirmPendingId &&
              m.status === "applying"
                ? { ...m, status: "applied" }
                : m
            )
          );
        }
      }
    };
  }

  function newAssistantMsg(): Extract<ChatMessageType, { role: "assistant" }> {
    return {
      role: "assistant",
      content: "",
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      toolCalls: [],
    };
  }

  function historyFrom(msgs: ChatMessageType[]): HistoryEntry[] {
    return msgs
      .filter(
        (m): m is Extract<ChatMessageType, { role: "user" | "assistant" }> =>
          m.role === "user" || m.role === "assistant"
      )
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  // Fire an SSE request into an existing assistant placeholder message.
  function runStream(text: string, history: HistoryEntry[], assistantId: string) {
    const requestBody = {
      message: text,
      mode,
      dashboard_id: dashboardId,
      filter_context: filterContext ?? undefined,
      history,
    };
    const ctl = new AbortController();
    abortRef.current = ctl;
    setStreaming(true);
    streamPostSse({
      url: apiUrl,
      body: requestBody,
      signal: ctl.signal,
      onEvent: makeOnEvent(assistantId),
      onClose() {
        setStreaming(false);
      },
    }).catch((e) => {
      if ((e as Error).name === "AbortError") {
        setStreaming(false);
        return;
      }
      console.error("[chat] stream error", e);
      setError(friendlyError(e));
      setStreaming(false);
    });
  }

  // ─── submit ──────────────────────────────────────────────────────────────────

  const submit = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;
      setInput("");
      setError(null);
      if (sessionId) touchSession(sessionId);

      const userMsg: ChatMessageType = {
        role: "user",
        content: text,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      const assistant = newAssistantMsg();

      setMessages((prev) => {
        runStream(text, historyFrom(prev), assistant.id);
        return [...prev, userMsg, assistant];
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming, mode, dashboardId, filterContext, apiUrl, sessionId]
  );

  // Keep a stable ref to submit so the mount-time autostart can call it.
  submitRef.current = submit;

  // ─── regenerate ────────────────────────────────────────────────────────────
  // Re-run the last user prompt without adding a new user bubble.

  const lastUserText = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user") return m.content;
    }
    return null;
  })();

  const regenerate = useCallback(() => {
    if (streaming) return;
    setError(null);
    setMessages((prev) => {
      // Find the last user message; drop everything after it.
      let lastUserIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx < 0) return prev;
      const userMsg = prev[lastUserIdx] as Extract<ChatMessageType, { role: "user" }>;
      const kept = prev.slice(0, lastUserIdx + 1);
      const assistant = newAssistantMsg();
      // History excludes the trailing user msg (sent as `message`).
      runStream(userMsg.content, historyFrom(kept.slice(0, -1)), assistant.id);
      return [...kept, assistant];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, mode, dashboardId, filterContext, apiUrl, sessionId]);

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

      const assistant = newAssistantMsg();
      setMessages((prev) => [...prev, assistant]);
      setStreaming(true);

      const ctl = new AbortController();
      abortRef.current = ctl;

      try {
        await streamPostSse({
          url: confirmUrl,
          body: { pending_id: pendingId, decision },
          signal: ctl.signal,
          onEvent: makeOnEvent(assistant.id, { confirmPendingId: pendingId }),
          onClose() {
            setStreaming(false);
          },
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setStreaming(false);
          return;
        }
        console.error("[chat.confirm] error", e);
        setMessages((prev) =>
          prev.map((m) =>
            m.role === "tool_confirmation" && m.pendingId === pendingId
              ? { ...m, status: "error", errorMessage: friendlyError(e) }
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
    regenerate,
    canRegenerate: lastUserText !== null && !streaming,
    stop,
    clear,
    confirm,
    createdDashboardId,
    createdDashboardTitle,
  };
}
