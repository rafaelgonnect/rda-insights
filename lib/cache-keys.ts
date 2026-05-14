import { createHash } from "crypto";

function stableStringify(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = obj[k];
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export function chartInsightKey(chartId: number, filters: Record<string, unknown>): string {
  return `insight:chart:${chartId}:${sha256(stableStringify(filters))}`;
}

export function rowInsightKey(chartId: number, filterValues: Record<string, unknown>): string {
  return `insight:row:${chartId}:${sha256(stableStringify(filterValues))}`;
}
