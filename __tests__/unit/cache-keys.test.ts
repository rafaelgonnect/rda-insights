import { describe, it, expect } from "vitest";
import { chartInsightKey, rowInsightKey } from "@/lib/cache-keys";

describe("cache keys", () => {
  it("chartInsightKey is deterministic with same inputs", () => {
    const k1 = chartInsightKey(42, { region: "Sul", year: 2025 });
    const k2 = chartInsightKey(42, { region: "Sul", year: 2025 });
    expect(k1).toBe(k2);
  });

  it("chartInsightKey is order-independent on filters", () => {
    const k1 = chartInsightKey(42, { region: "Sul", year: 2025 });
    const k2 = chartInsightKey(42, { year: 2025, region: "Sul" });
    expect(k1).toBe(k2);
  });

  it("chartInsightKey differs when chart_id changes", () => {
    const k1 = chartInsightKey(42, {});
    const k2 = chartInsightKey(43, {});
    expect(k1).not.toBe(k2);
  });

  it("rowInsightKey differs from chartInsightKey for same id+filters", () => {
    const c = chartInsightKey(42, { x: 1 });
    const r = rowInsightKey(42, { x: 1 });
    expect(c).not.toBe(r);
  });
});
