import { z } from "zod";

const schema = z.object({
  APP_USERNAME: z.string().min(1),
  APP_PASSWORD: z.string().min(8),
  OPENROUTER_API_KEY: z.string().startsWith("sk-"),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4.5"),

  // Superset — public URL is used by the iframe in the browser.
  // INTERNAL_URL is used by the backend to call Superset's REST API; it can
  // be the public URL OR an internal Docker hostname (e.g. http://superset:8088)
  // when this app runs as a sibling in the same Docker network.
  SUPERSET_URL: z.string().url(),
  SUPERSET_INTERNAL_URL: z.string().url().optional(),
  SUPERSET_USERNAME: z.string().min(1),
  SUPERSET_PASSWORD: z.string().min(1),

  REDIS_URL: z.string().url(),
  MAX_USD_MONTH: z.coerce.number().positive().default(20),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
