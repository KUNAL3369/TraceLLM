const PRICING = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  "gpt-4o": { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
  "gpt-4-turbo": { input: 10.00 / 1_000_000, output: 30.00 / 1_000_000 },
  "claude-3-haiku-20240307": { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  "claude-3-sonnet-20240229": { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
  "claude-3-opus-20240229": { input: 15.00 / 1_000_000, output: 75.00 / 1_000_000 },
  "llama3-70b-8192": { input: 0.59 / 1_000_000, output: 0.79 / 1_000_000 },
  "llama3-8b-8192": { input: 0.05 / 1_000_000, output: 0.08 / 1_000_000 },
  "mixtral-8x7b-32768": { input: 0.27 / 1_000_000, output: 0.27 / 1_000_000 },
  "gemini-1.5-flash": { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 },
  default: { input: 0.50 / 1_000_000, output: 1.50 / 1_000_000 },
};

export function estimateCost(model, promptTokens, completionTokens) {
  const rates = PRICING[model] || PRICING.default;
  const inputCost = (promptTokens || 0) * rates.input;
  const outputCost = (completionTokens || 0) * rates.output;
  return inputCost + outputCost;
}

export function estimateTotalCost(logs) {
  return logs.reduce((total, log) => {
    return total + estimateCost(log.model, log.prompt_tokens, log.completion_tokens);
  }, 0);
}

export function formatCost(cents) {
  if (cents < 0.01) return "<$0.01";
  return `$${cents.toFixed(4)}`;
}
