import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { parseAIJson } from "../_shared/jsonResponsePrompt.ts";

import { AI_GATEWAY_URL, aiGatewayConfig, tokenBudgetField } from "../_shared/aiGateway.ts";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_REASONING_EFFORT = (() => {
  const v = Deno.env.get("CEREBRAS_REASONING_EFFORT");
  return v === "low" || v === "medium" || v === "high" ? v : "low";
})();

const SYSTEM_PROMPT = `Estimate per-serving nutrition for a home recipe.

Return ONLY valid JSON with this exact shape:
{ "nutrition": { "calories": 0, "protein": 0, "carbs": 0, "fats": 0 } }

Rules:
- Values are per serving.
- calories must be a positive whole number.
- protein, carbs, and fats are grams and must be non-negative whole numbers.
- Use the provided servings count to divide the full recipe estimate.`;

function normalizeWhole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : null;
}

function normalizeNutrition(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const calories = normalizeWhole(raw.calories);
  const protein = normalizeWhole(raw.protein);
  const carbs = normalizeWhole(raw.carbs);
  const fats = normalizeWhole(raw.fats);

  if (calories == null || calories < 1 || protein == null || carbs == null || fats == null) return null;
  return { calories, protein, carbs, fats };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const userId = await verifyUser(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const servings = typeof body?.servings === "number" ? Math.round(body.servings) : 0;
    const ingredients = Array.isArray(body?.ingredients) ? body.ingredients : [];
    const steps = Array.isArray(body?.steps) ? body.steps : [];

    if (!title || servings < 1 || ingredients.length === 0 || steps.length === 0) {
      return new Response(
        JSON.stringify({ error: "title, servings, ingredients, and steps are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cerebrasKey = Deno.env.get("CEREBRAS_API_KEY");
    let API_KEY: string;
    let AI_MODEL: string;
    if (cerebrasKey && cerebrasKey.trim() !== "") {
      API_KEY = cerebrasKey;
      AI_MODEL = Deno.env.get("CEREBRAS_MODEL") || "cerebras/gpt-oss-120b";
    } else {
      ({ apiKey: API_KEY, model: AI_MODEL } = aiGatewayConfig("gpt-4.1-mini"));
    }
    const isCerebras = AI_MODEL.startsWith("cerebras/");

    const response = await fetch(isCerebras ? CEREBRAS_API_URL : AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: isCerebras ? AI_MODEL.slice("cerebras/".length) : AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({ title, servings, ingredients, steps }, null, 2),
          },
        ],
        // Cerebras reasoning tokens count against the budget, so it needs a higher ceiling.
        ...(isCerebras
          ? { max_completion_tokens: 4096, reasoning_effort: CEREBRAS_REASONING_EFFORT }
          : tokenBudgetField(AI_MODEL, 1024)),
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("AI provider error:", response.status, text.slice(0, 500));
      throw new Error(`AI service error (${response.status})`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content ?? "";
    const parsed = parseAIJson(content, { label: "estimate-custom-recipe-nutrition" });
    const nutrition = normalizeNutrition(parsed.nutrition ?? parsed);
    if (!nutrition) throw new Error("AI nutrition estimate was invalid");

    return new Response(
      JSON.stringify({ nutrition }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("estimate-custom-recipe-nutrition error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
