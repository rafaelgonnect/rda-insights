import { describe, it, expect } from "vitest";
import { mintMcpToken } from "@/lib/jwt";
import { jwtVerify } from "jose";

describe("mintMcpToken", () => {
  it("mints a token with correct claims and signature", async () => {
    const token = await mintMcpToken("rda-insights-backend");
    const secret = new TextEncoder().encode(process.env.MCP_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: "claude-code-user",
      audience: "superset-mcp",
    });
    expect(payload.sub).toBe("rda-insights-backend");
    expect(payload.iss).toBe("claude-code-user");
    expect(payload.aud).toBe("superset-mcp");
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("expires within 5 minutes", async () => {
    const token = await mintMcpToken("test");
    const secret = new TextEncoder().encode(process.env.MCP_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp! - now).toBeLessThanOrEqual(5 * 60);
    expect(payload.exp! - now).toBeGreaterThan(4 * 60 + 30);
  });
});
