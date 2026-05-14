import { describe, it, expect, vi } from "vitest";

vi.mock("ioredis", () => {
  const store = new Map<string, string>();
  // Must be a regular function (not arrow) so `new Redis(...)` works.
  // See https://vitest.dev/api/vi#vi-spyon — `vi.fn` wrapping an arrow can't be `new`-ed.
  function MockRedis() {
    return {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { store.set(k, v); return "OK"; }),
      setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return "OK"; }),
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

import { getCached, setCached, incrCost, getMonthlyCost } from "@/lib/cache";

describe("cache", () => {
  it("setCached then getCached returns the value", async () => {
    await setCached("k1", "hello", 60);
    expect(await getCached("k1")).toBe("hello");
  });

  it("missing key returns null", async () => {
    expect(await getCached("missing")).toBeNull();
  });

  it("incrCost accumulates monthly cost", async () => {
    const month = "2026-05";
    await incrCost(month, 0.01);
    await incrCost(month, 0.02);
    const total = await getMonthlyCost(month);
    expect(total).toBeCloseTo(0.03, 6);
  });
});
