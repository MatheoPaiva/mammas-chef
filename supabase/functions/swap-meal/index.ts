import { sanitizeInput } from "../_shared/sanitize.ts";
import { buildPersonalization } from "../_shared/personalization.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { releaseAction, reserveAction } from "../_shared/rateLimit.ts";
import { validateSwapSchema } from "../_shared/schemas.ts";
import { checkAllergens, markAllergenCautions } from "../_shared/allergens.ts";
import { validateSwapMeal } from "../_shared/validation.ts";
import { withRetry } from "../_shared/retry.ts";
import { scaleMealToServings } from "../_shared/servingScaler.ts";
import { keepUnrelatedPrepTips, mergePrepTipDelta, nightBeforeDay } from "../_shared/prepTipMerge.ts";
import { JSON_ONLY_DIRECTIVE, redactForSnippet, ParseFailureError, parseAIJson } from "../_shared/jsonResponsePrompt.ts";

import { AI_GATEWAY_URL, aiGatewayConfig, tokenBudgetField } from "../_shared/aiGateway.ts";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

// Same allowlist-validated knob as generate-meal-plan / generate-shopping-list
// (prod secret currently "medium").
const CEREBRAS_REASONING_EFFORT = (() => {
  const v = Deno.env.get("CEREBRAS_REASONING_EFFORT");
  return v === "low" || v === "medium" || v === "high" ? v : "low";
})();

// Strict json_schema for Cerebras constrained decoding — grammar-invalid
// output becomes impossible. Only ever sent on the Cerebras path (Vercel
// Gateway 400s on response_format for gpt-4.1-mini — see MEMORY.md).
//
// SWAP_SCHEMA is the model-facing wrapper (newMeal + newPrepTips +
// newShoppingItems), NOT a bare meal object. The model emits newPrepTips (0-2
// tips about the new meal only); the edge merges it into the client contract's
// updatedPrepTips after the AI call (see src/lib/mealPlanParser.ts
// isSwapResponseShape, which still requires newMeal + newShoppingItems).
const INGREDIENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    quantity: { type: ["number", "string"] },
    unit: { type: "string" },
    prep: { type: ["string", "null"] },
  },
  required: ["name", "quantity", "unit", "prep"],
};

const MEAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
    prepTime: { type: "string" },
    servings: { type: "number" },
    calories: { type: "number" },
    protein: { type: "number" },
    carbs: { type: "number" },
    fats: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
    ingredients: { type: "array", items: INGREDIENT_SCHEMA },
    steps: { type: "array", items: { type: "string" } },
    toddlerTip: { type: ["string", "null"] },
    glucoseTip: { type: ["string", "null"] },
    flavorNotes: { type: "string" },
    // NEW for Phase 15 — 2-value enum ONLY, leftover EXCLUDED (Pitfall 3: this
    // schema structurally omits source_meal_id, so it cannot express which
    // earlier meal a leftover came from — grammar-forbid the value rather than
    // allow an unanchorable leftover badge).
    status: { type: ["string", "null"], enum: ["fresh", "prep-linked", null] },
    cautionNote: { type: ["string", "null"] },
    workflow: { type: ["string", "null"] },
    storage: { type: ["string", "null"] },
    cookTime: { type: ["string", "null"] },
    totalTime: { type: ["string", "null"] },
  },
  required: [
    "id", "title", "mealType", "prepTime", "servings", "calories", "protein",
    "carbs", "fats", "tags", "ingredients", "steps", "toddlerTip", "glucoseTip",
    "flavorNotes",
    "status", "cautionNote", "workflow", "storage", "cookTime", "totalTime",
  ],
};

// The model writes ONLY the delta for the new meal; days, ids and the rest of
// the week's tips are assigned/kept server-side (_shared/prepTipMerge.ts).
const NEW_PREP_TIPS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prepDayTask: { type: ["string", "null"] },
    nightBeforeTip: { type: ["string", "null"] },
  },
  required: ["prepDayTask", "nightBeforeTip"],
};

const SHOPPING_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    quantity: { type: "string" },
    aisle: { type: "string" },
  },
  required: ["name", "quantity", "aisle"],
};

const SWAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    newMeal: MEAL_SCHEMA,
    newPrepTips: NEW_PREP_TIPS_SCHEMA,
    newShoppingItems: { type: "array", items: SHOPPING_ITEM_SCHEMA },
  },
  required: ["newMeal", "newPrepTips", "newShoppingItems"],
};

// Strict mode makes the model emit explicit nulls for nullable optionals
// (toddlerTip/glucoseTip/ingredient prep). Recursively drop null-valued keys
// so downstream code (normalizeMeal / scaleMealToServings / validateSwapMeal /
// client parser) sees the absent-key shape it already expects.
function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripNulls(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out as T;
  }
  return value;
}

// Token-budget audit (AI-03 / D-11): a single-recipe swap returns one full
// recipe (structured ingredients + steps + flavorNotes + toddlerTip +
// glucoseTip, plus at most two new prep tips for the new meal). The
// prior ceiling could be exceeded (Sentry 7551197203/164 cut off
// mid-ingredients). BASE is ~2x; the truncation-retry bump is ~3x — both
// comfortably cover one recipe + its new prep tips and stay well under any
// model context limit.
const SWAP_BASE_TOKENS = 8192;
const SWAP_RETRY_TOKENS = 12288;

/**
 * Raised when the AI response is truncated (finish_reason "length" or the
 * balanced-brace extractor never finds a closing brace). Distinct from
 * ParseFailureError so the truncation retry + truncation-specific toast can be
 * keyed off the error type (AI-03 / D-10 / D-12).
 */
class TruncationError extends Error {
  snippet?: string;
  constructor(message: string, snippet?: string) {
    super(message);
    this.name = "TruncationError";
    this.snippet = snippet;
  }
}

// D-07 (Phase 17): this prompt's dormant "# Leftover/Reheat Meals" block was
// removed — swap-meal's status rule below already forbids a "leftover"
// status (this schema has no source_meal_id field), so that block was
// unreachable/contradictory once the batch-consumption model landed (it told
// the model to mirror a source's ingredients, which no swap replacement can
// structurally do here). The Food Safety section's general freeze/thaw
// guidance is unaffected and stays as the food-safety source of truth for
// this file.
const BASE_SYSTEM_PROMPT = `# Role & Context

You are **Mamma's Chef** — an AI personal chef for families with toddlers and adults. Generate a SINGLE replacement meal for one slot in an existing 7-day plan. Respond with ONLY valid JSON — no markdown, no code fences, no explanation text.

# JSON Structure

{
  "newMeal": {
    "id": "swap-unique-id", "title": "Dish Name",
    "mealType": "breakfast|lunch|dinner|snack",
    "prepTime": "25 min", "servings": 4,
    "calories": 380, "protein": 28, "carbs": 32, "fats": 14,
    "tags": ["Toddler-Friendly"],
    "ingredients": [
      { "name": "chicken thighs", "quantity": 1.5, "unit": "lbs" },
      { "name": "diced tomatoes", "quantity": 2, "unit": "cups" }
    ],
    "steps": ["Step 1", "Step 2"],
    "toddlerTip": "...", "glucoseTip": "...", "flavorNotes": "...",
    "status": "fresh|prep-linked", "cautionNote": "...or null", "workflow": "...", "storage": "...",
    "cookTime": "20 min", "totalTime": "35 min"
  },
  "newPrepTips": {
    "prepDayTask": "Specific prep-day task for the new meal (~time), or null",
    "nightBeforeTip": "5-10 min night-before task that names the new meal, or null"
  },
  "newShoppingItems": [
    { "name": "Chicken thighs", "quantity": "1.5 lbs", "aisle": "Meat & Seafood" }
  ]
}

# Recipe Quality

- ≥3 herbs/spices per recipe beyond salt, pepper, and oil. Steps describe when and how each is applied.
- Every recipe includes "flavorNotes": one sentence on the dish's dominant flavor profile.
- Steps are specific: "sear 3 min per side until golden crust" not "cook until done."
- Prep actions must match the food type: wash fresh produce only — never wash breads, wraps, tortillas, or dry goods.
- Toddler-safe: soft textures, mild flavors, finger-food options. No choking hazards.

# Ingredient Quantity Standards (per serving minimums)

All ingredient quantities MUST be realistic for the stated serving count:
- Proteins: ≥6 oz raw meat/poultry/fish, ≥4 oz tofu/tempeh, ≥2 eggs per serving
- Grains/pasta: ≥0.5 cups cooked per serving
- Multiply by servings to get the total. Example: 4 servings × 6 oz = 1.5 lbs minimum.
- All ingredient quantities must use US customary units (cups, tbsp, tsp, oz, lbs). Never use grams, kilograms, or milliliters.

# Meal Time Slots (strictly enforced)

- Breakfast (≤15 min): Quick or make-ahead — oats, egg muffins, smoothies, yogurt, toast.
- Lunch (≤15 min): Assembly or reheat ONLY — wraps, bowls, pitas, salads, quesadillas. Never cook raw protein.
- Dinner (≤40 min): The one real cooking event — searing, roasting, simmering.
- Snack (≤5 min, zero cooking): Grab-and-go — fruit, hummus+veggies, cheese+crackers, energy bites, yogurt.

# Prep-Ahead Recipes (energy bites, egg muffins, overnight oats, etc.)

When a breakfast or snack is prepped ahead:
- Ingredients MUST list ALL raw ingredients with exact quantities. NEVER self-reference like "6 energy bites (from Sunday)." The ingredient list drives the shopping list.
- First step: "If prepped on [prep day], simply grab from the fridge." Then full from-scratch steps.

# Food Safety (fridge shelf life)

- Proteins: 3 days. Grains: 4 days. Vegetables: 4 days. Sauces/dressings: 5–7 days.
- Beyond the window: freeze on prep day (prepDayTask), and put the thaw reminder for THIS meal in nightBeforeTip.

# Status, Caution & Time Fields — Required on the Replacement Meal

- "status" MUST be set to "fresh" (cook-from-scratch) or "prep-linked" (uses a batch/prep component). NEVER set status to a reheated-earlier-meal value — this schema has no source_meal_id field, so a replacement meal cannot structurally prove where it reheats from. If the replacement would naturally be a reheat of an earlier meal, make it a fresh meal with full raw ingredients and real cooking steps instead.
- "cautionNote": a short hazard reason ONLY when a real concern exists (toddler choking risk, high sodium, spice level) — otherwise null. Terse, sentence-fragment style, no exclamation marks. Example: "High sodium — not toddler-suitable".
- "workflow": one terse-imperative line describing how the meal comes together. Examples: "Cook fresh. No prep dependency." / "Uses Sunday Prep Batch cooked quinoa."
- "storage": one terse-imperative line on how to store the meal. Example: "Refrigerate up to 4 days."
- "cookTime" and "totalTime": free-text, same "N min" convention as prepTime (e.g. "20 min") — do NOT invent a tighter/compact format for these fields.

For any of these 5 fields that does not apply, use null — never omit the key.

# New Meal Rules

- Match the required mealType and follow its time slot complexity rules.
- Must NOT repeat any existing meal in the plan.
- Every ingredient: exact quantity and unit. newShoppingItems: only ingredients for the new meal.
- Scale servings to household size from user preferences.
- Non-zero calories, protein, carbs, AND fats — zero values are never acceptable.

# New Prep Tips Rules (the new meal ONLY)

- The app keeps the rest of the week's prep plan as-is. Never restate, rewrite or mention other meals or days.
- prepDayTask: one prep-day task when part of the new meal can be made ahead. Give the action, a "(~N min)" estimate, and freeze/thaw if the meal is eaten 4+ days after the prep day. Otherwise null.
- nightBeforeTip: one 5-10 min night-before task that names the new meal (thaw, marinate, chop). Otherwise null.

# Ingredient Format

Each ingredient MUST be a JSON object: { "name": "chicken thighs", "quantity": 2, "unit": "lbs", "prep": "bone-in" }
- quantity may be a number (2) or fraction string ("1 1/2")
- unit is empty string "" if the ingredient has no unit (e.g. "eggs", "garlic cloves")
- prep is optional — use for cut/temp descriptors like "minced", "bone-in", "diced"`;

const EXAMPLE_RECIPE = `

# Quality Example

Here is ONE example of the quality bar every recipe must meet. Do NOT copy this recipe — use it only as a reference for seasoning depth, step specificity, and flavorNotes style:

{
  "id": "example-zaatar-chicken",
  "title": "Za'atar Chicken Thighs with Lemon-Herb Yogurt",
  "mealType": "dinner",
  "prepTime": "35 min",
  "servings": 4,
  "calories": 410,
  "protein": 35,
  "carbs": 12,
  "fats": 26,
  "tags": ["High Protein", "Toddler-Friendly", "Mediterranean"],
  "ingredients": [
    { "name": "chicken thighs", "quantity": 2, "unit": "lbs", "prep": "bone-in" },
    { "name": "za'atar", "quantity": 2, "unit": "tbsp" },
    { "name": "smoked paprika", "quantity": 1, "unit": "tsp" },
    { "name": "ground cumin", "quantity": 1, "unit": "tsp" },
    { "name": "ground coriander", "quantity": "1/2", "unit": "tsp" },
    { "name": "garlic", "quantity": 4, "unit": "cloves", "prep": "minced" },
    { "name": "extra-virgin olive oil", "quantity": 3, "unit": "tbsp" },
    { "name": "lemon", "quantity": 1, "unit": "", "prep": "zested and juiced" },
    { "name": "full-fat Greek yogurt", "quantity": 1, "unit": "cup" },
    { "name": "fresh mint", "quantity": 2, "unit": "tbsp", "prep": "finely chopped" },
    { "name": "fresh dill", "quantity": 1, "unit": "tbsp", "prep": "chopped" },
    { "name": "sumac", "quantity": "1/2", "unit": "tsp" },
    { "name": "kosher salt", "quantity": "", "unit": "" },
    { "name": "black pepper", "quantity": "", "unit": "" }
  ],
  "steps": [
    "Pat chicken thighs dry. Combine za'atar, smoked paprika, cumin, coriander, half the garlic, and 2 tbsp olive oil. Rub mixture under and over the skin. Season with salt and pepper. Let marinate 15 minutes (or overnight in the fridge).",
    "Preheat oven to 425°F. Heat remaining 1 tbsp oil in an oven-safe skillet over medium-high heat. Sear chicken skin-side down for 5 minutes until the skin is deeply golden and crisp.",
    "Flip chicken and transfer skillet to oven. Roast 18–20 minutes until internal temp reaches 165°F and juices run clear.",
    "While chicken roasts, stir together yogurt, lemon zest, 1 tbsp lemon juice, remaining garlic, mint, dill, and sumac. Season with a pinch of salt.",
    "Rest chicken 5 minutes. Serve with a generous spoonful of lemon-herb yogurt and an extra squeeze of lemon over the top."
  ],
  "toddlerTip": "Shred the chicken off the bone and serve with yogurt sauce for dipping — the mild tang is toddler-approved.",
  "glucoseTip": "Pair with a side of roasted cauliflower or leafy greens to keep the meal low-glycemic.",
  "flavorNotes": "Earthy za'atar and smoky paprika crust meets bright lemon-mint yogurt — a balance of warmth and freshness in every bite."
}`;

const SWAP_ONE_SHOT_EXAMPLE = `

# Example Response Shape (minimal — do not copy values, this only shows the JSON structure):

{
  "newMeal": {
    "id": "swap-example-1",
    "title": "Example Dish",
    "mealType": "dinner",
    "prepTime": "30 min",
    "servings": 4,
    "calories": 400,
    "protein": 30,
    "carbs": 35,
    "fats": 15,
    "tags": ["Toddler-Friendly"],
    "ingredients": [
      { "name": "example ingredient", "quantity": 1, "unit": "lb" }
    ],
    "steps": ["Single example step."],
    "toddlerTip": "Example toddler tip.",
    "glucoseTip": "Example glucose tip.",
    "flavorNotes": "Example flavor notes.",
    "status": "fresh",
    "cautionNote": null,
    "workflow": "Cook fresh. No prep dependency.",
    "storage": "Refrigerate up to 4 days.",
    "cookTime": "20 min",
    "totalTime": "30 min"
  },
  "newPrepTips": {
    "prepDayTask": "Example prep-day task for the new dish (~30 min).",
    "nightBeforeTip": null
  },
  "newShoppingItems": [
    { "name": "Example ingredient", "quantity": "1 lb", "aisle": "Meat & Seafood" }
  ]
}`;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let reservationId: string | null = null;
  try {
    // Server-side auth: verify JWT via Supabase Auth (gateway verify_jwt disabled)
    const userId = await verifyUser(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    // dependentSource (D-11, additive/optional): when the outgoing meal is a
    // leftover SOURCE, the client (17-06) sends { count, servingsSum } —
    // the number of dependent leftover meals elsewhere in the plan that
    // consume portions from it, and their combined servings. Absent on
    // every non-source swap and on pre-17-06 clients — degrades to no-op.
    // skipSlots (additive/optional): lets the night-before tip land on the
    // previous ACTIVE cook night; absent => calendar adjacency.
    const { oldMeal, dayLabel, mealType, remainingMeals, currentPrepTips, hint, dependentSource, skipSlots } = body;

    // Cerebras direct is the default engine (matches generate-meal-plan /
    // generate-shopping-list); Gateway fallback when the key is absent = one-env
    // rollback (unset CEREBRAS_API_KEY).
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

    // Validate mealType
    const validMealTypes = ["breakfast", "lunch", "dinner", "snack"];
    const safeMealType = validMealTypes.includes(mealType) ? mealType : "dinner";

    // Fetch user profile preferences and build personalized system prompt
    const {
      prompt: personalization,
      allergies: userAllergens,
      householdSize,
      dietaryPreferences,
      toddlerFriendly,
      glucoseFriendly,
      orderedDays,
      batchCookDay,
    } = await buildPersonalization(req, { includePrepPlan: false });
    const systemPrompt = BASE_SYSTEM_PROMPT + EXAMPLE_RECIPE + SWAP_ONE_SHOT_EXAMPLE + personalization + "\n\n" + JSON_ONLY_DIRECTIVE;

    // Build the context block for the user message
    const oldMealTitle = sanitizeInput(oldMeal?.title, 100);
    const safeDayLabel = sanitizeInput(dayLabel, 20);

    // Prep tips (261007-slz P1): keep every tip that is not solely about the
    // slot being replaced; the model only adds a delta, merged after the call.
    const replacedIds: string[] = typeof oldMeal?.id === "string" && oldMeal.id ? [oldMeal.id] : [];
    const keptTips = keepUnrelatedPrepTips(currentPrepTips, replacedIds);
    const nightDay = nightBeforeDay(safeDayLabel, orderedDays, batchCookDay, skipSlots);

    // Summarize remaining meals to avoid repeats (title + mealType only, to keep payload small)
    const remainingList = Array.isArray(remainingMeals)
      ? remainingMeals
          .slice(0, 40)
          .map((m: { title?: unknown; mealType?: unknown }) =>
            `${sanitizeInput(m.title, 80)} (${sanitizeInput(m.mealType, 20)})`
          )
          .join(", ")
      : "";

    // Summarize the kept prep tips as read-only context. Only this summary is
    // capped: keptTips itself goes back to the client and replaces its saved tips.
    const prepTipsSummary = keptTips
      .slice(0, 40)
      .map((t) => `${sanitizeInput(t.day, 20)}: ${sanitizeInput(t.tip, 150)}`)
      .join("\n");

    let userMessage = `Generate a replacement ${safeMealType} for ${safeDayLabel}.\n\nCurrently replacing: "${oldMealTitle}"\n\nDo NOT repeat any of these existing meals in the plan:\n${remainingList}`;

    if (prepTipsSummary) {
      userMessage += `\n\nExisting prep plan (read-only context — do NOT repeat or rewrite it):\n${prepTipsSummary}`;
    }
    userMessage += `\n\nPrep timing: prep-day tasks happen on ${batchCookDay}; this meal's night-before tip happens on ${nightDay}.`;

    // D-11: size the replacement AS A SOURCE when the outgoing meal was a
    // leftover source for dependents elsewhere in the plan (client-computed
    // dependentSource signal — Open Q3: token budgets are NOT pre-bumped for
    // this, flagged for the operator to check finish_reason live at 17-10).
    const dependentCount = dependentSource && typeof dependentSource === "object"
      ? Number((dependentSource as { count?: unknown }).count)
      : 0;
    const dependentServingsSum = dependentSource && typeof dependentSource === "object"
      ? Number((dependentSource as { servingsSum?: unknown }).servingsSum)
      : 0;
    if (Number.isFinite(dependentCount) && dependentCount > 0 && Number.isFinite(dependentServingsSum) && dependentServingsSum > 0) {
      userMessage += `\n\nThis meal is a leftover SOURCE: ${dependentCount} dependent leftover meal(s) elsewhere in the plan consume portions from it, totaling ${dependentServingsSum} servings. Size the replacement AS A SOURCE — double the ingredient quantities and set "servings" to a whole-number multiple that covers both its own servings and the ${dependentServingsSum} dependent servings.`;
    }

    if (hint && typeof hint === "string") {
      const safeHint = sanitizeInput(hint, 200);
      if (safeHint) {
        userMessage += `\n\nUser's request for the new meal: "${safeHint}"`;
      }
    }

    // --- AI call ---
    // The inner lambda keeps the existing transient-error retry (withRetry:
    // 429/5xx/timeout). It is parameterized by token `budget` so the outer
    // truncation shell can re-run it at a larger budget. Truncation is NOT a
    // transient error — it surfaces as a TruncationError that withRetry does
    // not retry (isRetryable is message-based and never matches), so it
    // propagates out to the shell below.
    const callSwapModel = (budget: number): Promise<Record<string, unknown>> =>
      withRetry(async () => {
        const fetchTimeout = AbortSignal.timeout(120_000); // 120s timeout
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
          signal: fetchTimeout,
          body: JSON.stringify({
            model: requestModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            // Cerebras reasoning tokens count against max_completion_tokens, so
            // the ceiling is raised there (budget + 8192: BASE 8192→16384,
            // RETRY 12288→20480); the Gateway path keeps its original budget.
            ...(isCerebras
              ? {
                  max_completion_tokens: budget + 8192,
                  reasoning_effort: CEREBRAS_REASONING_EFFORT,
                  response_format: {
                    type: "json_schema",
                    json_schema: { name: "meal_swap", strict: true, schema: SWAP_SCHEMA },
                  },
                }
              : tokenBudgetField(AI_MODEL, budget)),
            stream: false,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          console.error("AI provider error:", response.status, text.slice(0, 500));
          if (response.status === 429) throw new Error("429 Rate limit exceeded");
          if (response.status === 401) throw new Error("AI API key is invalid or missing permissions.");
          // retry.ts retries on the status code and on the literal "wrong_api_format".
          throw new Error(`AI service error (${response.status})${text.includes("wrong_api_format") ? " wrong_api_format" : ""}`);
        }

        const aiResponse = await response.json();
        const accumulated: string = aiResponse.choices?.[0]?.message?.content ?? "";
        const finishReason: string | undefined = aiResponse.choices?.[0]?.finish_reason;

        if (!accumulated) throw new Error("Empty response from AI");

        // Truncation signal #1 (D-10): the model hit the token ceiling.
        if (finishReason === "length") {
          throw new TruncationError(
            "AI response truncated (finish_reason: length)",
            redactForSnippet(accumulated, 400),
          );
        }

        return stripNulls(parseAIJson(accumulated, {
          label: "swap-meal",
          onUnbalanced: (s) => new TruncationError(
            "Unable to extract JSON from AI response (unbalanced braces — likely truncated)",
            s,
          ),
        }) as Record<string, unknown>);
      }, { label: "swap-meal" });

    // Per-user rate limiting. FX-5 / WR-06: the slot is reserved right before
    // the model call and given back in the catch block if that call fails, so a
    // failed swap does not use up the daily limit.
    const reservation = await reserveAction(userId, "swap");
    if (!reservation.allowed) {
      return new Response(
        JSON.stringify({ error: "You've reached the daily limit for meal swaps. Please try again tomorrow." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    reservationId = reservation.id;

    // Truncation-aware shell (OUTSIDE withRetry — a truncated response needs a
    // larger request body, not a transient retry). Fires AT MOST once: if the
    // higher-budget retry also truncates, its TruncationError propagates to the
    // catch block as the post-retry failure (D-10).
    let swapResult: Record<string, unknown>;
    try {
      swapResult = await callSwapModel(SWAP_BASE_TOKENS);
    } catch (err) {
      if (err instanceof TruncationError) {
        console.warn(`[swap-meal] First attempt truncated (${err.message}); retrying once at ${SWAP_RETRY_TOKENS}-token budget.`);
        swapResult = await callSwapModel(SWAP_RETRY_TOKENS);
      } else {
        throw err;
      }
    }

    // FX-5: the AI call succeeded, so from here the reserved slot stays used.
    reservationId = null;

    // Merge the model's newPrepTips delta into the kept tips and answer in the
    // client contract's updatedPrepTips. Unconditional: a Gateway-path model
    // that still emits a whole-week updatedPrepTips array is ignored. Runs
    // before validateSwapSchema so the warn-only check sees the client shape.
    swapResult.updatedPrepTips = mergePrepTipDelta(keptTips, swapResult.newPrepTips, {
      prepDay: batchCookDay,
      nightDay,
      orderedDays,
      tagIds: replacedIds,
      idPrefix: `tip-swap-${replacedIds[0] ?? "meal"}`,
    });
    delete swapResult.newPrepTips;

    // --- Post-AI validation ---

    // Schema validation
    const schemaResult = validateSwapSchema(swapResult);
    if (!schemaResult.success) {
      console.warn(`[swap-meal] Schema validation issues:`, schemaResult.issues.join("; "));
    }

    // Allergen check on the new meal
    if (swapResult.newMeal && typeof swapResult.newMeal === "object") {
      swapResult.newMeal = scaleMealToServings(
        swapResult.newMeal as { servings: number; ingredients: Array<{ name: string; quantity: number | string; unit: string; prep?: string }> },
        householdSize,
      );
    }

    const newMeal = swapResult.newMeal as { title?: string; cautionNote?: unknown; ingredients?: Array<{ name: string; [key: string]: unknown }> } | undefined;
    if (newMeal && userAllergens.length > 0) {
      const allergenViolations = checkAllergens([{
        title: typeof newMeal.title === "string" ? newMeal.title : "Replacement meal",
        ingredients: Array.isArray(newMeal.ingredients) ? newMeal.ingredients : [],
      }], userAllergens);
      if (allergenViolations.length > 0) {
        console.error(`[swap-meal] ALLERGEN VIOLATION in swap:`, JSON.stringify(allergenViolations));
        markAllergenCautions([newMeal], allergenViolations);
        (swapResult as Record<string, unknown>).warnings = [
          `Allergen safety: the replacement meal may contain ${allergenViolations.map(v => v.allergen).join(", ")} — please review ingredients carefully.`,
        ];
      }
    }

    // Business logic validation
    if (newMeal) {
      const existingTitles = Array.isArray(remainingMeals)
        ? remainingMeals.map((m: { title?: string }) => m.title || "").filter(Boolean)
        : [];
      const bizViolations = validateSwapMeal(
        swapResult.newMeal as { title: string; mealType: string; servings: number; calories: number; protein: number; carbs: number; fats: number; ingredients: Array<{ name: string; [key: string]: unknown }>; steps: string[]; flavorNotes?: string; status?: "fresh" | "prep-linked" | "leftover"; source_meal_id?: string },
        existingTitles,
        {
          householdSize,
          dietaryPreferences,
          toddlerFriendly,
          glucoseFriendly,
        },
      );
      if (bizViolations.length > 0) {
        const errors = bizViolations.filter(v => v.severity === "error");
        if (errors.length > 0) {
          console.warn(`[swap-meal] Validation errors:`, errors.map(e => e.message).join("; "));
        }
      }
    }

    const resultJson = JSON.stringify(swapResult);
    const encoder = new TextEncoder();
    const CHUNK_SIZE = 200;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < resultJson.length; i += CHUNK_SIZE) {
      const chunk = resultJson.slice(i, i + CHUNK_SIZE);
      const sseEvent = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
      chunks.push(encoder.encode(`data: ${sseEvent}\n\n`));
    }
    chunks.push(encoder.encode("data: [DONE]\n\n"));

    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("swap-meal error:", e);
    await releaseAction(reservationId);
    if (e instanceof TruncationError) {
      return new Response(
        JSON.stringify({
          error: "The replacement got cut off mid-recipe. Please try again.",
          parseErrorSnippet: e.snippet,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
