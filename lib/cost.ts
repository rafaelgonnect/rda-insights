type Pricing = { inputPerM: number; outputPerM: number };

const PRICING: Record<string, Pricing> = {
  "claude-sonnet-4-6": { inputPerM: 3, outputPerM: 15 },
  "claude-opus-4-7": { inputPerM: 15, outputPerM: 75 },
  "claude-haiku-4-5": { inputPerM: 1, outputPerM: 5 },
};

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (tokensIn * p.inputPerM + tokensOut * p.outputPerM) / 1_000_000;
}
