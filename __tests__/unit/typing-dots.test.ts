/**
 * Smoke test for TypingDots — verifies the export is a callable function
 * (React component). Full render tests require jsdom; this project uses
 * node environment, so we test the structural contract only.
 */
import { describe, it, expect } from "vitest";
import { TypingDots } from "@/components/ChatMessage";

describe("TypingDots", () => {
  it("is a function (React component)", () => {
    expect(typeof TypingDots).toBe("function");
  });

  it("returns a non-null value when called (basic JSX check)", () => {
    // Call it in a minimal way — we can't render to DOM in node env,
    // but we can confirm the function doesn't throw and returns something.
    // We mock React.createElement to avoid the JSX transform needing a DOM.
    const React = { createElement: (...args: unknown[]) => args };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (TypingDots as any)();
    // Should return a React element (object with type/props) — not null/undefined
    expect(result).toBeTruthy();
  });
});
