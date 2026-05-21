type Pricing = { inputPerM: number; outputPerM: number };

// OpenRouter model slugs. Prices are approximate (OpenRouter usually mirrors
// upstream provider pricing; small markup may apply). Used for the monthly
// cost cap — slightly conservative is fine, the cap is a safety net.
const PRICING: Record<string, Pricing> = {
  // Anthropic via OpenRouter
  "anthropic/claude-sonnet-4.5": { inputPerM: 3, outputPerM: 15 },
  "anthropic/claude-sonnet-4": { inputPerM: 3, outputPerM: 15 },
  "anthropic/claude-opus-4.1": { inputPerM: 15, outputPerM: 75 },
  "anthropic/claude-3.5-sonnet": { inputPerM: 3, outputPerM: 15 },
  "anthropic/claude-3.5-haiku": { inputPerM: 1, outputPerM: 5 },
  // OpenAI via OpenRouter
  "openai/gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
  "openai/gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "openai/gpt-5": { inputPerM: 5, outputPerM: 20 },
  // Google via OpenRouter
  "google/gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10 },
  "google/gemini-2.5-flash": { inputPerM: 0.075, outputPerM: 0.3 },
};

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (tokensIn * p.inputPerM + tokensOut * p.outputPerM) / 1_000_000;
}
