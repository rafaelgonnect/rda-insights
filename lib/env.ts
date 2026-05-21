import { z } from "zod";

const schema = z.object({
  APP_USERNAME: z.string().min(1),
  APP_PASSWORD: z.string().min(8),
  OPENROUTER_API_KEY: z.string().startsWith("sk-"),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4.5"),
  MCP_INTERNAL_URL: z.string().url(),
  MCP_JWT_SECRET: z.string().min(32),
  MCP_JWT_ISSUER: z.string().default("claude-code-user"),
  MCP_JWT_AUDIENCE: z.string().default("superset-mcp"),
  SUPERSET_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MAX_USD_MONTH: z.coerce.number().positive().default(20),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
