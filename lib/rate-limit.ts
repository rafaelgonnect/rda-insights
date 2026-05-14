const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 30;
const buckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSec?: number } {
  const cutoff = now - WINDOW_MS;
  const timestamps = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= LIMIT) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    buckets.set(key, timestamps);
    return { allowed: false, retryAfterSec };
  }
  timestamps.push(now);
  buckets.set(key, timestamps);
  return { allowed: true };
}

export function _reset() {
  buckets.clear();
}
