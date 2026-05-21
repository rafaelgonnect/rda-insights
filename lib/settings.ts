import { getCached, setPersistent } from "./cache";
import { env } from "./env";

const KEY = "settings:v1";

export type Settings = {
  model: string;
  maxTokens: number;
  maxUsdMonth: number;
};

function defaults(): Settings {
  return {
    model: env.OPENROUTER_MODEL,
    maxTokens: 600,
    maxUsdMonth: env.MAX_USD_MONTH,
  };
}

export async function getSettings(): Promise<Settings> {
  const raw = await getCached(KEY);
  if (!raw) return defaults();
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...defaults(), ...parsed };
  } catch {
    return defaults();
  }
}

export async function setSettings(updates: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const merged: Settings = { ...current, ...updates };
  await setPersistent(KEY, JSON.stringify(merged));
  return merged;
}
