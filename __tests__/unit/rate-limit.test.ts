import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, _reset } from "@/lib/rate-limit";

describe("rate limit (30/hour per key)", () => {
  beforeEach(() => _reset());

  it("allows the first 30 requests", () => {
    for (let i = 0; i < 30; i++) {
      const r = checkRateLimit("user1", Date.now());
      expect(r.allowed).toBe(true);
    }
  });

  it("rejects the 31st request with retry-after", () => {
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) checkRateLimit("user1", t0);
    const r = checkRateLimit("user1", t0);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("isolates keys", () => {
    const t = Date.now();
    for (let i = 0; i < 30; i++) checkRateLimit("user1", t);
    const r = checkRateLimit("user2", t);
    expect(r.allowed).toBe(true);
  });

  it("evicts entries older than 1 hour", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) checkRateLimit("user1", t0);
    expect(checkRateLimit("user1", t0).allowed).toBe(false);
    expect(checkRateLimit("user1", t0 + 60 * 60 * 1000 + 1).allowed).toBe(true);
  });
});
