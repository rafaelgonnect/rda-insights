import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage + window mock (node env) ──────────────────────────────────

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};

Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock, addEventListener: vi.fn() },
  writable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});
Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` },
  writable: true,
});

import {
  listSessions,
  getSession,
  createSession,
  updateSession,
  renameSession,
  deleteSession,
  loadSessionMessages,
  saveSessionMessages,
  setAutostart,
  takeAutostart,
  subscribe,
} from "@/lib/chat-sessions";
import type { ChatMessageType } from "@/components/ChatMessage";

beforeEach(() => store.clear());

describe("chat-sessions metadata", () => {
  it("starts with an empty list", () => {
    expect(listSessions()).toEqual([]);
  });

  it("creates a session with a truncated title and returns its meta", () => {
    const meta = createSession({ title: "Quero um dashboard de NBA com top scorers", mode: "create" });
    expect(meta.id).toBeTruthy();
    expect(meta.mode).toBe("create");
    expect(getSession(meta.id)?.title).toBe("Quero um dashboard de NBA com top scorers");
    expect(listSessions()).toHaveLength(1);
  });

  it("truncates very long titles with an ellipsis", () => {
    const long = "a".repeat(120);
    const meta = createSession({ title: long });
    expect(getSession(meta.id)!.title.length).toBeLessThanOrEqual(61);
    expect(getSession(meta.id)!.title.endsWith("…")).toBe(true);
  });

  it("falls back to 'Novo chat' for empty titles", () => {
    const meta = createSession({ title: "   " });
    expect(getSession(meta.id)?.title).toBe("Novo chat");
  });

  it("sorts sessions most-recently-updated first", () => {
    // Control time so updatedAt comparisons are deterministic (ms resolution
    // otherwise ties when ops run in the same millisecond).
    let t = 1000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => (t += 1000));
    try {
      const a = createSession({ title: "first" });
      const b = createSession({ title: "second" });
      updateSession(a.id, { createdDashboardId: 42 }); // bumps a to most recent
      const sorted = listSessions();
      expect(sorted[0].id).toBe(a.id);
      expect(sorted[1].id).toBe(b.id);
    } finally {
      spy.mockRestore();
    }
  });

  it("updates metadata and bumps updatedAt", () => {
    const meta = createSession({ title: "x" });
    const before = getSession(meta.id)!.updatedAt;
    updateSession(meta.id, { createdDashboardId: 7, createdDashboardTitle: "NBA" });
    const after = getSession(meta.id)!;
    expect(after.createdDashboardId).toBe(7);
    expect(after.createdDashboardTitle).toBe("NBA");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("renames a session", () => {
    const meta = createSession({ title: "old" });
    renameSession(meta.id, "novo nome");
    expect(getSession(meta.id)?.title).toBe("novo nome");
  });

  it("deletes a session and its messages + autostart", () => {
    const meta = createSession({ title: "del" });
    saveSessionMessages(meta.id, [{ role: "user", content: "hi", id: "u1", createdAt: 1 }]);
    setAutostart(meta.id, "hi");
    deleteSession(meta.id);
    expect(getSession(meta.id)).toBeNull();
    expect(loadSessionMessages(meta.id)).toEqual([]);
    expect(takeAutostart(meta.id)).toBeNull();
  });
});

describe("chat-sessions messages", () => {
  it("saves and loads messages per session", () => {
    const meta = createSession({ title: "m" });
    const msgs: ChatMessageType[] = [
      { role: "user", content: "hello", id: "u1", createdAt: 1 },
      { role: "assistant", content: "hi", id: "a1", createdAt: 2, toolCalls: [] },
    ];
    saveSessionMessages(meta.id, msgs);
    expect(loadSessionMessages(meta.id)).toEqual(msgs);
  });

  it("isolates messages between sessions", () => {
    const a = createSession({ title: "a" });
    const b = createSession({ title: "b" });
    saveSessionMessages(a.id, [{ role: "user", content: "AAA", id: "u1", createdAt: 1 }]);
    saveSessionMessages(b.id, [{ role: "user", content: "BBB", id: "u2", createdAt: 1 }]);
    expect((loadSessionMessages(a.id)[0] as { content: string }).content).toBe("AAA");
    expect((loadSessionMessages(b.id)[0] as { content: string }).content).toBe("BBB");
  });
});

describe("chat-sessions autostart handoff", () => {
  it("takeAutostart returns the prompt once then clears it", () => {
    const meta = createSession({ title: "as" });
    setAutostart(meta.id, "comece isso");
    expect(takeAutostart(meta.id)).toBe("comece isso");
    expect(takeAutostart(meta.id)).toBeNull();
  });
});

describe("chat-sessions subscribe", () => {
  it("notifies listeners on mutation", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    createSession({ title: "notif" });
    expect(cb).toHaveBeenCalled();
    unsub();
    cb.mockClear();
    createSession({ title: "after unsub" });
    expect(cb).not.toHaveBeenCalled();
  });
});
