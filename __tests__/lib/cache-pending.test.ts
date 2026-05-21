/**
 * Roundtrip test for PendingToolCall save/get/delete via lib/cache.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Reuse the same Redis mock pattern from __tests__/unit/cache.test.ts
vi.mock("ioredis", () => {
  const store = new Map<string, string>();
  function MockRedis() {
    return {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { store.set(k, v); return "OK"; }),
      setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return "OK"; }),
      del: vi.fn(async (...keys: string[]) => {
        let count = 0;
        for (const k of keys) { if (store.delete(k)) count++; }
        return count;
      }),
      incrbyfloat: vi.fn(async (k: string, n: number) => {
        const cur = parseFloat(store.get(k) ?? "0");
        const next = cur + n;
        store.set(k, String(next));
        return String(next);
      }),
      quit: vi.fn(),
      _store: store,
    };
  }
  return { default: MockRedis };
});

import {
  savePendingToolCall,
  getPendingToolCall,
  deletePendingToolCall,
  type PendingToolCall,
} from "@/lib/cache";

function makePending(overrides?: Partial<PendingToolCall>): PendingToolCall {
  return {
    id: "test-uuid-1234",
    createdAt: Date.now(),
    messages: [
      { role: "user", content: "Cria um dashboard" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "create_dashboard", arguments: '{"dashboard_title":"Test"}' },
        }],
      },
    ],
    toolCallId: "call-1",
    toolName: "create_dashboard",
    toolArgs: { dashboard_title: "Test" },
    dashboardId: 5,
    filterContext: { region: "SP" },
    ...overrides,
  };
}

describe("PendingToolCall cache roundtrip", () => {
  it("save then get returns the same object", async () => {
    const p = makePending();
    await savePendingToolCall(p, 300);
    const got = await getPendingToolCall(p.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(p.id);
    expect(got!.toolName).toBe("create_dashboard");
    expect(got!.toolArgs).toEqual({ dashboard_title: "Test" });
    expect(got!.dashboardId).toBe(5);
    expect(got!.filterContext).toEqual({ region: "SP" });
    expect(got!.messages).toHaveLength(2);
    expect(got!.messages[0].role).toBe("user");
  });

  it("get on unknown key returns null", async () => {
    const got = await getPendingToolCall("does-not-exist");
    expect(got).toBeNull();
  });

  it("delete then get returns null", async () => {
    const p = makePending({ id: "to-delete" });
    await savePendingToolCall(p, 300);
    // Confirm it exists first
    expect(await getPendingToolCall(p.id)).not.toBeNull();
    await deletePendingToolCall(p.id);
    expect(await getPendingToolCall(p.id)).toBeNull();
  });

  it("saves without dashboardId/filterContext (optional fields)", async () => {
    const p = makePending({ id: "minimal", dashboardId: undefined, filterContext: undefined });
    await savePendingToolCall(p);
    const got = await getPendingToolCall("minimal");
    expect(got).not.toBeNull();
    expect(got!.dashboardId).toBeUndefined();
    expect(got!.filterContext).toBeUndefined();
  });

  it("messages array round-trips faithfully (including tool_calls)", async () => {
    const p = makePending({ id: "msgs-test" });
    await savePendingToolCall(p, 60);
    const got = await getPendingToolCall("msgs-test");
    expect(got!.messages[1].role).toBe("assistant");
    const assistantMsg = got!.messages[1] as {
      role: string;
      tool_calls?: { id: string; function: { name: string } }[];
    };
    expect(assistantMsg.tool_calls?.[0].function.name).toBe("create_dashboard");
  });
});
