import { describe, it, expect, beforeEach, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock("ioredis", () => {
  function MockRedis() {
    return {
      async get(k: string) {
        return store.get(k) ?? null;
      },
      async set(k: string, v: string) {
        store.set(k, v);
        return "OK";
      },
      async setex(k: string, _ttl: number, v: string) {
        store.set(k, v);
        return "OK";
      },
      quit() {},
    };
  }
  return { default: MockRedis };
});

import { getSettings, setSettings } from "@/lib/settings";

describe("settings", () => {
  beforeEach(() => store.clear());

  it("getSettings returns defaults when Redis is empty", async () => {
    const s = await getSettings();
    expect(s.model).toBe("anthropic/claude-sonnet-4.5"); // from vitest.setup.ts OPENROUTER_MODEL
    expect(s.maxTokens).toBe(600);
    expect(s.maxUsdMonth).toBe(20);
  });

  it("setSettings persists and getSettings reads them back", async () => {
    await setSettings({ model: "openai/gpt-4o", maxTokens: 1200 });
    const s = await getSettings();
    expect(s.model).toBe("openai/gpt-4o");
    expect(s.maxTokens).toBe(1200);
    expect(s.maxUsdMonth).toBe(20); // unchanged
  });

  it("setSettings merges partial updates", async () => {
    await setSettings({ model: "google/gemini-2.5-pro" });
    await setSettings({ maxUsdMonth: 50 });
    const s = await getSettings();
    expect(s.model).toBe("google/gemini-2.5-pro");
    expect(s.maxUsdMonth).toBe(50);
  });

  it("getSettings falls back to defaults when stored JSON is corrupted", async () => {
    store.set("settings:v1", "{not valid json");
    const s = await getSettings();
    expect(s.model).toBe("anthropic/claude-sonnet-4.5");
  });
});
