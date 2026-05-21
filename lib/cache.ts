import Redis from "ioredis";
import { env } from "./env";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";

let _client: Redis | null = null;

function client(): Redis {
  if (!_client) {
    _client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
  }
  return _client;
}

export async function getCached(key: string): Promise<string | null> {
  try {
    return await client().get(key);
  } catch (e) {
    console.warn(JSON.stringify({ event: "cache.get.fail", key, err: String(e) }));
    return null;
  }
}

export async function setCached(key: string, value: string, ttlSec: number): Promise<void> {
  try {
    await client().setex(key, ttlSec, value);
  } catch (e) {
    console.warn(JSON.stringify({ event: "cache.set.fail", key, err: String(e) }));
  }
}

export async function setPersistent(key: string, value: string): Promise<void> {
  try {
    await client().set(key, value);
  } catch (e) {
    console.warn(JSON.stringify({ event: "cache.setp.fail", key, err: String(e) }));
  }
}

export async function incrCost(month: string, usd: number): Promise<void> {
  try {
    await client().incrbyfloat(`monthly_cost:${month}`, usd);
  } catch (e) {
    console.warn(JSON.stringify({ event: "cost.incr.fail", month, err: String(e) }));
  }
}

export async function getMonthlyCost(month: string): Promise<number> {
  const v = await getCached(`monthly_cost:${month}`);
  return v ? parseFloat(v) : 0;
}

export function currentMonthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ─── Pending tool call state (Fase 4 write-tool confirmation) ────────────────

export interface PendingToolCall {
  id: string;
  createdAt: number;
  /** Full conversation history at the pause point, including the assistant
   *  message that carries the tool_call so the LLM context is intact. */
  messages: ChatCompletionMessageParam[];
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  dashboardId?: number;
  filterContext?: Record<string, unknown>;
}

const PENDING_PREFIX = "pending_tool:";

export async function savePendingToolCall(p: PendingToolCall, ttlSec = 300): Promise<void> {
  try {
    await client().setex(`${PENDING_PREFIX}${p.id}`, ttlSec, JSON.stringify(p));
  } catch (e) {
    console.warn(JSON.stringify({ event: "pending_tool.save.fail", id: p.id, err: String(e) }));
  }
}

export async function getPendingToolCall(id: string): Promise<PendingToolCall | null> {
  try {
    const raw = await client().get(`${PENDING_PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw) as PendingToolCall;
  } catch (e) {
    console.warn(JSON.stringify({ event: "pending_tool.get.fail", id, err: String(e) }));
    return null;
  }
}

export async function deletePendingToolCall(id: string): Promise<void> {
  try {
    await client().del(`${PENDING_PREFIX}${id}`);
  } catch (e) {
    console.warn(JSON.stringify({ event: "pending_tool.delete.fail", id, err: String(e) }));
  }
}
