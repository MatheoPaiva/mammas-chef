import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { JSON_ONLY_DIRECTIVE, redactForSnippet, ParseFailureError, parseAIJson } from "../_shared/jsonResponsePrompt.ts";

import { AI_GATEWAY_URL, aiGatewayConfig, tokenBudgetField } from "../_shared/aiGateway.ts";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

// Same allowlist-validated knob as generate-meal-plan (prod secret currently "medium").
const CEREBRAS_REASONING_EFFORT = (() => {
  const v = Deno.env.get("CEREBRAS_REASONING_EFFORT");
  return v === "low" || v === "medium" || v === "high" ? v : "low";
})();

const AISLE_LABELS = [
  "Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery & Bread", "Grains & Pasta",
  "Canned & Jarred", "Oils & Condiments", "Spices & Seasonings", "Nuts & Seeds",
  "Frozen", "Snacks & Dry Goods", "Other",
];

// Strict json_schema for Cerebras constrained decoding — grammar-invalid output
// becomes impossible, and the aisle enum pins the exact labels the frontend
// groups by. Never sent on the Gateway path (Vercel Gateway 400s on
// response_format for gpt-4.1-mini — see MEMORY.md).
const SHOPPING_LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          // Echo id (D-19): the CLIENT assigns this before the call (17-03),
          // so it always exists on every input item — required-non-nullable
          // is correct here, unlike AI-emitted nullable fields elsewhere in
          // this codebase's strict schemas. The client re-attaches `sources`
          // by matching this id after humanization; a mismatched/dropped id
          // just means no trace row for that item (graceful degradation).
          id: { type: "string" },
          name: { type: "string" },
          quantity: { type: "string" },
          aisle: { type: "string", enum: AISLE_LABELS },
        },
        required: ["id", "name", "quantity", "aisle"],
      },
    },
  },
  required: ["items"],
};

const SYSTEM_PROMPT = `You are converting recipe-aggregated ingredient totals into a human-friendly grocery list.

Rules:
1. Round ALL quantities UP to the nearest practical store unit:
   - Volume totals → real containers: "1 container (10 oz) hummus", "1 can (6 oz) tomato paste", "1 half gallon milk", "1 pt heavy cream"
   - Spice/herb traces (under 1 tsp total) → omit quantity (use empty string ""), just list the item name
   - Weight → nearest 0.5 lb increment, minimum 0.5 lb (e.g. "1.5 lbs chicken thighs")
   - Eggs → dozens (e.g. "1 dozen eggs")
   - Butter → sticks (1 stick = 0.5 cup = 8 tbsp; round up to whole sticks)
   - Cheese → nearest common block/bag size (e.g. "1 block (8 oz) feta", "1 bag (8 oz) shredded mozzarella")
   - Produce sold by piece/bunch: "2 bunches cilantro", "1 head garlic", "1 bag (5 oz) spinach", "3 bell peppers"
   - Grains/legumes sold in bags: "1 bag (1 lb) brown rice", "1 can (15 oz) chickpeas"
2. Use store-friendly phrasing throughout: no decimals, no fractions, no recipe-math units
3. Assign each item to the most logical aisle using ONLY these exact labels:
   Produce | Meat & Seafood | Dairy & Eggs | Bakery & Bread | Grains & Pasta | Canned & Jarred | Oils & Condiments | Spices & Seasonings | Nuts & Seeds | Frozen | Snacks & Dry Goods | Other
4. Sort items by store flow: Produce → Meat & Seafood → Dairy & Eggs → Bakery & Bread → Grains & Pasta → Canned & Jarred → Oils & Condiments → Spices & Seasonings → Nuts & Seeds → Frozen → Snacks & Dry Goods → Other
5. Every input item carries an "id". Echo each item's "id" back UNCHANGED on its corresponding output item — do NOT renumber, reassign, merge, or omit ids, even when combining similar-sounding items into one humanized line.

Return ONLY valid JSON — no markdown fences, no explanation text:
{ "items": [{ "id": "string", "name": "string", "quantity": "string", "aisle": "string" }] }`;

const SHOPPING_LIST_ONE_SHOT_EXAMPLE = `# Minimal Example Response (shape only — do not copy values):

{"items":[{"id":"i1","name":"chicken thighs","quantity":"1.5 lbs","aisle":"Meat & Seafood"},{"id":"i2","name":"feta","quantity":"1 block (8 oz)","aisle":"Dairy & Eggs"}]}`;

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
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "items array is required and must not be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cerebras direct is the default engine (matches generate-meal-plan);
    // Gateway fallback when the key is absent = one-env rollback.
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
    const endpoint = isCerebras ? CEREBRAS_API_URL : AI_GATEWAY_URL;
    const requestModel = isCerebras ? AI_MODEL.slice("cerebras/".length) : AI_MODEL;

    const userMessage = `Convert these aggregated recipe ingredients to a store-ready shopping list:\n\n${JSON.stringify(items, null, 2)}`;

    const finalSystemPrompt =
      SYSTEM_PROMPT + "\n\n" + SHOPPING_LIST_ONE_SHOT_EXAMPLE + "\n\n" + JSON_ONLY_DIRECTIVE;

    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: requestModel,
        messages: [
          { role: "system", content: finalSystemPrompt },
          { role: "user", content: userMessage },
        ],
        // Cerebras reasoning tokens count against max_completion_tokens, so the
        // ceiling is raised there; the Gateway path keeps its original budget.
        ...(isCerebras
          ? {
              max_completion_tokens: 16384,
              reasoning_effort: CEREBRAS_REASONING_EFFORT,
              response_format: {
                type: "json_schema",
                json_schema: { name: "shopping_list", strict: true, schema: SHOPPING_LIST_SCHEMA },
              },
            }
          : tokenBudgetField(AI_MODEL, 4096)),
        stream: false,
      }),
    };

    // Single retry on transient errors: 5xx, network error, or Cerebras
    // structured-output nondeterminism (400 wrong_api_format — a fresh sample
    // usually adheres; see generate-meal-plan). Do NOT retry on timeout aborts
    // (the 60s AbortSignal.timeout) or other 4xx — those are deterministic.
    async function callAIGatewayWithRetry(init: RequestInit): Promise<Response> {
      try {
        const r = await fetch(endpoint, init);
        if (r.status >= 500 && r.status < 600) {
          console.warn("generate-shopping-list retry", { status: r.status, attempt: 2 });
          await new Promise((res) => setTimeout(res, 500));
          return await fetch(endpoint, init);
        }
        if (r.status === 400 && (await r.clone().text()).includes("wrong_api_format")) {
          console.warn("generate-shopping-list retry", { status: 400, reason: "wrong_api_format", attempt: 2 });
          await new Promise((res) => setTimeout(res, 500));
          return await fetch(endpoint, init);
        }
        return r;
      } catch (err) {
        // Don't retry user-cancelled aborts or our own timeout abort.
        if ((err as { name?: string })?.name === "AbortError") throw err;
        console.warn("generate-shopping-list retry", { error: (err as Error)?.message, attempt: 2 });
        await new Promise((res) => setTimeout(res, 500));
        return await fetch(endpoint, init);
      }
    }

    const response = await callAIGatewayWithRetry(requestInit);

    if (!response.ok) {
      const text = await response.text();
      console.error("AI provider error:", response.status, text.slice(0, 500));
      if (response.status === 401) throw new Error("AI API key is invalid or missing permissions.");
      throw new Error(`AI service error (${response.status}): ${text.slice(0, 300)}`);
    }

    const aiResponse = await response.json();
    let content: string = aiResponse.choices?.[0]?.message?.content ?? "";

    if (aiResponse.choices?.[0]?.finish_reason === "length") {
      throw new ParseFailureError(
        "AI response truncated (finish_reason: length)",
        redactForSnippet(content, 400),
      );
    }

    const parsed = parseAIJson(content, { label: "generate-shopping-list" });

    const humanizedItems = Array.isArray(parsed?.items) ? parsed.items : [];

    return new Response(
      JSON.stringify({ items: humanizedItems }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-shopping-list error:", e);
    if (e instanceof ParseFailureError) {
      return new Response(
        JSON.stringify({
          error: "AI response was malformed — please try again.",
          parseErrorSnippet: e.snippet,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
