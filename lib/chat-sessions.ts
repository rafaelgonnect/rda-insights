// Client-side chat session store backed by localStorage.
//
// A "session" is one conversation thread. Metadata lives in a single index
// (`chat:sessions:index`); the message list for each session lives under
// `chat:session:{id}`. The store exposes a subscribe() so the sidebar can
// re-render live when a session is created/renamed/deleted (same tab via an
// in-process listener set, cross-tab via the native `storage` event).

import type { ChatMessageType } from "@/components/ChatMessage";

export type ChatSessionMode = "chat" | "dev";

/** Normalize a stored mode, mapping the legacy names to the current ones
 *  (dashboard → chat, create → dev) so old localStorage sessions keep working. */
export function normalizeMode(raw: unknown): ChatSessionMode {
  if (raw === "dev" || raw === "create") return "dev";
  return "chat"; // "chat", legacy "dashboard", or anything unknown
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  mode: ChatSessionMode;
  createdAt: number;
  updatedAt: number;
  /** Dashboard this conversation is anchored to (dashboard mode). */
  dashboardId?: number;
  /** Dashboard this create-conversation produced (for the success banner). */
  createdDashboardId?: number;
  createdDashboardTitle?: string;
}

const INDEX_KEY = "chat:sessions:index";
const MAX_MESSAGES = 40;
const MAX_TITLE = 60;

const sessionKey = (id: string) => `chat:session:${id}`;
const autostartKey = (id: string) => `chat:session:${id}:autostart`;

// ─── Low-level localStorage access (SSR-safe) ───────────────────────────────

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function read<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded — ignore
  }
}

function remove(key: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ─── Pub/sub for live UI updates ────────────────────────────────────────────

const listeners = new Set<() => void>();
let storageBound = false;

function notify(): void {
  for (const cb of listeners) cb();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!storageBound && typeof window !== "undefined") {
    storageBound = true;
    window.addEventListener("storage", (e) => {
      if (e.key === INDEX_KEY || e.key === null) notify();
    });
  }
  return () => {
    listeners.delete(cb);
  };
}

// ─── Index helpers ──────────────────────────────────────────────────────────

function readIndex(): ChatSessionMeta[] {
  const list = read<ChatSessionMeta[]>(INDEX_KEY, []);
  if (!Array.isArray(list)) return [];
  // Normalize legacy mode names (create/dashboard) on the way out.
  return list.map((s) => ({ ...s, mode: normalizeMode(s.mode) }));
}

function writeIndex(list: ChatSessionMeta[]): void {
  write(INDEX_KEY, list);
  notify();
}

function makeTitle(seed: string): string {
  const t = seed.trim().replace(/\s+/g, " ");
  if (!t) return "Novo chat";
  return t.length > MAX_TITLE ? t.slice(0, MAX_TITLE).trimEnd() + "…" : t;
}

// ─── Public API: metadata ───────────────────────────────────────────────────

/** Sessions sorted most-recently-updated first. */
export function listSessions(): ChatSessionMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): ChatSessionMeta | null {
  return readIndex().find((s) => s.id === id) ?? null;
}

export function createSession(opts: {
  title?: string;
  mode?: ChatSessionMode;
  dashboardId?: number;
  id?: string;
}): ChatSessionMeta {
  const now = Date.now();
  const meta: ChatSessionMeta = {
    id: opts.id ?? (typeof crypto !== "undefined" ? crypto.randomUUID() : String(now)),
    title: makeTitle(opts.title ?? ""),
    mode: opts.mode ?? "chat",
    createdAt: now,
    updatedAt: now,
    dashboardId: opts.dashboardId,
  };
  writeIndex([meta, ...readIndex().filter((s) => s.id !== meta.id)]);
  return meta;
}

export function updateSession(id: string, patch: Partial<Omit<ChatSessionMeta, "id">>): void {
  const list = readIndex();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
  writeIndex(list);
}

export function renameSession(id: string, title: string): void {
  updateSession(id, { title: makeTitle(title) });
}

export function touchSession(id: string): void {
  updateSession(id, {});
}

export function deleteSession(id: string): void {
  writeIndex(readIndex().filter((s) => s.id !== id));
  remove(sessionKey(id));
  remove(autostartKey(id));
}

// ─── Public API: messages ─────────────────────────────────────────────────────

export function loadSessionMessages(id: string): ChatMessageType[] {
  return read<ChatMessageType[]>(sessionKey(id), []);
}

export function saveSessionMessages(id: string, messages: ChatMessageType[]): void {
  write(sessionKey(id), messages.slice(-MAX_MESSAGES));
}

// ─── Public API: autostart handoff ────────────────────────────────────────────
// The home launcher stashes the first prompt here, then navigates to /c/{id};
// the chat page consumes it once and kicks off the stream.

export function setAutostart(id: string, prompt: string): void {
  write(autostartKey(id), prompt);
}

export function takeAutostart(id: string): string | null {
  const raw = read<string | null>(autostartKey(id), null);
  if (raw) remove(autostartKey(id));
  return typeof raw === "string" ? raw : null;
}
