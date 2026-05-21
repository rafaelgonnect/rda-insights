import { describe, it, expect } from "vitest";
import { chartInsightKey, rowInsightKey } from "@/lib/cache-keys";

const M = "anthropic/claude-sonnet-4.5";

describe("cache keys", () => {
  it("chartInsightKey is deterministic with same inputs", () => {
    const k1 = chartInsightKey(42, { region: "Sul", year: 2025 }, M);
    const k2 = chartInsightKey(42, { region: "Sul", year: 2025 }, M);
    expect(k1).toBe(k2);
  });

  it("chartInsightKey is order-independent on filters", () => {
    const k1 = chartInsightKey(42, { region: "Sul", year: 2025 }, M);
    const k2 = chartInsightKey(42, { year: 2025, region: "Sul" }, M);
    expect(k1).toBe(k2);
  });

  it("chartInsightKey differs when chart_id changes", () => {
    const k1 = chartInsightKey(42, {}, M);
    const k2 = chartInsightKey(43, {}, M);
    expect(k1).not.toBe(k2);
  });

  it("chartInsightKey differs when model changes", () => {
    const k1 = chartInsightKey(42, {}, "anthropic/claude-sonnet-4.5");
    const k2 = chartInsightKey(42, {}, "openai/gpt-4o");
    expect(k1).not.toBe(k2);
  });

  it("rowInsightKey differs from chartInsightKey for same id+filters+model", () => {
    const c = chartInsightKey(42, { x: 1 }, M);
    const r = rowInsightKey(42, { x: 1 }, M);
    expect(c).not.toBe(r);
  });
});
