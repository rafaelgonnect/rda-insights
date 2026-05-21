import Redis from "ioredis";
import { env } from "./env";

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
