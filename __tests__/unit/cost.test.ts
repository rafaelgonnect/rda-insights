import { describe, it, expect } from "vitest";
import { calculateCost } from "@/lib/cost";

describe("calculateCost", () => {
  it("calculates anthropic/claude-sonnet-4.5 via OpenRouter correctly", () => {
    const cost = calculateCost("anthropic/claude-sonnet-4.5", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3 + 15, 2);
  });

  it("returns 0 for unknown model", () => {
    expect(calculateCost("unknown-model", 1000, 1000)).toBe(0);
  });

  it("scales linearly with tokens", () => {
    const small = calculateCost("anthropic/claude-sonnet-4.5", 1000, 1000);
    const big = calculateCost("anthropic/claude-sonnet-4.5", 10000, 10000);
    expect(big).toBeCloseTo(small * 10, 6);
  });
});
