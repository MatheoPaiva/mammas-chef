import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aiGatewayConfig, tokenBudgetField } from "./aiGateway.ts";

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.keys(values).map((k) => [k, Deno.env.get(k)] as const);
  for (const [k, v] of Object.entries(values)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  try {
    fn();
  } finally {
    for (const [k, v] of saved) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
}

Deno.test("aiGatewayConfig reads AI_API_KEY and AI_MODEL, with the caller's default model", () => {
  withEnv({ AI_API_KEY: "k", AI_MODEL: undefined }, () => {
    assertEquals(aiGatewayConfig("fallback"), { apiKey: "k", model: "fallback" });
  });
  withEnv({ AI_API_KEY: "k", AI_MODEL: "chosen" }, () => {
    assertEquals(aiGatewayConfig("fallback").model, "chosen");
  });
});

Deno.test("aiGatewayConfig throws without AI_API_KEY, ignoring provider-specific keys", () => {
  withEnv({ AI_API_KEY: undefined, OPENAI_API_KEY: "x", AI_GATEWAY_API_KEY: "y" }, () => {
    assertThrows(() => aiGatewayConfig("m"), Error, "AI_API_KEY");
  });
});

Deno.test("tokenBudgetField caps budgets, honoring a valid AI_MAX_OUTPUT_TOKENS", () => {
  withEnv({ AI_MAX_OUTPUT_TOKENS: undefined }, () => {
    assertEquals(tokenBudgetField("gpt", 60000), { max_completion_tokens: 32768 });
    assertEquals(tokenBudgetField("gpt", 1024), { max_completion_tokens: 1024 });
    assertEquals(tokenBudgetField("anthropic/x", 60000), { max_tokens: 32768 });
  });
  withEnv({ AI_MAX_OUTPUT_TOKENS: "16384" }, () => {
    assertEquals(tokenBudgetField("gpt", 60000), { max_completion_tokens: 16384 });
  });
  withEnv({ AI_MAX_OUTPUT_TOKENS: "nonsense" }, () => {
    assertEquals(tokenBudgetField("gpt", 60000), { max_completion_tokens: 32768 });
  });
});
