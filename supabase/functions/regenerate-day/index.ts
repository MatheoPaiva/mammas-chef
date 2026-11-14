/**
 * regenerate-day — Generates all active meals for a single day in one AI call.
 *
 * Mirrors the swap-meal pattern but replaces all non-skipped meal slots for one day,
 * with full context of the remaining 6 days for variety avoidance.
 */

import { sanitizeInput } from "../_shared/sanitize.ts";
import { buildPersonalization } from "../_shared/personalization.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { releaseAction, reserveAction } from "../_shared/rateLimit.ts";
import { checkAllergens, markAllergenCautions } from "../_shared/allergens.ts";
import { validateSwapMeal } from "../_shared/validation.ts";
import { withRetry } from "../_shared/retry.ts";
import { scaleMealToServings } from "../_shared/servingScaler.ts";
import { keepUnrelatedPrepTips, mergePrepTipDelta, nightBeforeDay } from "../_shared/prepTipMerge.ts";
import { ParseFailureError, parseAIJson, JSON_ONLY_DIRECTIVE } from "../_shared/jsonResponsePrompt.ts";

import { AI_GATEWAY_URL, aiGatewayConfig, tokenBudgetField } from "../_shared/aiGateway.ts";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

// Same allowlist-validated knob as swap-meal / generate-meal-plan /
// generate-shopping-list (prod secret currently "medium").
const CEREBRAS_REASONING_EFFORT = (() => {
  const v = Deno.env.get("CEREBRAS_REASONING_EFFORT");
  return v === "low" || v === "medium" || v === "high" ? v : "low";
})();

// Strict json_schema for Cerebras constrained decoding — grammar-invalid
// output becomes impossible. Only ever sent on the Cerebras path (Vercel
// Gateway 400s on response_format for gpt-4.1-mini — see MEMORY.md).
//
// DAY_SCHEMA is the model-facing wrapper { newMeals, newPrepTips }. The model
// emits newPrepTips (0-2 tips about this day's new meals only); the edge merges
// it into the client contract's updatedPrepTips after the AI call — see
// src/lib/mealPlanParser.ts isDayRegenShape. Unlike swap-meal, regenerate-day
// returns no shopping items, so that field is intentionally absent here.
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
    // Batch-consumption refs (Phase 17, D-04) — regenerate-day mirrors
    // generate-meal-plan's per-meal uses/creates contract (this file already
    // has source_meal_id + full 3-value status, making it the structural
    // sibling of generate-meal-plan's schema). It does NOT get a top-level
    // batches[] array (D-13) — the existing batch table is injected as
    // userMessage prompt context instead, so a regenerated meal can emit a
    // resolvable "uses" ref without the schema needing to carry the table.
    uses: { type: "array", items: { type: "string" } },
    creates: { type: ["string", "null"] },
    // Leftover provenance link (regenerate-day-specific — swap-meal's
    // MEAL_SCHEMA deliberately omits this). Under strict
    // additionalProperties:false, a field absent from the schema is
    // impossible for the model to emit — omitting this would silently
    // disable every leftover link that normalizeMeal (mealPlanParser.ts:197)
    // relies on. Nullable so non-leftover meals can emit null (stripNulls
    // turns that into the absent-key shape the client already expects).
    source_meal_id: { type: ["string", "null"] },
    // NEW for Phase 15 — full 3-value enum (this schema, like generate-meal-plan,
    // has source_meal_id and can express leftover provenance):
    status: { type: ["string", "null"], enum: ["fresh", "prep-linked", "leftover", null] },
    cautionNote: { type: ["string", "null"] },
    workflow: { type: ["string", "null"] },
    storage: { type: ["string", "null"] },
    cookTime: { type: ["string", "null"] },
    totalTime: { type: ["string", "null"] },
  },
  required: [
    "id", "title", "mealType", "prepTime", "servings", "calories", "protein",
    "carbs", "fats", "tags", "ingredients", "steps", "toddlerTip", "glucoseTip",
    "flavorNotes", "uses", "creates", "source_meal_id",
    "status", "cautionNote", "workflow", "storage", "cookTime", "totalTime",
  ],
};

// The model writes ONLY the delta for this day's new meals; days, ids and the
// rest of the week's tips are assigned/kept server-side (_shared/prepTipMerge.ts).
const NEW_PREP_TIPS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prepDayTask: { type: ["string", "null"] },
    nightBeforeTip: { type: ["string", "null"] },
  },
  required: ["prepDayTask", "nightBeforeTip"],
};

const DAY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    newMeals: { type: "array", items: MEAL_SCHEMA },
    newPrepTips: NEW_PREP_TIPS_SCHEMA,
  },
  required: ["newMeals", "newPrepTips"],
};

// Strict mode makes the model emit explicit nulls for nullable optionals
// (toddlerTip/glucoseTip/source_meal_id/ingredient prep). Recursively drop
// null-valued keys so downstream code (normalizeMeal / scaleMealToServings /
// validateSwapMeal / client parser) sees the absent-key shape it already
// expects.
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

const BASE_SYSTEM_PROMPT = `# Role & Context

You are **Mamma's Chef** — an AI personal chef for families with toddlers and adults. Generate ALL meals for ONE day in an existing 7-day plan. Respond with ONLY valid JSON — no markdown, no code fences, no explanation text.

# JSON Structure

{
  "newMeals": [
    {
      "id": "regen-unique-id-1", "title": "Dish Name",
      "mealType": "breakfast",
      "prepTime": "15 min", "servings": 4,
      "calories": 380, "protein": 28, "carbs": 32, "fats": 14,
      "tags": ["Toddler-Friendly"],
      "ingredients": [
        { "name": "chicken thighs", "quantity": 1.5, "unit": "lbs" },
        { "name": "diced tomatoes", "quantity": 2, "unit": "cups" }
      ],
      "steps": ["Step 1", "Step 2"],
      "toddlerTip": "...", "glucoseTip": "...", "flavorNotes": "...",
      "status": "fresh|prep-linked|leftover", "cautionNote": "...or null", "workflow": "...", "storage": "...",
      "cookTime": "20 min", "totalTime": "35 min",
      "uses": ["Q1"], "creates": null
    }
  ],
  "newPrepTips": {
    "prepDayTask": "Specific prep-day task for this day's new meals (~time), or null",
    "nightBeforeTip": "5-10 min night-before task that names this day's new meals, or null"
  }
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

# Meal Time Slots (strictly enforced)

- Breakfast (≤15 min): Quick or make-ahead — oats, egg muffins, smoothies, yogurt, toast.
- Lunch (≤15 min): Assembly or reheat ONLY — wraps, bowls, pitas, salads, quesadillas. Never cook raw protein.
- Dinner (≤40 min): The one real cooking event — searing, roasting, simmering.
- Snack (≤5 min, zero cooking): Grab-and-go — fruit, hummus+veggies, cheese+crackers, energy bites, yogurt.

# Prep-Ahead Recipes (energy bites, egg muffins, overnight oats, etc.)

When a breakfast or snack is prepped ahead:
- Ingredients MUST list ALL raw ingredients with exact quantities. NEVER self-reference like "6 energy bites (from Sunday)." The ingredient list drives the shopping list.
- First step: "If prepped on [prep day], simply grab from the fridge." Then full from-scratch steps.

# Leftover/Reheat Meals

Leftovers can ONLY reference meals from earlier days in the week order — never a day that comes later. If a replacement meal is a leftover/reheat of another meal in the plan:
- The SOURCE recipe must have DOUBLED ingredient quantities to cover both meals (e.g., 1.5 lbs chicken → 3 lbs). If not, note this so the user can adjust.
- LEFTOVER meal consumes a declared batch: emit portion-reference ingredient lines (e.g., "3 prepared salmon portions from Batch S1") and set "uses":["S1"] to the batch id the source meal creates. Steps include reheating instructions ending on a serve/plate action (e.g., "Reheat until warmed through and serve.").
- A leftover meal must NEVER reference a meal from a later day or a later same-day slot. This is non-negotiable.
- If the gap between source cook day and leftover day is more than 3 days, the source recipe's steps MUST include a freeze-the-portion instruction AND, when the leftover meal is on this day, nightBeforeTip MUST include the thaw reminder.
- Food safety: if >3 days between cooking and reuse, put freeze/thaw instructions for THIS day's meals in prepDayTask / nightBeforeTip.

# Output Schema — Leftover Reference Field

Every meal carries an "id" string (stable kebab-case, e.g., "mon-dinner", "tue-lunch"). When a regenerated meal is a leftover of an earlier meal in the FULL week plan (see remaining meals in context), set:
  "source_meal_id": "<id of the earlier-slot meal in the week>"
The id MUST refer to a chronologically earlier slot (earlier day, or same day at an earlier meal-position breakfast→lunch→dinner→snack). Non-leftover meals omit source_meal_id entirely.

Every meal sets "uses" (an array of batch ids it consumes — empty array [] when it consumes none) and "creates" (the batch id this meal itself produces for a later leftover to consume, or null if it doesn't create one). If this meal is itself a leftover SOURCE for a later meal in the full week plan, set "creates" to a new mnemonic batch id matching the style of the existing batch table (e.g., "S2").

LEFTOVER PROVENANCE — STRICT: Source attribution belongs ONLY in the source_meal_id field. ANY meal tagged "leftover"/"leftovers"/"reheat" MUST set source_meal_id to a real earlier meal in the week. A leftover tag without a structural link is BANNED — make it a fresh meal instead. The following are BANNED everywhere a recipe surfaces:
- Recipe titles with "(from X)" / "(leftover from X)" annotations.
- Step text that promises a specific downstream consumer day or mealType ("refrigerate for Wednesday lunch", "save for Friday's dinner"). Use generic portioning ("Portion leftovers for later use") OR set source_meal_id on the actual consumer.
- Ingredient lines that reference a source by day/mealType ("from Monday dinner"). Set source_meal_id and emit a portion-reference ingredient line resolving to a declared batch id (e.g., "3 prepared salmon portions from Batch S1") instead of listing the raw ingredients.

# Status, Caution & Time Fields — Required on Every Meal

- "status" MUST be set on every meal: "fresh" for a cook-from-scratch meal, "prep-linked" when the meal uses a batch/prep component, "leftover" when it reheats an earlier meal in the full week plan. A status of "leftover" MUST have a real source_meal_id pointing to an earlier meal — same rule as above. A status:"leftover" with no source_meal_id is BANNED and is the most common failure mode.
- "cautionNote": a short hazard reason ONLY when a real concern exists (toddler choking risk, high sodium, spice level) — otherwise null. Terse, sentence-fragment style, no exclamation marks. Example: "High sodium — not toddler-suitable".
- "workflow": one terse-imperative line describing how the meal comes together. Examples: "Cook fresh. No prep dependency." / "Uses Sunday Prep Batch cooked quinoa."
- "storage": one terse-imperative line on how to store the meal. Example: "Refrigerate up to 4 days."
- "cookTime" and "totalTime": free-text, same "N min" convention as prepTime (e.g. "20 min") — do NOT invent a tighter/compact format for these fields.

For any of these 6 fields that does not apply to a meal, use null — never omit the key.

# Food Safety (fridge shelf life)

- Proteins: 3 days. Grains: 4 days. Vegetables: 4 days. Sauces/dressings: 5–7 days.
- Beyond the window: freeze on prep day (prepDayTask), and put the thaw reminder for THIS day's meal in nightBeforeTip.

# Day Regeneration Rules

- Generate one meal for each requested mealType, following that slot's complexity rules.
- Must NOT repeat any existing meal in the rest of the plan.
- Every ingredient: exact quantity and unit.
- Scale servings to household size from user preferences.
- Non-zero calories, protein, carbs, AND fats — zero values are never acceptable.
- newMeals array must contain exactly one meal per requested mealType, in the order requested.
- Every meal sets status, cautionNote, workflow, storage, cookTime, and totalTime (null when a field does not apply) — see Status, Caution & Time Fields above.

# New Prep Tips Rules (this day's new meals ONLY)

- The app keeps the rest of the week's prep plan as-is. Never restate, rewrite or mention other meals or days.
- prepDayTask: one prep-day task when part of this day's new meals can be made ahead. Give the action, a "(~N min)" estimate, and freeze/thaw if a meal is eaten 4+ days after the prep day. Otherwise null.
- nightBeforeTip: one 5-10 min night-before task that names this day's new meals (thaw, marinate, chop). Otherwise null.

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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let reservationId: string | null = null;
  try {
    const userId = await verifyUser(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    // batches (D-13, additive/optional): the plan's existing batch table
    // (ids + tasks), sent by the client so regenerated meals can emit
    // resolvable "uses" refs and a regenerated source meal can re-use the
    // batch id it replaces. Absent on pre-17-08 clients — degrades to no-op.
    // skipSlots (additive/optional): lets the night-before tip land on the
    // previous ACTIVE cook night; absent => calendar adjacency.
    // replacedMealIds (the day's current meal ids): its PRESENCE as an array is
    // the contract for "this client understands tip merging". Absent (the
    // pre-PR-#31 client) => the current tips come back unchanged and no delta is
    // merged, so ref-less fixed-id tips cannot pile up across regens.
    const { dayLabel, activeMealTypes, remainingMeals, currentPrepTips, hint, batches, skipSlots, replacedMealIds } = body;
    const hasReplacedIds = Array.isArray(replacedMealIds);
    const replacedIds: string[] = hasReplacedIds
      ? replacedMealIds.filter((id: unknown): id is string => typeof id === "string" && id !== "")
      : [];

    // Cerebras direct is the default engine (matches swap-meal /
    // generate-meal-plan / generate-shopping-list); Gateway fallback when the
    // key is absent = one-env rollback (unset CEREBRAS_API_KEY).
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

    const validMealTypes = ["breakfast", "lunch", "dinner", "snack"];
    const safeMealTypes = [...new Set<string>(
      (Array.isArray(activeMealTypes) ? activeMealTypes : []).filter((t: string) => validMealTypes.includes(t)),
    )];
    if (safeMealTypes.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active meal types specified" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
    const systemPrompt = BASE_SYSTEM_PROMPT + EXAMPLE_RECIPE + personalization + "\n\n" + JSON_ONLY_DIRECTIVE;

    const safeDayLabel = sanitizeInput(dayLabel, 20);

    // Prep tips (261007-slz P1): keep every tip that is not solely about this
    // day's replaced meals; the model only adds a delta, merged after the call.
    const keptTips = keepUnrelatedPrepTips(currentPrepTips, replacedIds);
    const nightDay = nightBeforeDay(safeDayLabel, orderedDays, batchCookDay, skipSlots);

    // Summarize remaining meals (title + mealType) for variety avoidance
    const remainingList = Array.isArray(remainingMeals)
      ? remainingMeals
          .slice(0, 40)
          .map((m: { title?: unknown; mealType?: unknown }) =>
            `${sanitizeInput(m.title, 80)} (${sanitizeInput(m.mealType, 20)})`,
          )
          .join(", ")
      : "";

    // Only this summary is capped: keptTips itself goes back to the client and replaces its saved tips.
    const prepTipsSummary = keptTips
      .slice(0, 40)
      .map((t) => `${sanitizeInput(t.day, 20)}: ${sanitizeInput(t.tip, 150)}`)
      .join("\n");

    // D-13: the plan's existing batch table (ids + tasks), so regenerated
    // meals can emit "uses" refs that resolve against it.
    const batchTableSummary = Array.isArray(batches)
      ? batches
          .slice(0, 30)
          .map((b: { id?: unknown; task?: unknown }) =>
            `${sanitizeInput(b.id, 10)} (${sanitizeInput(b.task, 100)})`,
          )
          .join(", ")
      : "";

    let userMessage = `Generate ALL meals for ${safeDayLabel}.\n\nMeal types to generate (in order): ${safeMealTypes.join(", ")}\n\nDo NOT repeat any of these existing meals in the plan:\n${remainingList}`;

    if (prepTipsSummary) {
      userMessage += `\n\nExisting prep plan (read-only context — do NOT repeat or rewrite it):\n${prepTipsSummary}`;
    }
    userMessage += `\n\nPrep timing: prep-day tasks happen on ${batchCookDay}; this day's night-before tip happens on ${nightDay}.`;

    if (batchTableSummary) {
      userMessage += `\n\nExisting prep batches in this plan (reference these ids in "uses" when a new meal consumes one; if a regenerated meal is itself the source that batch was created from, reuse that same batch id in "creates"): ${batchTableSummary}`;
    }

    if (hint && typeof hint === "string") {
      const safeHint = sanitizeInput(hint, 200);
      if (safeHint) {
        userMessage += `\n\nUser's request for the new meals: "${safeHint}"`;
      }
    }

    // Count against swap rate limit (conceptually the same operation). WR-06:
    // the slot is reserved right before the model call and given back in the
    // catch block if that call fails, so AI Gateway 500s and unparseable
    // answers do not use up the daily limit.
    const reservation = await reserveAction(userId, "swap");
    if (!reservation.allowed) {
      return new Response(
        JSON.stringify({ error: "You've reached the daily limit for meal changes. Please try again tomorrow." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    reservationId = reservation.id;

    // --- AI call with retry on transient errors ---
    // Token ceiling (day regen, not a single swap): up to 4 meals + 0-2 prep
    // tips. Cerebras reasoning tokens share the completion budget, so the
    // Cerebras ceiling is set well above the Gateway path's budget (swap used
    // 16384 for one meal; generate-meal-plan uses 40000 for 28 meals).
    const result = await withRetry(async () => {
      const fetchTimeout = AbortSignal.timeout(120_000);
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
          ...(isCerebras
            ? {
                max_completion_tokens: 24000,
                reasoning_effort: CEREBRAS_REASONING_EFFORT,
                response_format: {
                  type: "json_schema",
                  json_schema: { name: "day_regen", strict: true, schema: DAY_SCHEMA },
                },
              }
            : tokenBudgetField(AI_MODEL, 8192)),
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

      if (!accumulated) throw new Error("Empty response from AI");

      return stripNulls(parseAIJson(accumulated, { label: "regenerate-day" }) as Record<string, unknown>);
    }, { label: "regenerate-day" });

    // WR-06: the AI call succeeded, so from here the reserved slot stays used.
    reservationId = null;

    // --- Post-AI validation ---

    const newMeals = Array.isArray(result.newMeals)
      ? result.newMeals.map((meal) => (
        meal && typeof meal === "object"
          ? scaleMealToServings(
            meal as { servings: number; ingredients: Array<{ name: string; quantity: number | string; unit: string; prep?: string }> },
            householdSize,
          )
          : meal
      ))
      : [];
    result.newMeals = newMeals;

    // The model's newMeals ids are exactly the keys of the client's regenIdMap,
    // which maps each to the id the client holds (the preserved slot id for a
    // replaced slot, a fresh gen- id for an empty one). Tag the delta tips with
    // them: replacedIds cannot name a missing day's new meals, nor a gap slot
    // filled on an existing day.
    const newMealIds = newMeals
      .map((m: Record<string, unknown>) => (m && typeof m === "object" ? m.id : undefined))
      .filter((id: unknown): id is string => typeof id === "string" && id !== "");

    // Allergen check on all new meals
    if (userAllergens.length > 0) {
      const recipesForCheck = newMeals
        .filter((m: Record<string, unknown>) => m && typeof m.title === "string")
        .map((m: Record<string, unknown>) => ({
          title: m.title as string,
          ingredients: Array.isArray(m.ingredients) ? m.ingredients as Array<{ name: string; [key: string]: unknown }> : [],
        }));
      const allergenViolations = checkAllergens(recipesForCheck, userAllergens);
      if (allergenViolations.length > 0) {
        console.error(`[regenerate-day] ALLERGEN VIOLATION:`, JSON.stringify(allergenViolations));
        markAllergenCautions(newMeals, allergenViolations);
        (result as Record<string, unknown>).warnings = [
          `Allergen safety: some meals may contain ${[...new Set(allergenViolations.map(v => v.allergen))].join(", ")} — please review ingredients carefully.`,
        ];
      }
    }

    // Business logic validation per meal
    const existingTitles = Array.isArray(remainingMeals)
      ? remainingMeals.map((m: { title?: string }) => m.title || "").filter(Boolean)
      : [];
    for (const meal of newMeals) {
      if (!meal || typeof meal !== "object") continue;
      const bizViolations = validateSwapMeal(
        meal as { title: string; mealType: string; servings: number; calories: number; protein: number; carbs: number; fats: number; ingredients: Array<{ name: string; [key: string]: unknown }>; steps: string[]; flavorNotes?: string; status?: "fresh" | "prep-linked" | "leftover"; source_meal_id?: string },
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
          console.warn(`[regenerate-day] Validation errors for "${(meal as { title?: string }).title}":`, errors.map(e => e.message).join("; "));
        }
      }
    }

    // --- Stream response back as SSE ---
    // WR-05: re-serialize only the known-good fields so AI-injected keys
    // (e.g. arbitrary top-level "notes", "__proto__", prompt-injection
    // payloads) cannot round-trip through the client into setMealPlan /
    // DB on next save. parseDayRegenerationResponse shape-checks only
    // newMeals + updatedPrepTips; extras would otherwise flow through.
    // updatedPrepTips is the kept week plus the tagged delta. The delta is
    // merged only when the client sent replacedMealIds; without it (today's
    // prod client) the undefined delta returns the kept tips unchanged.
    const safeResult: Record<string, unknown> = {
      newMeals,
      updatedPrepTips: mergePrepTipDelta(keptTips, hasReplacedIds ? result.newPrepTips : undefined, {
        prepDay: batchCookDay,
        nightDay,
        orderedDays,
        tagIds: newMealIds,
        idPrefix: `tip-regen-${safeDayLabel.toLowerCase()}`,
      }),
    };
    if (Array.isArray((result as Record<string, unknown>).warnings)) {
      safeResult.warnings = (result as Record<string, unknown>).warnings;
    }
    const resultJson = JSON.stringify(safeResult);
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
    console.error("regenerate-day error:", e);
    await releaseAction(reservationId);
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
