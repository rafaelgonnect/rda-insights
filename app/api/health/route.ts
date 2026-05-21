import { NextResponse } from "next/server";
import Redis from "ioredis";
import { McpClient } from "@/lib/mcp";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = { mcp: "down", openrouter: "skipped", redis: "down" };

  try {
    await new McpClient().getHealth();
    status.mcp = "up";
  } catch {}

  try {
    const r = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
    await r.ping();
    await r.quit();
    status.redis = "up";
  } catch {}

  status.openrouter = env.OPENROUTER_API_KEY ? "configured" : "missing";
  const allOk =
    status.mcp === "up" && status.redis === "up" && status.openrouter === "configured";

  return NextResponse.json({ ok: allOk, ...status }, { status: allOk ? 200 : 503 });
}
