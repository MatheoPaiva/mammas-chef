/**
 * Shared config for the OpenAI-compatible AI provider used by the edge functions.
 * Any service with a /chat/completions endpoint works: set AI_BASE_URL, AI_API_KEY
 * and AI_MODEL. Cerebras has its own path (CEREBRAS_API_KEY) in each function
 * because it adds strict JSON schemas; this config is used when that key is absent.
 */

const AI_BASE_URL = (Deno.env.get("AI_BASE_URL")?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");

export const AI_GATEWAY_URL = `${AI_BASE_URL}/chat/completions`;

const DEFAULT_MAX_OUTPUT_TOKENS = 32768;

/** Resolve the key and model. Throws when no key is present. */
export function aiGatewayConfig(defaultModel: string): { apiKey: string; model: string } {
  const apiKey = Deno.env.get("AI_API_KEY")?.trim();
  if (!apiKey) throw new Error("AI_API_KEY is not configured. Set it in supabase/functions/.env.");
  const model = Deno.env.get("AI_MODEL")?.trim() || defaultModel;
  return { apiKey, model };
}

/**
 * The token-budget field: Anthropic models use `max_tokens`, everything else
 * `max_completion_tokens`. Models reject budgets above their own output limit,
 * so `budget` is capped at AI_MAX_OUTPUT_TOKENS.
 */
export function tokenBudgetField(model: string, budget: number): Record<string, number> {
  const configured = Number(Deno.env.get("AI_MAX_OUTPUT_TOKENS"));
  const cap = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_OUTPUT_TOKENS;
  const capped = Math.min(budget, cap);
  return model.startsWith("anthropic/")
    ? { max_tokens: capped }
    : { max_completion_tokens: capped };
}
