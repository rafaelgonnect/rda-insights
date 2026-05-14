import { describe, it, expect } from "vitest";
import { validateBasicAuth } from "@/lib/auth";

describe("validateBasicAuth", () => {
  it("accepts correct credentials", () => {
    // vitest.setup.ts sets APP_USERNAME=test, APP_PASSWORD=testpassword
    const header = "Basic " + btoa("test:testpassword");
    expect(validateBasicAuth(header)).toBe(true);
  });

  it("rejects wrong password", () => {
    const header = "Basic " + btoa("test:wrong");
    expect(validateBasicAuth(header)).toBe(false);
  });

  it("rejects malformed header", () => {
    expect(validateBasicAuth(null)).toBe(false);
    expect(validateBasicAuth("Bearer xxx")).toBe(false);
    expect(validateBasicAuth("Basic notbase64!")).toBe(false);
  });
});
