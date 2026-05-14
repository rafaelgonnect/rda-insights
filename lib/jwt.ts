import { SignJWT } from "jose";
import { env } from "./env";

export async function mintMcpToken(subject: string): Promise<string> {
  const secret = new TextEncoder().encode(env.MCP_JWT_SECRET);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer(env.MCP_JWT_ISSUER)
    .setAudience(env.MCP_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}
