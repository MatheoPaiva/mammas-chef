import { sanitizeInput } from "../_shared/sanitize.ts";
import { buildPersonalization } from "../_shared/personalization.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { checkRateLimit, recordAction } from "../_shared/rateLimit.ts";
import { validateMealPlanSchema, validatePrepTipsSchema } from "../_shared/schemas.ts";
import { checkAllergens, markAllergenCautions } from "../_shared/allergens.ts";
import { judgeAllergens } from "../_shared/allergenJudge.ts";
import { validateMealPlan, formatViolationsForRetry, rotateDaysToStart, contradictoryNutritionTags } from "../_shared/validation.ts";
import { withRetry } from "../_shared/retry.ts";
import { buildSampleOffsets, hashStringToInt } from "../_shared/candidateSampling.ts";
import { scaleMealToServings } from "../_shared/servingScaler.ts";
import { countActiveSlots, countMeals } from "../_shared/planCoverage.ts";
import { computeDinnerCuisineTitle, normalizeTitleText, titleCaseToken } from "../_shared/dinnerCuisineTitle.ts";
import { parseAIJson, ParseFailureError, redactForSnippet } from "../_shared/jsonResponsePrompt.ts";
import { AI_GATEWAY_URL, aiGatewayConfig, tokenBudgetField } from "../_shared/aiGateway.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


type ChatMessageContentPart =
  | { type: "text"; text: string };

const BASE_SYSTEM_PROMPT = `# Role & Context

You are **Mamma's Chef** — an AI personal chef for families with toddlers and adults. Generate crave-worthy meals that are nutritionally sound for little ones and deeply satisfying for grown-ups. Respond with ONLY valid JSON — no markdown, no code fences, no explanation text.

# Recipe Quality

- ≥3 herbs/spices per recipe beyond salt, pepper, and oil. Steps describe when and how each is applied (e.g., "bloom cumin and paprika in hot oil 30 seconds" — not "add spices").
- Every recipe includes a "flavorNotes" field: one sentence on the dish's dominant flavor profile and what makes it crave-worthy.
- Steps are specific and technique-driven: "sear 3 min per side until deep golden crust" not "cook until done."
- Prep actions must match the food type: wash fresh produce only — never wash breads, wraps, tortillas, or dry goods.
- Toddler-safe: soft textures, mild flavors, finger-food options. No choking hazards, no raw honey under 12 months.
- Reported calories should approximately equal 4·protein + 4·carbs + 9·fats (kcal per gram), and nutrition tags (e.g. "Low Carb", "High Protein") must match the reported macros.

# Ingredient Quantity Standards (per serving minimums)

All ingredient quantities MUST be realistic for the stated serving count. Use these minimums per serving:
- Proteins: ≥6 oz raw meat/poultry/fish, ≥4 oz tofu/tempeh, ≥2 eggs per serving
- Grains/pasta: ≥0.5 cups cooked (≥0.25 cups dry) per serving
- Produce: ≥0.5 cups vegetables per serving
- Multiply by servings to get the total. Example: 6 servings × 6 oz ground beef = 2.25 lbs minimum.
- All ingredient quantities must use US customary units (cups, tbsp, tsp, oz, lbs). Never use grams, kilograms, or milliliters.

# Meal Time Slots (strictly enforced)

- Breakfast (≤15 min): Quick or make-ahead — oats, egg muffins, smoothies, yogurt, toast.
- Lunch (≤15 min): Assembly or reheat ONLY — wraps, bowls, pitas, salads, quesadillas. Never cook raw protein at lunch.
- Dinner (≤40 min): The one real cooking event — searing, roasting, simmering.
- Snack (≤5 min, zero cooking): Grab-and-go — fruit, hummus+veggies, cheese+crackers, energy bites, yogurt.

# Prep-Ahead Recipes (energy bites, egg muffins, overnight oats, etc.)

When a breakfast or snack is prepped ahead on prep day:
- Ingredients MUST list ALL raw ingredients with exact quantities. NEVER self-reference like "6 energy bites (from Sunday)" or "6 egg muffins (from prep day)." The ingredient list drives the shopping list — if raw ingredients aren't listed, they won't be purchased.
- First step: "If prepped on [prep day], simply grab from the fridge." Then include full from-scratch steps so the recipe works standalone.

# Leftover/Reheat Meals (max 2 per week)

Leftovers can ONLY flow forward in the week — a meal on day N can only reference a source recipe from an earlier day (day 1 through day N-1). Day 1 of the week CANNOT have any leftover meals since no cooking has happened yet. Reusing a dinner as a later lunch or dinner is encouraged:
- SOURCE recipe: DOUBLE all ingredient quantities so the recipe feeds both meals. Example: if the household is 3, a normal dinner uses 1.5 lbs chicken. If that dinner also feeds a leftover lunch, use 3 lbs chicken and set "servings" to 6. The ingredient list must reflect the full doubled amount — this is what drives the shopping list.
- SOURCE recipe's final step: portioning instructions (e.g., "Let cool slightly. Portion half into an airtight container and refrigerate for Tuesday lunch.").
- BATCH DECLARATION: the doubled portion becomes a named batch. Declare it in the top-level "batches" array with a short mnemonic id (first letter of the key component + sequence, e.g. "C1" for the first Chicken batch — a naming convenience, not a validated pattern) and set the source recipe's "creates" to that id, e.g. "creates": "C1".
- LEFTOVER meal: set "uses": ["C1"] (the batch id it consumes) and "source_meal_id" to the source recipe's id. The ingredient list is a portion-reference line resolving to the batch — e.g., "3 prepared chicken portions from Batch C1" — never a re-listing of the source's raw ingredients and never a free-text day/mealType reference (banned — see provenance rule 3 below). Steps include reheating instructions that end on a serve/plate action (e.g., "Reheat until steaming, then plate and serve.") so the meal doesn't read as unfinished.
- A leftover meal must NEVER reference a meal from a later day or a later same-day slot. This is non-negotiable; a plan that violates this rule will be rejected.
- If the gap between source cook day and leftover day is more than 3 days, the source recipe's steps MUST include a freeze-the-portion instruction AND a corresponding nightly prep tip MUST include a thaw reminder targeting the leftover day.
- Food safety: if >3 days between cooking and reuse, source must freeze the leftover portion and a nightly tip must include a thaw reminder.
- Every meal declares "uses" (an empty array [] when it consumes no batch) and every meal that produces a reusable batch (prep-day components too, not just leftover sources) sets "creates" to that batch's id, null otherwise. Every "uses"/"creates" id MUST resolve to a real entry in the top-level "batches" array — never reference an undeclared batch id.

# Food Safety (fridge shelf life for pre-cooked items)

- Proteins: 3 days max. Grains: 4 days. Vegetables: 4 days. Sauces/dressings: 5–7 days (safe all week).
- Beyond the window: prep day must portion and freeze immediately. Nightly tip the evening before must remind to thaw.

# Pantry & User Input

- Pantry items supplement the week, not define it. Max 1–2 uses per item. Never exceed stated quantities.
- No single ingredient in >3 of 28 meals. Freely introduce new ingredients for variety.
- Weave cuisine preferences throughout the week. Apply dietary restrictions to every meal.

# Ingredient Format

Each ingredient MUST be a JSON object: { "name": "chicken thighs", "quantity": 2, "unit": "lbs", "prep": "bone-in" }
- quantity may be a number (2) or fraction string ("1 1/2")
- unit is empty string "" if the ingredient has no unit (e.g. "eggs", "garlic cloves")
- prep is optional — use for cut/temp descriptors like "minced", "bone-in", "diced"

# Output Schema — New Required Fields (in addition to existing schema)

Every meal has an "id" string. Use stable kebab-case ids like "mon-dinner", "tue-lunch", "wed-snack".

LEFTOVER MEALS: when a meal is a leftover serving of an earlier source recipe in this same plan, set
  "source_meal_id": "<id of the earlier meal>"
This id MUST exist in this plan, in a chronologically earlier slot (earlier day, or same day at an earlier meal-position breakfast→lunch→dinner→snack). Day 1 of the week has zero leftover meals.

Non-leftover meals omit source_meal_id entirely.

LEFTOVER PROVENANCE — STRICT (tags, titles, steps, ingredients):

0. ANY meal tagged "leftover" / "leftovers" / "reheat" MUST set source_meal_id pointing to a real meal in this same plan, in an EARLIER slot. No phantom leftovers. If you cannot identify a real earlier meal that this leftover came from, do NOT tag it as a leftover — instead make it a fresh meal with full raw ingredients and real cooking steps. A "Leftover" tag without source_meal_id is the most common failure mode of recent plans.


1. Recipe TITLES MUST NOT contain "(from X)" or "(leftover from X)" annotations. A title like "Creamy Tomato & Feta Baked Orzo (from Friday Dinner)" is BANNED — instead set source_meal_id and use the plain title "Creamy Tomato & Feta Baked Orzo".

2. Recipe STEP text MUST NOT promise a specific downstream consumer day or mealType. Banned phrasings include:
   - "Portion half and refrigerate for Wednesday lunch."
   - "Save 3 servings for Friday's lunch."
   - "Set aside for tomorrow's dinner."
   If you want to portion for a later consumer, EITHER set source_meal_id on the consumer meal so the link is auditable, OR write a generic step ("Portion leftovers into airtight containers for later use.").

3. Recipe INGREDIENT lines MUST NOT reference a source meal by day/mealType. Banned phrasings include:
   - "1 serving Tuscan Baked Tofu, from Monday dinner"
   - "leftover from Tuesday lunch"
   If the meal is a leftover, set source_meal_id AND emit a portion-reference ingredient line resolving to a declared batch id (e.g., "3 prepared salmon portions from Batch S1") together with a matching "uses" entry — never list the source's raw ingredients again. The display layer reads source_meal_id to show provenance; free-text day/mealType references in titles/steps/ingredients are unauditable and cause validation failure.

STATUS, CAUTION & TIME FIELDS — REQUIRED ON EVERY MEAL:

4. "status" MUST be set on every meal: "fresh" for a cook-from-scratch meal, "prep-linked" when the meal uses a batch/prep component made on prep day, "leftover" when it reheats an earlier meal in this plan. A status of "leftover" MUST have a real source_meal_id pointing to an earlier meal — same rule as the tags above. A status:"leftover" with no source_meal_id is BANNED and is the most common failure mode.

5. "cautionNote": a short hazard reason ONLY when a real concern exists (toddler choking risk, high sodium, spice level) — otherwise null. Terse, sentence-fragment style, no exclamation marks. Example: "High sodium — not toddler-suitable".

6. "workflow": one terse-imperative line describing how the meal comes together. Examples: "Cook fresh. No prep dependency." / "Uses Sunday Prep Batch cooked quinoa."

7. "storage": one terse-imperative line on how to store the meal. Example: "Refrigerate up to 4 days."

8. "cookTime" and "totalTime": free-text, same "N min" convention as prepTime (e.g. "20 min") — do NOT invent a tighter/compact format for these fields.

For any of these 6 fields that does not apply to a meal, use null — never omit the key.`;

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

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

// Tunable reasoning depth for Cerebras models, set via the CEREBRAS_REASONING_EFFORT
// secret (no redeploy). Higher = better instruction-following (variety, seasonings,
// household-size, non-zero macros) at more latency/cost. Validated to an allowlist so a
// typo'd secret falls back to "low" instead of 400-ing every generation. Default "low".
const CEREBRAS_REASONING_EFFORT = (() => {
  const v = Deno.env.get("CEREBRAS_REASONING_EFFORT");
  return v === "low" || v === "medium" || v === "high" ? v : "low";
})();

// Strict json_schema for Cerebras constrained decoding (FX-1). PROVEN verbatim
// against the live zai-glm-4.7 API (2026-07-05): 27.1s, finish_reason=stop,
// 28/28 meals, valid JSON. DO NOT loosen — strict mode requires every property
// in `required` and expresses optionals as nullable unions; a bare
// {type:"object"} 400s, and Cerebras tightens enforcement 2026-07-21. Only ever
// sent on the Cerebras path (Vercel Gateway 400s on response_format for
// gpt-4.1-mini — see MEMORY.md).
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

// BATCH_SCHEMA (D-02): id is non-nullable — it is the reference anchor a meal's
// uses/creates fields point to. task/yield/storage/useBy/time are required-but-
// nullable ([type,"null"] unions), matching 17-01's client PrepBatch interface
// and this file's own Zod BatchSchema mirror so all three surfaces agree.
// Modeled on INGREDIENT_SCHEMA's standalone-const pattern.
const BATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    task: { type: ["string", "null"] },
    yield: { type: ["string", "null"] },
    storage: { type: ["string", "null"] },
    useBy: { type: ["string", "null"] },
    time: { type: ["string", "null"] },
  },
  required: ["id", "task", "yield", "storage", "useBy", "time"],
};

const MEAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    libraryRecipeId: { type: ["string", "null"] },
    customRecipeId: { type: ["string", "null"] },
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
    source_meal_id: { type: ["string", "null"] },
    pinned: { type: ["boolean", "null"] },
    // NEW for Phase 15 — full 3-value enum here (generate-meal-plan is the
    // "leftover-capable" schema, unlike swap-meal):
    status: { type: ["string", "null"], enum: ["fresh", "prep-linked", "leftover", null] },
    cautionNote: { type: ["string", "null"] },
    workflow: { type: ["string", "null"] },
    storage: { type: ["string", "null"] },
    cookTime: { type: ["string", "null"] },
    totalTime: { type: ["string", "null"] },
    // NEW for Phase 17 (D-04): uses is a required array (no minimum-length
    // constraint — Cerebras-unsupported, Pitfall 1) of batch ids this meal
    // consumes; creates is the required-but-nullable batch id this meal (as a
    // source recipe) produces.
    uses: { type: "array", items: { type: "string" } },
    creates: { type: ["string", "null"] },
  },
  required: [
    "id", "libraryRecipeId", "customRecipeId", "title", "mealType", "prepTime",
    "servings", "calories", "protein", "carbs", "fats", "tags", "ingredients",
    "steps", "toddlerTip", "glucoseTip", "flavorNotes", "source_meal_id", "pinned",
    "status", "cautionNote", "workflow", "storage", "cookTime", "totalTime",
    "uses", "creates",
  ],
};

const MEAL_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day: { type: "string" },
          meals: { type: "array", items: MEAL_SCHEMA },
        },
        required: ["day", "meals"],
      },
    },
    // NEW for Phase 17 (D-01): top-level batches[] array declared after title/days
    // per Open Question 2 (no evidence favoring reordering).
    batches: { type: "array", items: BATCH_SCHEMA },
  },
  required: ["title", "days", "batches"],
};

const PREP_TIPS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prepTips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: ["string", "null"] },
          day: { type: "string" },
          tip: { type: "string" },
          referenced_meal_ids: { type: "array", items: { type: "string" } },
        },
        required: ["id", "day", "tip", "referenced_meal_ids"],
      },
    },
  },
  required: ["prepTips"],
};

// Strict mode makes GLM emit `"libraryRecipeId": null` etc. on every meal.
// Recursively drop null-valued keys so downstream code (Zod optionals,
// `m.source_meal_id ?` checks, client normalizer) sees the shapes it expects.
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




type LibraryCandidateRow = {
  id: string;
  title: string;
  cuisine: string | null;
  region: string | null;
  meal_types: string[] | null;
  diet_tags: string[] | null;
  flavor_tags: string[] | null;
  active_time_minutes: number | null;
  total_time_minutes: number | null;
  servings: number | null;
  ingredients: Array<{ name?: string; quantity?: number | string; unit?: string; prep?: string }> | null;
  steps: Array<{ text?: string } | string> | null;
  prep_ahead_notes?: string | null;
  storage_notes?: string | null;
  reheat_notes?: string | null;
  toddler_tip: string | null;
  glucose_tip: string | null;
  source_attribution: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
};

type PlannerMeal = {
  id: string;
  libraryRecipeId?: string;
  /** AI-emitted leftover link to an earlier meal's id (LEFT-03 repair reads/writes this). */
  source_meal_id?: string;
  title: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  prepTime: string;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  tags: string[];
  ingredients: Array<{ name: string; quantity: number | string; unit: string; prep?: string }>;
  steps: string[];
  toddlerTip?: string;
  glucoseTip?: string;
  flavorNotes?: string;
  pinned?: boolean;
  /** Batch ids this meal consumes (portion-reference leftovers, D-04). */
  uses?: string[];
  /** Batch id this meal (as a source recipe) produces, or null/undefined. */
  creates?: string | null;
};

type PlannerDay = {
  day: string;
  meals: PlannerMeal[];
};

const SLOT_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;
const AI_LIBRARY_CANDIDATE_LIMIT = 32;
const RETRIEVAL_FIRST_CANDIDATE_LIMIT = 96;
const MIN_RAW_CANDIDATES_PER_MEAL_TYPE = 16;
const MAX_RAW_CANDIDATES_PER_MEAL_TYPE = 48;
const MAX_TEXT_SEARCH_QUERIES = 4;

function asMealTypes(values: string[] | null | undefined): Array<typeof SLOT_ORDER[number]> {
  return (values ?? []).filter((value): value is typeof SLOT_ORDER[number] => SLOT_ORDER.includes(value as typeof SLOT_ORDER[number]));
}

function formatMealPrepTime(recipe: LibraryCandidateRow): string {
  return recipe.active_time_minutes && recipe.total_time_minutes && recipe.active_time_minutes !== recipe.total_time_minutes
    ? `${recipe.active_time_minutes} min active / ${recipe.total_time_minutes} min total`
    : recipe.total_time_minutes
      ? `${recipe.total_time_minutes} min`
      : "Time varies";
}

function libraryCandidatePlanningNotes(recipe: LibraryCandidateRow): string[] {
  return [
    recipe.prep_ahead_notes,
    recipe.storage_notes,
    recipe.reheat_notes,
    recipe.toddler_tip,
    recipe.glucose_tip,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function mapLibraryCandidateToMeal(recipe: LibraryCandidateRow, mealType: typeof SLOT_ORDER[number], pinned = false, targetServings?: number): PlannerMeal {
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
      .filter((ingredient): ingredient is { name: string; quantity?: number | string; unit?: string; prep?: string } => typeof ingredient?.name === "string" && ingredient.name.trim().length > 0)
      .map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity ?? 1,
        unit: ingredient.unit ?? "",
        prep: ingredient.prep,
      }))
    : [];

  const steps = Array.isArray(recipe.steps)
    ? recipe.steps
      .map((step) => typeof step === "string" ? step : step?.text)
      .filter((step): step is string => typeof step === "string" && step.trim().length > 0)
    : [];

  const meal: PlannerMeal = {
    id: recipe.id,
    libraryRecipeId: recipe.id,
    title: recipe.title,
    mealType,
    prepTime: formatMealPrepTime(recipe),
    servings: Math.max(1, Math.round(recipe.servings ?? 2)),
    calories: Math.max(1, recipe.calories ?? 350),
    protein: Math.max(0, recipe.protein ?? 0),
    carbs: Math.max(0, recipe.carbs ?? 0),
    fats: Math.max(0, recipe.fats ?? 0),
    tags: Array.from(new Set([
      ...listText(recipe.diet_tags).split(", ").filter(Boolean),
      ...listText(recipe.flavor_tags).split(", ").filter(Boolean),
      recipe.cuisine ?? "",
      recipe.region ?? "",
      ...(pinned ? ["Pinned"] : []),
    ].filter(Boolean))),
    ingredients,
    steps,
    toddlerTip: recipe.toddler_tip ?? undefined,
    glucoseTip: recipe.glucose_tip ?? undefined,
    flavorNotes: undefined,
    ...(pinned ? { pinned: true } : {}),
  };

  return targetServings ? scaleMealToServings(meal, targetServings) : meal;
}

function listText(values: unknown): string {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string").join(", ") : "";
}

function formatLibraryRecipeForPrompt(recipe: LibraryCandidateRow, index: number): string {
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.slice(0, 12).map((ingredient) => {
      const quantity = ingredient.quantity === undefined ? "" : String(ingredient.quantity);
      return [quantity, ingredient.unit, ingredient.name, ingredient.prep ? `(${ingredient.prep})` : ""]
        .filter((part) => String(part).trim() !== "")
        .join(" ");
    }).filter(Boolean).join("; ")
    : "";

  const steps = Array.isArray(recipe.steps)
    ? recipe.steps.slice(0, 5).map((step) => typeof step === "string" ? step : step.text).filter(Boolean).join(" | ")
    : "";

  const time = recipe.active_time_minutes && recipe.total_time_minutes && recipe.active_time_minutes !== recipe.total_time_minutes
    ? `${recipe.active_time_minutes} min active / ${recipe.total_time_minutes} min total`
    : recipe.total_time_minutes
      ? `${recipe.total_time_minutes} min total`
      : "time varies";

  return `${index + 1}. [libraryRecipeId: ${recipe.id}] ${recipe.title}
   Type: ${listText(recipe.meal_types) || "dinner"}; Cuisine: ${[recipe.cuisine, recipe.region].filter(Boolean).join(" / ") || "Mediterranean"}; Time: ${time}; Servings: ${recipe.servings ?? "varies"}
   Tags: ${[listText(recipe.diet_tags), listText(recipe.flavor_tags)].filter(Boolean).join("; ") || "none"}
   Ingredients: ${ingredients || "not listed"}
   Method: ${steps || "not listed"}
   Notes: ${[recipe.toddler_tip, recipe.glucose_tip, recipe.source_attribution ? `Source: ${recipe.source_attribution}` : ""].filter(Boolean).join(" | ") || "none"}`;
}

function libraryCandidateIngredients(recipe: LibraryCandidateRow): Array<{ name: string }> {
  return Array.isArray(recipe.ingredients)
    ? recipe.ingredients
      .map((ingredient) => ({ name: typeof ingredient.name === "string" ? ingredient.name : "" }))
      .filter((ingredient) => ingredient.name.trim().length > 0)
    : [];
}

function normalizeIngredientNeedle(value: string): string {
  return sanitizeInput(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPromptAvoidIngredients(prompt: unknown): string[] {
  if (typeof prompt !== "string") return [];

  const text = sanitizeInput(prompt, 500).toLowerCase();
  const matches = text.matchAll(/(?:avoid|without|exclude|no)\s+([a-z0-9\s,'-]{2,80})(?=\s+(?:and|but|with|for|please|this|that|meal|meals|recipe|recipes|week|plan)\b|[.;]|$)/g);

  return Array.from(matches)
    .flatMap((match) => match[1].split(/,|\band\b|\bor\b|\//g))
    .map(normalizeIngredientNeedle)
    .filter((value) => value.length >= 2)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function recipeContainsAvoidedPromptIngredient(candidate: LibraryCandidateRow, avoidIngredients: string[]): boolean {
  if (avoidIngredients.length === 0) return false;

  const ingredientNames = libraryCandidateIngredients(candidate)
    .map((ingredient) => normalizeIngredientNeedle(ingredient.name))
    .filter(Boolean);

  return avoidIngredients.some((avoid) =>
    ingredientNames.some((name) => name.includes(avoid) || avoid.includes(name))
  );
}

function filterLibraryCandidatesForSafety(
  candidates: LibraryCandidateRow[],
  userAllergens: string[],
  promptAvoidIngredients: string[],
): LibraryCandidateRow[] {
  let safe = candidates;

  if (promptAvoidIngredients.length > 0) {
    const before = safe.length;
    safe = safe.filter((candidate) => !recipeContainsAvoidedPromptIngredient(candidate, promptAvoidIngredients));
    const removed = before - safe.length;
    if (removed > 0) {
      console.log(`[generate-meal-plan] Excluded ${removed} library candidate(s) for prompt avoid terms: ${promptAvoidIngredients.join(", ")}`);
    }
  }

  if (userAllergens.length === 0) return safe;

  const allergenSafe = safe.filter((candidate) => {
    const violations = checkAllergens([
      { title: candidate.title, ingredients: libraryCandidateIngredients(candidate) },
    ], userAllergens);
    return violations.length === 0;
  });

  const removed = safe.length - allergenSafe.length;
  if (removed > 0) {
    console.log(`[generate-meal-plan] Excluded ${removed} library candidate(s) for profile allergen safety`);
  }
  return allergenSafe;
}

const LIBRARY_SEARCH_STOPWORDS = new Set([
  "a", "about", "all", "and", "any", "around", "build", "create", "day", "days", "dinner", "family",
  "for", "give", "healthy", "i", "kid", "kids", "lunch", "make", "meal", "meals", "me", "my", "of",
  "plan", "please", "recipe", "recipes", "snack", "the", "this", "to", "us", "week", "weekly", "with",
]);

function buildLibrarySearchQuery(prompt: unknown): string {
  if (typeof prompt !== "string") return "";

  const terms = sanitizeInput(prompt, 300)
    .toLowerCase()
    .match(/[a-z][a-z'-]{2,}/g) ?? [];

  return Array.from(new Set(terms))
    .filter((term) => !LIBRARY_SEARCH_STOPWORDS.has(term))
    .slice(0, 8)
    .join(" ");
}

type LibraryCandidateFetchOptions = {
  limit?: number;
  seed?: string;
  activeMealTypes?: Array<typeof SLOT_ORDER[number]>;
  preferredCuisines?: string[];
  dietaryPreferences?: string[];
  toddlerFriendly?: boolean;
  glucoseFriendly?: boolean;
  pinnedLibraryIds?: string[];
};

type CandidatePoolSelectionOptions = Required<Pick<LibraryCandidateFetchOptions, "limit" | "seed" | "activeMealTypes">> &
  Pick<LibraryCandidateFetchOptions, "preferredCuisines" | "dietaryPreferences" | "toddlerFriendly" | "glucoseFriendly" | "pinnedLibraryIds"> & {
    prompt?: unknown;
    userAllergens: string[];
  };
type RecipeLibraryQueryResponse<T> = {
  data: T[] | null;
  error: { message?: string } | null;
  count?: number | null;
};

interface RecipeLibraryQueryBuilder<T> {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): RecipeLibraryQueryBuilder<T>;
  in(column: string, values: string[]): RecipeLibraryQueryBuilder<T>;
  contains(column: string, value: string[]): RecipeLibraryQueryBuilder<T>;
  textSearch(column: string, query: string, options?: { type?: "plain" | "phrase" | "websearch" }): RecipeLibraryQueryBuilder<T>;
  limit(count: number): RecipeLibraryQueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): RecipeLibraryQueryBuilder<T>;
  range(from: number, to: number): RecipeLibraryQueryBuilder<T>;
  then<TResult1 = RecipeLibraryQueryResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: RecipeLibraryQueryResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface SupabaseRecipeClient {
  from(table: "recipe_library"): RecipeLibraryQueryBuilder<LibraryCandidateRow>;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)));
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLibrarySearchQueries(prompt: unknown, options: LibraryCandidateFetchOptions): string[] {
  const promptQuery = buildLibrarySearchQuery(prompt);
  const promptTerms = promptQuery.split(/\s+/).filter(Boolean);
  const profileQueries = uniqueStrings([
    ...(options.preferredCuisines ?? []),
    ...(options.dietaryPreferences ?? []),
  ])
    .map((value) => buildLibrarySearchQuery(value))
    .filter(Boolean);

  return uniqueStrings([
    promptQuery,
    ...promptTerms.slice(0, 3),
    ...profileQueries,
  ]).slice(0, MAX_TEXT_SEARCH_QUERIES);
}

function candidateSearchParts(candidate: LibraryCandidateRow) {
  const ingredients = libraryCandidateIngredients(candidate).map((ingredient) => ingredient.name);
  const tags = [
    ...(candidate.diet_tags ?? []),
    ...(candidate.flavor_tags ?? []),
    ...asMealTypes(candidate.meal_types),
    candidate.cuisine ?? "",
    candidate.region ?? "",
  ].filter(Boolean);
  const notes = libraryCandidatePlanningNotes(candidate);

  return {
    title: normalizeSearchText(candidate.title),
    ingredients: normalizeSearchText(ingredients.join(" ")),
    tags: normalizeSearchText(tags.join(" ")),
    notes: normalizeSearchText(notes.join(" ")),
  };
}

function scoreCandidateForPool(params: {
  candidate: LibraryCandidateRow;
  mealType?: typeof SLOT_ORDER[number];
  promptTerms: string[];
  preferredCuisines: string[];
  dietaryPreferences: string[];
  toddlerFriendly: boolean;
  glucoseFriendly: boolean;
}): number {
  const { candidate, mealType, promptTerms, preferredCuisines, dietaryPreferences, toddlerFriendly, glucoseFriendly } = params;
  const parts = candidateSearchParts(candidate);
  let score = 0;

  for (const rawTerm of promptTerms) {
    const term = normalizeSearchText(rawTerm);
    if (!term) continue;
    if (parts.title.includes(term)) score += 8;
    if (parts.ingredients.includes(term)) score += 5;
    if (parts.tags.includes(term)) score += 4;
    if (parts.notes.includes(term)) score += 2;
  }

  for (const cuisine of preferredCuisines) {
    const normalized = normalizeSearchText(cuisine);
    if (normalized && (parts.tags.includes(normalized) || parts.title.includes(normalized))) score += 6;
  }

  if (dietaryPreferences.length > 0) {
    score += matchesDietaryPreferences(candidate, dietaryPreferences) ? 24 : -8;
  }

  if (toddlerFriendly && candidate.toddler_tip) score += 3;
  if (glucoseFriendly && candidate.glucose_tip) score += 3;
  if (libraryCandidatePlanningNotes(candidate).length > 0) score += 1;

  if (mealType && typeof candidate.total_time_minutes === "number") {
    if (mealType === "breakfast" || mealType === "lunch") {
      if (candidate.total_time_minutes <= 15) score += 4;
      else if (candidate.total_time_minutes <= 30) score += 2;
      else score -= 4;
    }
    if (mealType === "snack") {
      if (candidate.total_time_minutes <= 10) score += 5;
      else if (candidate.total_time_minutes > 15) score -= 4;
    }
    if (mealType === "dinner" && candidate.total_time_minutes <= 40) score += 3;
  }

  return score;
}

function sortCandidatesForPool(
  candidates: LibraryCandidateRow[],
  mealType: typeof SLOT_ORDER[number] | undefined,
  promptTerms: string[],
  options: CandidatePoolSelectionOptions,
): LibraryCandidateRow[] {
  return [...candidates].sort((a, b) => {
    const scoreDelta = scoreCandidateForPool({
      candidate: b,
      mealType,
      promptTerms,
      preferredCuisines: options.preferredCuisines ?? [],
      dietaryPreferences: options.dietaryPreferences ?? [],
      toddlerFriendly: options.toddlerFriendly ?? false,
      glucoseFriendly: options.glucoseFriendly ?? false,
    }) - scoreCandidateForPool({
      candidate: a,
      mealType,
      promptTerms,
      preferredCuisines: options.preferredCuisines ?? [],
      dietaryPreferences: options.dietaryPreferences ?? [],
      toddlerFriendly: options.toddlerFriendly ?? false,
      glucoseFriendly: options.glucoseFriendly ?? false,
    });
    if (scoreDelta !== 0) return scoreDelta;

    const aTie = hashStringToInt(`${options.seed}:${mealType ?? "global"}:${a.id}`);
    const bTie = hashStringToInt(`${options.seed}:${mealType ?? "global"}:${b.id}`);
    return aTie - bTie || a.title.localeCompare(b.title);
  });
}

function selectLibraryCandidatePool(candidates: LibraryCandidateRow[], options: CandidatePoolSelectionOptions): LibraryCandidateRow[] {
  const promptTerms = buildLibrarySearchQuery(options.prompt).split(/\s+/).filter(Boolean);
  const activeMealTypes = options.activeMealTypes.length > 0 ? options.activeMealTypes : [...SLOT_ORDER];
  const promptAvoidIngredients = extractPromptAvoidIngredients(options.prompt);
  let safeCandidates = filterLibraryCandidatesForSafety(candidates, options.userAllergens, promptAvoidIngredients)
    .filter((candidate) => asMealTypes(candidate.meal_types).some((mealType) => activeMealTypes.includes(mealType)));

  const hasMealTypeCoverage = (pool: LibraryCandidateRow[]) =>
    activeMealTypes.every((mealType) => pool.some((candidate) => asMealTypes(candidate.meal_types).includes(mealType)));

  // Soft-filter each dietary preference: apply only if the resulting pool still
  // covers every required meal slot. Mirrors the toddler/glucose pattern below.
  // Why: a hard filter would collapse the pool whenever the library is thin in
  // any preference (e.g. very few "low-carb" breakfasts), pushing the request
  // onto the 100-second AI fallback path. The candidate scorer keeps a strong
  // (+24 / -8) signal for dietary match so matching candidates still rank first
  // even when the filter is dropped.
  const droppedPreferences: string[] = [];
  for (const preference of options.dietaryPreferences ?? []) {
    if (!preference?.trim()) continue;
    const filtered = safeCandidates.filter((candidate) => matchesDietaryPreferences(candidate, [preference]));
    if (hasMealTypeCoverage(filtered)) {
      safeCandidates = filtered;
    } else {
      droppedPreferences.push(preference);
    }
  }
  if (droppedPreferences.length > 0) {
    console.log(
      `[generate-meal-plan] retrieval pool: dropped dietary filters due to insufficient library coverage: ${droppedPreferences.join(", ")}`,
    );
  }

  if (options.toddlerFriendly) {
    const toddlerSupported = safeCandidates.filter((candidate) => !!candidate.toddler_tip);
    if (hasMealTypeCoverage(toddlerSupported)) safeCandidates = toddlerSupported;
  }

  if (options.glucoseFriendly) {
    const glucoseSupported = safeCandidates.filter((candidate) => !!candidate.glucose_tip);
    if (hasMealTypeCoverage(glucoseSupported)) safeCandidates = glucoseSupported;
  }

  const pinnedIds = new Set(uniqueStrings(options.pinnedLibraryIds ?? []));
  const selected = new Map<string, LibraryCandidateRow>();
  const selectedCounts = Object.fromEntries(activeMealTypes.map((mealType) => [mealType, 0])) as Record<typeof SLOT_ORDER[number], number>;
  const maxSelected = Math.max(options.limit, pinnedIds.size);

  const addCandidate = (candidate: LibraryCandidateRow, force = false): boolean => {
    if (selected.has(candidate.id)) return false;
    if (!force && selected.size >= maxSelected) return false;
    selected.set(candidate.id, candidate);
    for (const mealType of asMealTypes(candidate.meal_types)) {
      if (mealType in selectedCounts) selectedCounts[mealType] += 1;
    }
    return true;
  };

  for (const pinnedId of pinnedIds) {
    const pinned = safeCandidates.find((candidate) => candidate.id === pinnedId);
    if (pinned) addCandidate(pinned, true);
  }

  const perMealTypeQuota = Math.max(1, Math.ceil(options.limit / activeMealTypes.length));
  for (const mealType of activeMealTypes) {
    const pool = sortCandidatesForPool(
      safeCandidates.filter((candidate) => asMealTypes(candidate.meal_types).includes(mealType)),
      mealType,
      promptTerms,
      options,
    );

    for (const candidate of pool) {
      if (selectedCounts[mealType] >= perMealTypeQuota) break;
      addCandidate(candidate);
    }
  }

  if (selected.size < maxSelected) {
    const globalPool = sortCandidatesForPool(safeCandidates, undefined, promptTerms, options);
    for (const candidate of globalPool) {
      if (selected.size >= maxSelected) break;
      addCandidate(candidate);
    }
  }

  console.log(
    `[generate-meal-plan] Recipe library candidate pool: raw=${candidates.length}, safe=${safeCandidates.length}, selected=${selected.size}, limit=${options.limit}, mealTypes=${activeMealTypes.join(",")}`,
  );

  return Array.from(selected.values()).slice(0, maxSelected);
}

async function fetchMealTypeCandidateCount(
  supabase: SupabaseRecipeClient,
  mealType: typeof SLOT_ORDER[number],
): Promise<number | null> {
  const { count, error } = await supabase
    .from("recipe_library")
    .select("id", { count: "exact", head: true })
    .in("status", ["reviewed", "tested"])
    .contains("meal_types", [mealType]);

  if (error) {
    console.warn(`[generate-meal-plan] Recipe library ${mealType} count skipped: ${error.message}`);
    return null;
  }

  return count ?? 0;
}

async function fetchMealTypeCandidatePage(params: {
  supabase: SupabaseRecipeClient;
  columns: string;
  mealType: typeof SLOT_ORDER[number];
  offset: number;
  pageSize: number;
}): Promise<LibraryCandidateRow[]> {
  const { data, error } = await params.supabase
    .from("recipe_library")
    .select(params.columns)
    .in("status", ["reviewed", "tested"])
    .contains("meal_types", [params.mealType])
    .order("title", { ascending: true })
    .range(params.offset, params.offset + params.pageSize - 1);

  if (error) {
    console.warn(`[generate-meal-plan] Recipe library ${params.mealType} candidate page skipped: ${error.message}`);
    return [];
  }

  return (data ?? []) as unknown as LibraryCandidateRow[];
}

async function fetchSampledMealTypeCandidates(params: {
  supabase: SupabaseRecipeClient;
  columns: string;
  mealType: typeof SLOT_ORDER[number];
  desiredRows: number;
  pageSize: number;
  seed: string;
}): Promise<LibraryCandidateRow[]> {
  const count = await fetchMealTypeCandidateCount(params.supabase, params.mealType);
  const rowsById = new Map<string, LibraryCandidateRow>();

  if (count === null) {
    const rows = await fetchMealTypeCandidatePage({
      supabase: params.supabase,
      columns: params.columns,
      mealType: params.mealType,
      offset: 0,
      pageSize: params.desiredRows,
    });
    return rows.slice(0, params.desiredRows);
  }

  if (count === 0) return [];

  const pageSize = count <= params.desiredRows ? count : params.pageSize;
  const offsets = buildSampleOffsets(count, pageSize, params.desiredRows, `${params.seed}:${params.mealType}`);
  for (const offset of offsets) {
    const rows = await fetchMealTypeCandidatePage({
      supabase: params.supabase,
      columns: params.columns,
      mealType: params.mealType,
      offset,
      pageSize,
    });
    for (const row of rows) rowsById.set(row.id, row);
    if (rowsById.size >= params.desiredRows) break;
  }

  return Array.from(rowsById.values()).slice(0, params.desiredRows);
}

async function fetchLibraryCandidates(
  req: Request,
  userAllergens: string[],
  prompt?: unknown,
  optionsOrLimit: number | LibraryCandidateFetchOptions = {},
): Promise<LibraryCandidateRow[]> {
  const options: LibraryCandidateFetchOptions = typeof optionsOrLimit === "number" ? { limit: optionsOrLimit } : optionsOrLimit;
  const limit = Math.max(1, Math.round(options.limit ?? 28));
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !authHeader.startsWith("Bearer ")) return [];

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  }) as unknown as SupabaseRecipeClient;

  const columns = "id,title,cuisine,region,meal_types,diet_tags,flavor_tags,active_time_minutes,total_time_minutes,servings,calories,protein,carbs,fats,ingredients,steps,prep_ahead_notes,storage_notes,reheat_notes,toddler_tip,glucose_tip,source_attribution";
  const mealTypes = options.activeMealTypes?.length ? options.activeMealTypes : [...SLOT_ORDER];
  const rawPerMealTypeLimit = Math.min(
    MAX_RAW_CANDIDATES_PER_MEAL_TYPE,
    Math.max(MIN_RAW_CANDIDATES_PER_MEAL_TYPE, Math.ceil((limit / Math.max(1, mealTypes.length)) * 2)),
  );
  const pageSize = Math.min(16, Math.max(8, Math.ceil(rawPerMealTypeLimit / 3)));
  const seed = options.seed ?? `${sanitizeInput(prompt, 120)}:${new Date().toISOString().slice(0, 10)}`;
  const rowsById = new Map<string, LibraryCandidateRow>();
  const searchQueries = buildLibrarySearchQueries(prompt, options);

  for (const searchQuery of searchQueries) {
    const { data, error } = await supabase
      .from("recipe_library")
      .select(columns)
      .in("status", ["reviewed", "tested"])
      // search_vector is the generated tsvector column from the library migration.
      // Searching canonical_text directly would skip the indexed MVP RAG path.
      .textSearch("search_vector", searchQuery, { type: "websearch" })
      .limit(Math.max(24, Math.min(64, limit)));

    if (error) {
      console.warn(`[generate-meal-plan] Recipe library prompt search "${searchQuery}" skipped: ${error.message}`);
    } else {
      for (const row of (data ?? []) as LibraryCandidateRow[]) {
        rowsById.set(row.id, row);
      }
    }
  }

  const pinnedLibraryIds = uniqueStrings(options.pinnedLibraryIds ?? []);
  if (pinnedLibraryIds.length > 0) {
    const { data, error } = await supabase
      .from("recipe_library")
      .select(columns)
      .in("status", ["reviewed", "tested"])
      .in("id", pinnedLibraryIds)
      .limit(pinnedLibraryIds.length);

    if (error) {
      console.warn(`[generate-meal-plan] Recipe library pinned candidate lookup skipped: ${error.message}`);
    } else {
      for (const row of (data ?? []) as LibraryCandidateRow[]) {
        rowsById.set(row.id, row);
      }
    }
  }

  for (const mealType of mealTypes) {
    const rows = await fetchSampledMealTypeCandidates({
      supabase,
      columns,
      mealType,
      desiredRows: rawPerMealTypeLimit,
      pageSize,
      seed,
    });

    for (const row of rows) {
      rowsById.set(row.id, row);
    }
  }

  if (rowsById.size < Math.min(8, limit)) {
    const { data, error } = await supabase
      .from("recipe_library")
      .select(columns)
      .in("status", ["reviewed", "tested"])
      .order("title", { ascending: true })
      .limit(limit);

    if (error) {
      console.warn(`[generate-meal-plan] Recipe library fallback candidate lookup skipped: ${error.message}`);
    } else {
      for (const row of (data ?? []) as LibraryCandidateRow[]) {
        rowsById.set(row.id, row);
      }
    }
  }

  return selectLibraryCandidatePool(Array.from(rowsById.values()), {
    ...options,
    limit,
    seed,
    activeMealTypes: mealTypes,
    userAllergens,
    prompt,
  });
}

// Equivalent spellings for common dietary preferences. Falls back to the
// original token when the user picked something outside this map.
// Why: the recipe library has historically held inconsistent tag spellings
// (e.g. "lower-carb" instead of "low-carb"), and the substring-match below
// will silently miss them otherwise. Add new pairs as data lands.
const DIETARY_PREFERENCE_SYNONYMS: Record<string, string[]> = {
  "low-carb": ["low-carb", "lowcarb", "low carb", "lower-carb", "lower carb", "keto"],
  "high-protein": ["high-protein", "highprotein", "high protein"],
  "high-fiber": ["high-fiber", "highfiber", "high fiber"],
  "gluten-free": ["gluten-free", "glutenfree", "gluten free"],
  "dairy-free": ["dairy-free", "dairyfree", "dairy free"],
};

function expandDietaryPreferenceVariants(preference: string): string[] {
  const lower = preference.toLowerCase().trim();
  if (!lower) return [];
  for (const variants of Object.values(DIETARY_PREFERENCE_SYNONYMS)) {
    if (variants.includes(lower)) return variants;
  }
  return [lower];
}

function matchesDietaryPreferences(candidate: LibraryCandidateRow, dietaryPreferences: string[]): boolean {
  if (dietaryPreferences.length === 0) return true;
  const tags = new Set([
    ...asMealTypes(candidate.meal_types),
    ...(candidate.diet_tags ?? []).map((tag) => tag.toLowerCase()),
    ...(candidate.flavor_tags ?? []).map((tag) => tag.toLowerCase()),
    candidate.cuisine?.toLowerCase() ?? "",
    candidate.region?.toLowerCase() ?? "",
  ]);
  const tagList = Array.from(tags);

  return dietaryPreferences.every((preference) => {
    const normalized = preference.toLowerCase().trim();
    if (!normalized) return true;
    if (normalized === "mediterranean") return true;
    const variants = expandDietaryPreferenceVariants(normalized);
    return variants.some((variant) => tagList.some((tag) => tag.includes(variant)));
  });
}

function scoreRetrievalCandidate(params: {
  candidate: LibraryCandidateRow;
  mealType: typeof SLOT_ORDER[number];
  usageCount: number;
  currentDayMeals: PlannerMeal[];
  previousDayMeals: PlannerMeal[];
  preferredCuisines: string[];
  dietaryPreferences: string[];
  toddlerFriendly: boolean;
  glucoseFriendly: boolean;
  promptQuery: string;
}): number {
  const { candidate, mealType, usageCount, currentDayMeals, previousDayMeals, preferredCuisines, dietaryPreferences, toddlerFriendly, glucoseFriendly, promptQuery } = params;

  let score = 0;
  score -= usageCount * 10;

  if (currentDayMeals.some((meal) => meal.libraryRecipeId === candidate.id)) score -= 1000;
  if (previousDayMeals.some((meal) => meal.libraryRecipeId === candidate.id)) score -= 20;

  if ((mealType === "breakfast" || mealType === "lunch") && typeof candidate.total_time_minutes === "number") {
    if (candidate.total_time_minutes <= 15) score += 5;
    else if (candidate.total_time_minutes <= 30) score += 2;
    else score -= 4;
  }

  if (mealType === "snack" && typeof candidate.total_time_minutes === "number" && candidate.total_time_minutes <= 10) score += 4;
  if (mealType === "dinner" && typeof candidate.total_time_minutes === "number" && candidate.total_time_minutes <= 40) score += 3;

  if (preferredCuisines.length > 0) {
    const cuisineHaystack = [candidate.cuisine, candidate.region, ...(candidate.flavor_tags ?? [])]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (preferredCuisines.some((cuisine) => cuisineHaystack.includes(cuisine.toLowerCase()))) score += 3;
  }

  if (toddlerFriendly && candidate.toddler_tip) score += 2;
  if (glucoseFriendly && candidate.glucose_tip) score += 2;

  // When the upstream soft-filter drops a dietary preference (insufficient
  // library coverage), the per-slot pool will contain non-matching candidates.
  // Without this boost, those non-matching candidates can win the slot on
  // unrelated signals (cuisine, time-of-day). Reward each matching preference
  // so matching candidates still take precedence per slot.
  if (dietaryPreferences.length > 0) {
    const matchingCount = dietaryPreferences.filter(
      (preference) => matchesDietaryPreferences(candidate, [preference]),
    ).length;
    score += matchingCount * 4;
  }

  const tags = [...(candidate.flavor_tags ?? []), ...(candidate.diet_tags ?? []), candidate.title]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (promptQuery) {
    const terms = promptQuery.split(/\s+/).filter(Boolean);
    score += terms.filter((term) => tags.includes(term)).length * 2;
  }

  score += libraryCandidatePlanningNotes(candidate).length > 0 ? 1 : 0;
  return score;
}

function buildRetrievalPrepTips(days: PlannerDay[], prepDay: string, orderedDays: string[], skipSlots: Record<string, true> = {}): Array<{ day: string; tip: string }> {
  const isSkipped = (day: string, mealType: string): boolean => skipSlots[`${day}:${mealType}`] === true;
  const dayIsFullySkipped = (day: string): boolean =>
    (["breakfast", "lunch", "dinner", "snack"] as const).every((mt) => isSkipped(day, mt));
  // Exclude skipped-slot meals from the prep-day target lists (D-02).
  const activeMeals = (day: PlannerDay): PlannerMeal[] => day.meals.filter((meal) => !isSkipped(day.day, meal.mealType));

  // --- PREP-05 (G-14-UAT-01): deterministic, pure helpers so the RETRIEVAL path
  // mirrors the AI prompt's "2+ concrete actions + realistic, varied minutes" intent
  // (the AI-prompt fix in 14-01 never reached this builder). No AI call, no
  // randomness, no mutation. ---
  const clampMinutes = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(n)));
  // Derive active minutes from a meal's prepTime ("N min active / M min total" | "M min" | "Time varies").
  const mealActiveMinutes = (meal: PlannerMeal): number | undefined => {
    const pt = typeof meal.prepTime === "string" ? meal.prepTime : "";
    const active = pt.match(/(\d+)\s*min\s*active/i);
    if (active) return Number.parseInt(active[1], 10);
    const total = pt.match(/(\d+)\s*min/i);
    if (total) return Number.parseInt(total[1], 10);
    return undefined;
  };
  // A concrete, item-specific evening action keyed off mealType + title (mirrors AI RULE 2).
  const mealActionPhrase = (meal: PlannerMeal): string => {
    const title = meal.title || "tomorrow's meal";
    switch (meal.mealType) {
      case "dinner": return `thaw and portion the protein for ${title}`;
      case "lunch": return `portion and pack ${title}`;
      case "breakfast": return `lay out the grab-and-go components for ${title}`;
      case "snack": return `portion the ${title}`;
      default: return `prep the ingredients for ${title}`;
    }
  };
  // Non-uniform nightly estimate: ~30% of the next day's active minutes (set-out/thaw/chop,
  // not cooking), clamped to a sane evening band; meal-count fallback when no parseable time.
  const varyNightlyMinutes = (meals: PlannerMeal[]): number => {
    const summed = meals.reduce((sum, m) => sum + (mealActiveMinutes(m) ?? 0), 0);
    if (summed > 0) return clampMinutes(summed * 0.3, 5, 20);
    return clampMinutes(5 + meals.length * 3, 5, 20);
  };

  const prepMeals = days.flatMap((day) => activeMeals(day));
  const prepTipTargets = prepMeals.slice(0, 4)
    .map((meal) => meal.title)
    .filter(Boolean)
    .join(", ");
  const earlyWeekTargets = days.slice(0, 3)
    .flatMap((day) => activeMeals(day))
    .slice(0, 5)
    .map((meal) => meal.title)
    .filter(Boolean)
    .join(", ");
  const quickMealTargets = prepMeals
    .filter((meal) => meal.mealType === "breakfast" || meal.mealType === "lunch" || meal.mealType === "snack")
    .slice(0, 5)
    .map((meal) => meal.title)
    .filter(Boolean)
    .join(", ");

  // Derived prep-day minutes (PREP-06: realistic, not the old hardcoded 20/25/10).
  // estimatePrepTimeSavings sums ONLY these prep-day tips; the 60% cap + 30-min floor
  // downstream still enforce honesty, so keep these in a believable band.
  const earlyWeekDinners = days.slice(0, 3)
    .flatMap((day) => activeMeals(day))
    .filter((meal) => meal.mealType === "dinner");
  const washMinutes = clampMinutes(10 + prepMeals.length * 2, 15, 30);
  const cookMinutes = clampMinutes(
    earlyWeekDinners.reduce((sum, m) => sum + (mealActiveMinutes(m) ?? 12), 0) * 0.6,
    20,
    40,
  );
  const containerCount = quickMealTargets ? quickMealTargets.split(", ").length : 0;
  const containerMinutes = clampMinutes(6 + containerCount * 2, 8, 15);

  const tips: Array<{ day: string; tip: string }> = [
    {
      day: prepDay,
      tip: prepTipTargets
        ? `Wash and chop sturdy produce, herbs, and aromatics for ${prepTipTargets} (~${washMinutes} min).`
        : `Wash produce, organize pantry staples, and check ingredients for the week (~${washMinutes} min).`,
    },
    {
      day: prepDay,
      tip: earlyWeekTargets
        ? `Cook or portion the grains, proteins, and sauces that support ${earlyWeekTargets} (~${cookMinutes} min).`
        : `Cook or portion the grains, proteins, and sauces that will carry the first half of the week (~${cookMinutes} min).`,
    },
    {
      day: prepDay,
      tip: quickMealTargets
        ? `Set up containers and grab-and-go components for ${quickMealTargets} (~${containerMinutes} min).`
        : `Set up containers and grab-and-go components for quick breakfasts, lunches, and snacks (~${containerMinutes} min).`,
    },
  ];

  // Nightly tips chain forward to the NEXT active cook day, skipping over fully-skipped
  // days; the final active cook day gets no nightly tip (D-08, uniform — no prepDay wrap).
  const activeCookDays = orderedDays.filter((day) => day !== prepDay && !dayIsFullySkipped(day));
  for (let index = 0; index < activeCookDays.length - 1; index += 1) {
    const day = activeCookDays[index];
    const nextDay = activeCookDays[index + 1];
    const nextMeals = (days.find((entry) => entry.day === nextDay)?.meals ?? [])
      .filter((meal) => !isSkipped(nextDay, meal.mealType));
    if (nextMeals.length === 0) continue;
    // PREP-05: name 2+ concrete actions on specific items, with a varied per-task estimate.
    const focusMeals = nextMeals.slice(0, 2);
    const actions = focusMeals.map(mealActionPhrase);
    if (actions.length === 1) actions.push("set out the serving dishes and storage containers");
    tips.push({
      day,
      tip: `For ${nextDay}, ${actions.join(", and ")} so tomorrow comes together fast (~${varyNightlyMinutes(nextMeals)} min).`,
    });
  }

  return tips;
}

const TITLE_STOP_WORDS = new Set([
  "and", "with", "for", "from", "the", "your", "family", "families", "meal", "meals", "plan", "week", "weekly",
  "breakfast", "lunch", "dinner", "snack", "recipe", "recipes", "easy", "quick", "simple", "fresh", "healthy",
  "bowl", "bowls", "plate", "plates", "salad", "salads", "sandwich", "sandwiches", "wrap", "wraps", "roasted",
  "creamy", "crispy", "warm", "cold", "make", "ahead", "friendly", "toddler", "glucose",
]);

const NON_TITLE_DIET_VALUES = new Set([
  "none",
  "no preference",
  "no preferences",
  "no dietary restrictions",
  "n/a",
  "not applicable",
]);

// TITLE_TOKEN_OVERRIDES / normalizeTitleText / titleCaseToken were byte-identical
// duplicates of the exports in ../_shared/dinnerCuisineTitle.ts (already imported
// for computeDinnerCuisineTitle). Now imported from there; the override map stays
// private to the shared module (consumed only inside titleCaseToken).

function cleanTitlePreference(value: string): string {
  return normalizeTitleText(value)
    .replace(/\b(meals?|recipes?|diet|dietary|cuisine|cuisines|preferred|preference|preferences)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function findDietTheme(dietaryPreferences: string[], mealText: string): string | null {
  const explicitPreference = dietaryPreferences
    .map(cleanTitlePreference)
    .find((preference) =>
      preference &&
      !NON_TITLE_DIET_VALUES.has(preference) &&
      !preference.includes("allerg") &&
      !preference.includes("toddler") &&
      !preference.includes("glucose")
    );

  if (explicitPreference) return titleCaseToken(explicitPreference);

  const normalizedMealText = normalizeTitleText(mealText);
  const dietTag = [
    "vegetarian",
    "vegan",
    "gluten free",
    "dairy free",
    "low carb",
    "keto",
    "paleo",
    "whole30",
    "pescatarian",
    "plant based",
    "high protein",
  ].find((candidate) => normalizedMealText.includes(candidate));

  return dietTag ? titleCaseToken(dietTag) : null;
}

function extractMealAnchor(days: PlannerDay[], prompt?: unknown): string | null {
  const meals = days.flatMap((day) => day.meals);
  const orderedMeals = [
    ...meals.filter((meal) => meal.mealType === "dinner"),
    ...meals.filter((meal) => meal.mealType === "lunch"),
    ...meals.filter((meal) => meal.mealType === "breakfast"),
    ...meals.filter((meal) => meal.mealType === "snack"),
  ];
  const sourceText = orderedMeals.map((meal) => meal.title).join(" ") || (typeof prompt === "string" ? prompt : "");
  const words = normalizeTitleText(sourceText).match(/[a-z0-9][a-z0-9-]*/g) ?? [];
  const stats = new Map<string, { count: number; firstIndex: number }>();

  words.forEach((word, index) => {
    if (word.length < 3 || TITLE_STOP_WORDS.has(word) || /^\d+$/.test(word)) return;
    const current = stats.get(word);
    if (current) {
      current.count += 1;
    } else {
      stats.set(word, { count: 1, firstIndex: index });
    }
  });

  const anchors = [...stats.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.firstIndex - b.firstIndex)
    .slice(0, 2)
    .map(([word]) => titleCaseToken(word));

  return anchors.length > 0 ? anchors.join(" & ") : null;
}

function buildRetrievalPlanTitle(params: {
  days: PlannerDay[];
  preferredCuisines: string[];
  dietaryPreferences: string[];
  toddlerFriendly: boolean;
  glucoseFriendly: boolean;
  prompt: unknown;
}): string {
  // D-03/D-04: no clear dinner-cuisine lead → plain descriptive title, no diet/care descriptors.
  const cuisineTheme = computeDinnerCuisineTitle(params.days);
  if (!cuisineTheme) return "Weekly Meal Plan";
  const mealText = params.days
    .flatMap((day) => day.meals)
    .map((meal) => [meal.title, ...meal.tags].join(" "))
    .join(" ");
  const dietTheme = findDietTheme(params.dietaryPreferences, mealText);
  const careTheme = params.glucoseFriendly && params.toddlerFriendly
    ? "Glucose-Friendly Family"
    : params.glucoseFriendly
      ? "Glucose-Friendly"
      : params.toddlerFriendly
        ? "Toddler-Friendly"
        : "";
  const descriptors = [
    careTheme,
    !careTheme && cuisineTheme && dietTheme ? dietTheme : "",
  ].filter(Boolean);
  const anchor = cuisineTheme ?? dietTheme ?? extractMealAnchor(params.days, params.prompt) ?? "Family";

  return [...descriptors, anchor, "Week"].join(" ");
}

function buildRetrievalFirstPlan(params: {
  orderedDays: string[];
  prepDay: string;
  candidates: LibraryCandidateRow[];
  skipSlots: Record<string, true>;
  preferredCuisines: string[];
  dietaryPreferences: string[];
  toddlerFriendly: boolean;
  glucoseFriendly: boolean;
  householdSize: number;
  prompt: unknown;
  pinnedRecipes?: Array<Record<string, unknown>>;
}): {
  weekPlan: { title: string; days: PlannerDay[] };
  prepTips: Array<{ day: string; tip: string }>;
  coverage: Record<typeof SLOT_ORDER[number], number>;
  usedLibraryRecipes: number;
} | null {
  const promptQuery = buildLibrarySearchQuery(params.prompt);
  // params.candidates was already produced by selectLibraryCandidatePool, which
  // applies dietary filters softly (drops a filter if it would zero out a meal
  // slot). Re-applying a hard dietary filter here would undo that, so trust the
  // upstream pool and let scoreRetrievalCandidate handle preference ranking.
  const filteredCandidates = params.candidates;
  const candidateOrder = new Map(filteredCandidates.map((candidate, index) => [candidate.id, index]));
  const coverage = {
    breakfast: filteredCandidates.filter((candidate) => asMealTypes(candidate.meal_types).includes("breakfast")).length,
    lunch: filteredCandidates.filter((candidate) => asMealTypes(candidate.meal_types).includes("lunch")).length,
    dinner: filteredCandidates.filter((candidate) => asMealTypes(candidate.meal_types).includes("dinner")).length,
    snack: filteredCandidates.filter((candidate) => asMealTypes(candidate.meal_types).includes("snack")).length,
  };

  const pinnedLibraryIds = (params.pinnedRecipes ?? [])
    .map((recipe) => typeof recipe.libraryRecipeId === "string" ? recipe.libraryRecipeId : "")
    .filter(Boolean);
  const pinnedRecipes = pinnedLibraryIds.map((id) => filteredCandidates.find((candidate) => candidate.id === id)).filter((candidate): candidate is LibraryCandidateRow => !!candidate);

  if ((params.pinnedRecipes?.length ?? 0) > 0 && pinnedRecipes.length !== params.pinnedRecipes?.length) {
    return null;
  }

  const days: PlannerDay[] = [];
  const usage = new Map<string, number>();

  for (const day of params.orderedDays) {
    const currentMeals: PlannerMeal[] = [];
    const previousDayMeals = days.length > 0 ? days[days.length - 1].meals : [];

    for (const mealType of SLOT_ORDER) {
      if (params.skipSlots[`${day}:${mealType}`]) continue;

      const pinnedMatch = pinnedRecipes.find((candidate) =>
        asMealTypes(candidate.meal_types).includes(mealType) && (usage.get(candidate.id) ?? 0) === 0,
      );
      if (pinnedMatch) {
        currentMeals.push(mapLibraryCandidateToMeal(pinnedMatch, mealType, true, params.householdSize));
        usage.set(pinnedMatch.id, (usage.get(pinnedMatch.id) ?? 0) + 1);
        continue;
      }

      const pool = filteredCandidates.filter((candidate) => asMealTypes(candidate.meal_types).includes(mealType));
      if (pool.length === 0) return null;

      const ranked = [...pool].sort((a, b) => {
        const scoreDelta = scoreRetrievalCandidate({
          candidate: b,
          mealType,
          usageCount: usage.get(b.id) ?? 0,
          currentDayMeals: currentMeals,
          previousDayMeals,
          preferredCuisines: params.preferredCuisines,
          dietaryPreferences: params.dietaryPreferences,
          toddlerFriendly: params.toddlerFriendly,
          glucoseFriendly: params.glucoseFriendly,
          promptQuery,
        }) - scoreRetrievalCandidate({
          candidate: a,
          mealType,
          usageCount: usage.get(a.id) ?? 0,
          currentDayMeals: currentMeals,
          previousDayMeals,
          preferredCuisines: params.preferredCuisines,
          dietaryPreferences: params.dietaryPreferences,
          toddlerFriendly: params.toddlerFriendly,
          glucoseFriendly: params.glucoseFriendly,
          promptQuery,
        });
        return scoreDelta || (candidateOrder.get(a.id) ?? 0) - (candidateOrder.get(b.id) ?? 0) || a.title.localeCompare(b.title);
      });

      const selected = ranked[0];
      if (!selected) return null;

      currentMeals.push(mapLibraryCandidateToMeal(selected, mealType, false, params.householdSize));
      usage.set(selected.id, (usage.get(selected.id) ?? 0) + 1);
    }

    days.push({ day, meals: currentMeals });
  }

  return {
    weekPlan: {
      title: buildRetrievalPlanTitle({
        days,
        preferredCuisines: params.preferredCuisines,
        dietaryPreferences: params.dietaryPreferences,
        toddlerFriendly: params.toddlerFriendly,
        glucoseFriendly: params.glucoseFriendly,
        prompt: params.prompt,
      }),
      days,
    },
    prepTips: buildRetrievalPrepTips(days, params.prepDay, params.orderedDays, params.skipSlots),
    coverage,
    usedLibraryRecipes: usage.size,
  };
}

function buildSseJsonResponse(payload: unknown, corsHeaders: Record<string, string>): Response {
  const encoder = new TextEncoder();
  const CHUNK_SIZE = 200;

  const stream = new ReadableStream({
    start(controller) {
      const jsonStr = JSON.stringify(payload);
      for (let i = 0; i < jsonStr.length; i += CHUNK_SIZE) {
        const chunk = jsonStr.slice(i, i + CHUNK_SIZE);
        const sseEvent = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
        controller.enqueue(encoder.encode(`data: ${sseEvent}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

function getActiveMealTypes(orderedDays: string[], skipSlots: Record<string, true>): Array<typeof SLOT_ORDER[number]> {
  const active = SLOT_ORDER.filter((mealType) =>
    orderedDays.some((day) => !skipSlots[`${day}:${mealType}`])
  );
  return active.length > 0 ? active : [...SLOT_ORDER];
}

function isLeftoverSourceMeal(meal: Pick<PlannerMeal, "steps">): boolean {
  const text = meal.steps.join(" ").toLowerCase();
  return /\b(portion|reserve|save)\b.*\b(leftover|later|tomorrow|lunch|dinner|refrigerate|freeze)\b/.test(text) ||
    /\b(refrigerate|freeze)\b.*\b(leftover|portion|half)\b/.test(text);
}

function scaleLibraryMealsToHousehold(days: PlannerDay[], householdSize: number): PlannerDay[] {
  return days.map((day) => ({
    ...day,
    meals: day.meals.map((meal) => {
      if (meal.pinned || !meal.libraryRecipeId || isLeftoverSourceMeal(meal)) return meal;
      return scaleMealToServings(meal, householdSize);
    }),
  }));
}

function extractPinnedLibraryIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((recipe) => {
    if (!recipe || typeof recipe !== "object") return "";
    const libraryRecipeId = (recipe as Record<string, unknown>).libraryRecipeId;
    return typeof libraryRecipeId === "string" ? libraryRecipeId : "";
  }));
}

/**
 * Make a streaming AI call — Cerebras direct by default, Gateway when
 * CEREBRAS_API_KEY is absent. Buffers the full response text and returns
 * parsed JSON.
 */
async function generateCompletion(
  systemPrompt: string,
  userContent: ChatMessageContentPart[],
  scopeInstruction: string,
  apiKey: string,
  model: string,
  opts?: { cerebrasBudget?: number; cerebrasSchema?: Record<string, unknown>; schemaName?: string },
): Promise<Record<string, unknown>> {
  const isCerebras = model.startsWith("cerebras/");
  const endpoint = isCerebras ? CEREBRAS_API_URL : AI_GATEWAY_URL;
  const requestModel = isCerebras ? model.slice("cerebras/".length) : model;

  const userParts = [...userContent, { type: "text", text: scopeInstruction }];
  // gpt-oss-120b is text-only — flatten the parts to a single string on the Cerebras path.
  const userMessage = isCerebras
    ? { role: "user", content: userParts.map((p) => ("text" in p ? p.text : "")).filter(Boolean).join("\n\n") }
    : { role: "user", content: userParts };

  const tokenField = isCerebras
    ? { max_completion_tokens: opts?.cerebrasBudget ?? 40000 }
    : tokenBudgetField(model, 60000);

  // Cerebras-only extras: reasoning_effort from the CEREBRAS_REASONING_EFFORT secret
  // (default "low") + strict json_schema constrained decoding when a schema is passed
  // (FX-1 — makes grammar-invalid JSON impossible). Guard ensures these keys NEVER
  // appear on the Gateway path (Vercel Gateway 400s on response_format for
  // gpt-4.1-mini — see MEMORY.md).
  const cerebrasExtras = isCerebras
    ? {
        reasoning_effort: CEREBRAS_REASONING_EFFORT,
        ...(opts?.cerebrasSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: opts?.schemaName ?? "meal_plan", strict: true, schema: opts.cerebrasSchema },
              },
            }
          : {}),
      }
    : {};

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: requestModel,
      messages: [
        { role: "system", content: systemPrompt },
        userMessage,
      ],
      ...tokenField,
      ...cerebrasExtras,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`AI provider error ${response.status}:`, text.slice(0, 500));
    if (response.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
    if (response.status === 401) throw new Error("AI API key is invalid or missing permissions.");
    // Cerebras structured-output nondeterminism: reasoning models occasionally
    // fail to adhere to the json_schema and the API 400s with code
    // "wrong_api_format" (measured ~40% on gpt-oss-120b at reasoning_effort=low,
    // 0/5 at medium, 2026-07-05). A fresh sample usually passes — classify as a
    // retryable ParseFailureError instead of a terminal AI-service error.
    if (response.status === 400 && text.includes("wrong_api_format")) {
      throw new ParseFailureError(
        "AI failed structured-output constraints — retrying with a fresh sample",
        redactForSnippet(text, 200),
      );
    }
    throw new Error(`AI service error (${response.status}): ${text.slice(0, 800)}`);
  }

  // Non-streaming: the function always buffered the whole response anyway, so
  // read the full body directly. Removes thousands of per-line JSON.parse calls
  // (the leading suspect for the isolate kill) and exposes finish_reason.
  const body = await response.json();
  const accumulated: string = body.choices?.[0]?.message?.content ?? "";
  const finishReason: string | undefined = body.choices?.[0]?.finish_reason;

  if (!accumulated) throw new Error("Empty response from AI");

  // Token-ceiling truncation — retryable (matched by isRetryable via "truncated").
  if (finishReason === "length") {
    throw new ParseFailureError(
      "AI response truncated (finish_reason: length)",
      redactForSnippet(accumulated, 400),
    );
  }

  return stripNulls(parseAIJson(accumulated, { label: "generateCompletion" }));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Server-side auth: verify JWT via Supabase Auth (gateway verify_jwt disabled)
    const userId = await verifyUser(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Per-user rate limiting
    const rateLimit = await checkRateLimit(userId, "generate");
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: "You've reached the daily limit for meal plan generation. Please try again tomorrow." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // FX-5: recordAction is deferred to AFTER the step-1 main generation succeeds
    // (see below), so failed generations no longer burn a daily rate-limit slot
    // (WR-06 pattern, regenerate-day:311-314).

    const {
      prompt,
      pinnedRecipes,
      skipSlots: rawSkipSlots,
      plannerMode,
      startDate: rawStartDate,
      retryContext: rawRetryContext,
    } = await req.json();

    // Validate retryContext: optional string, capped at 8000 chars for defense in depth
    // (See plan 07-06 threat model T-07-12 / T-07-13.)
    let retryContext: string | undefined;
    if (rawRetryContext !== undefined) {
      if (typeof rawRetryContext !== "string") {
        return new Response(
          JSON.stringify({ error: "retryContext must be a string when provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Sanitize retryContext to defang prompt-injection vectors before
      // concatenating into the system prompt. AI-emitted IDs and prep-tip
      // text round-trip through ValidationError.message into this field, so
      // we strip characters that could forge section headers, escape the
      // addendum block, or impersonate instructions:
      //   - newlines / carriage returns → spaces (cannot break out of block)
      //   - backticks, '#', '>' (markdown control chars) → removed
      // The 8000-char cap is applied last as defense in depth.
      const sanitized = rawRetryContext
        .replace(/[\r\n]+/g, " ")
        .replace(/[`#>]/g, "");
      if (sanitized.length > 8000) {
        console.warn(`[generate-meal-plan] retryContext truncated from ${sanitized.length} → 8000 chars (post-sanitize)`);
        retryContext = sanitized.slice(0, 8000);
      } else {
        retryContext = sanitized;
      }
    }

    // Validate startDate as ISO yyyy-mm-dd. We intentionally treat malformed
    // values as undefined rather than throwing — the title prompt simply omits
    // the "Week of …" hint in that case.
    const validatedStartDate: string | undefined =
      typeof rawStartDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawStartDate)
        ? rawStartDate
        : undefined;

    // Validate skipSlots: must be an object with "Day:mealType" keys
    const ALL_DAYS_SET = new Set(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
    const VALID_MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);
    const validatedSkipSlots: Record<string, true> = {};
    if (rawSkipSlots && typeof rawSkipSlots === "object" && !Array.isArray(rawSkipSlots)) {
      for (const key of Object.keys(rawSkipSlots)) {
        const [day, mealType] = key.split(":");
        if (ALL_DAYS_SET.has(day) && VALID_MEAL_TYPES.has(mealType)) {
          validatedSkipSlots[key] = true;
        }
      }
    }
    const skipCount = Object.keys(validatedSkipSlots).length;
    const totalMeals = 28 - skipCount;

    // Fetch user profile preferences and build personalized system prompt
    const {
      prompt: personalization,
      orderedDays,
      batchCookDay,
      allergies: userAllergens,
      householdSize,
      dietaryPreferences,
      preferredCuisines,
      toddlerFriendly,
      glucoseFriendly,
    } = await buildPersonalization(req);
    const retryAddendum = retryContext
      ? `\n\n# Retry Context — Previous Attempt Failed Dependency Validation\n${retryContext}\n\nFix every issue listed above in this regeneration. Apply ALL other rules from the main system prompt.`
      : "";
    const systemPrompt = BASE_SYSTEM_PROMPT + EXAMPLE_RECIPE + personalization + retryAddendum;

    // Build user message content (text-only — Cerebras is the default engine)
    const userContent: ChatMessageContentPart[] = [{ type: "text", text: sanitizeInput(prompt, 1000) }];

    const activeMealTypes = getActiveMealTypes(orderedDays, validatedSkipSlots);
    const pinnedLibraryIds = extractPinnedLibraryIds(pinnedRecipes);
    const candidateSeed = `${userId}:${Date.now().toString(36)}:${hashStringToInt(sanitizeInput(prompt, 300))}`;
    const candidateFetchOptions = {
      seed: candidateSeed,
      activeMealTypes,
      preferredCuisines,
      dietaryPreferences,
      toddlerFriendly,
      glucoseFriendly,
      pinnedLibraryIds,
    };

    // ponytail: auto-RAG retrieval-first disabled by default (Cerebras default shift, 260625-cbz).
    // buildRetrievalFirstPlan + retrieval pool now dormant — removable in a later cleanup.
    // Set RETRIEVAL_FIRST_ENABLED=true to revive.
    const retrievalOnlyEnabled = Deno.env.get("RETRIEVAL_FIRST_ENABLED") === "true";
    const forceGeneration = plannerMode === "generate";
    if (retrievalOnlyEnabled && !forceGeneration) {
      const retrievalPlan = buildRetrievalFirstPlan({
        orderedDays,
        prepDay: batchCookDay,
        candidates: await fetchLibraryCandidates(req, userAllergens, prompt, {
          ...candidateFetchOptions,
          limit: RETRIEVAL_FIRST_CANDIDATE_LIMIT,
        }),
        skipSlots: validatedSkipSlots,
        preferredCuisines,
        dietaryPreferences,
        toddlerFriendly,
        glucoseFriendly,
        householdSize,
        prompt,
        pinnedRecipes: Array.isArray(pinnedRecipes) ? pinnedRecipes as Array<Record<string, unknown>> : undefined,
      });

      if (retrievalPlan) {
        console.log(
          `[generate-meal-plan] Retrieval-first plan selected: used=${retrievalPlan.usedLibraryRecipes}, coverage=${JSON.stringify(retrievalPlan.coverage)}`,
        );
        return buildSseJsonResponse({
          weekPlan: { ...retrievalPlan.weekPlan, batchCookDay },  // edge-authoritative source of truth (D-01/D-02)
          prepTips: retrievalPlan.prepTips,
        }, corsHeaders);
      }

      console.log("[generate-meal-plan] Retrieval-first path unavailable for this request; falling back to AI generation");
    }

    // ponytail: auto library-candidate prompt injection dormant by default (260625-cbz).
    // Gated behind the same retrievalOnlyEnabled flag as retrieval-first above.
    if (retrievalOnlyEnabled) {
      const libraryCandidates = await fetchLibraryCandidates(req, userAllergens, prompt, {
        ...candidateFetchOptions,
        limit: AI_LIBRARY_CANDIDATE_LIMIT,
      });
      if (libraryCandidates.length > 0) {
        userContent.push({
          type: "text",
          text: `\n\nTRUSTED RECIPE LIBRARY CANDIDATES — Prefer building the plan from these reviewed/tested Mammas Chef recipes when they fit the user's constraints. You may adapt serving quantities, but preserve the recipe title, core ingredients, and technique when using one. Include the candidate id as the meal object's libraryRecipeId so saved plans can trace back to the canonical recipe. If a candidate conflicts with allergies, skip slots, meal timing, or the user's prompt, skip it and generate a safe alternative.\n\n${libraryCandidates.map(formatLibraryRecipeForPrompt).join("\n\n")}`,
        });
        console.log(`[generate-meal-plan] Added ${libraryCandidates.length} recipe library candidates to generation context`);
      }
    }

    // Cerebras is the default text engine. Gateway fallback when key is absent (D-03 rollback lever).
    // Local names kept (API_KEY/AI_MODEL) so downstream generateCompletion call sites need no edit.
    const cerebrasKey = Deno.env.get("CEREBRAS_API_KEY");
    let API_KEY: string;
    let AI_MODEL: string;
    if (cerebrasKey && cerebrasKey.trim() !== "") {
      API_KEY = cerebrasKey;
      AI_MODEL = Deno.env.get("CEREBRAS_MODEL") || "cerebras/gpt-oss-120b"; // prefix stripped inside generateCompletion
    } else {
      const cfg = aiGatewayConfig("gpt-4.1-mini"); // EXISTING Gateway path retained = rollback
      API_KEY = cfg.apiKey;
      AI_MODEL = cfg.model;
    }

    // Append pinned recipes instruction
    if (pinnedRecipes && Array.isArray(pinnedRecipes) && pinnedRecipes.length > 0) {
      const totalMeals = 28;
      const recipeList = pinnedRecipes.map((r: Record<string, unknown>, i: number) => {
        const id = sanitizeInput(r.id, 50);
        const libraryRecipeId = sanitizeInput(r.libraryRecipeId, 50);
        const customRecipeId = sanitizeInput(r.customRecipeId, 50);
        const title = sanitizeInput(r.title, 100);
        const ingredients = Array.isArray(r.ingredients)
          ? r.ingredients.map((ing: unknown) => sanitizeInput(ing, 80)).join(", ")
          : "";
        const mealType = sanitizeInput(r.mealType, 20);
        const provenance = [
          libraryRecipeId ? ` [libraryRecipeId: ${libraryRecipeId}]` : "",
          customRecipeId ? ` [customRecipeId: ${customRecipeId}]` : "",
        ].join("");
        return `${i + 1}. [id: ${id}]${provenance} "${title}" (mealType: ${mealType})\n   Ingredients (for shopping list only): ${ingredients}`;
      }).join("\n\n");

      userContent.push({
        type: "text",
        text: `\n\nPINNED RECIPES — ${pinnedRecipes.length} of ${totalMeals} meal slots are pre-set by the user.\n\nRULES:\n1. For each pinned recipe, place a STUB object in the matching day + mealType slot. The stub MUST be exactly: {"id": "[id from below]", "libraryRecipeId": "[libraryRecipeId from below if present, otherwise omit this field]", "customRecipeId": "[customRecipeId from below if present, otherwise omit this field]", "title": "[exact title from below]", "mealType": "[type]", "pinned": true, "prepTime": "0 min", "servings": 0, "calories": 0, "protein": 0, "carbs": 0, "fats": 0, "tags": [], "ingredients": [], "steps": [], "flavorNotes": ""}. The full recipe data is merged client-side — do NOT reproduce ingredients or steps.\n2. A pinned recipe fills exactly ONE meal slot. The other 3 slots on that day MUST be newly generated recipes.\n3. ALL remaining meal slots MUST be fully detailed, newly generated recipes.\n\nPINNED RECIPES:\n\n${recipeList}`,
      });
    }

    // --- Build scope instruction with prep integration and final checklist ---
    const mealJsonSchema = `{
  "id": "unique-id", "libraryRecipeId": "optional canonical recipe id", "title": "Dish Name", "mealType": "breakfast|lunch|dinner|snack",
  "prepTime": "25 min", "servings": 4, "calories": 380, "protein": 28, "carbs": 32, "fats": 14,
  "tags": ["Toddler-Friendly"], "ingredients": [{"name": "chicken thighs", "quantity": 1.5, "unit": "lbs"}],
  "steps": ["Step 1"], "toddlerTip": "...", "glucoseTip": "...", "flavorNotes": "...",
  "status": "fresh|prep-linked|leftover", "cautionNote": "...or null", "workflow": "...", "storage": "...",
  "cookTime": "20 min", "totalTime": "35 min", "uses": ["C1"], "creates": "C1 or null"
}`;

    // Build dynamic per-day JSON structure accounting for skipped slots
    const daySlotDescriptions = orderedDays.map((day: string) => {
      const skippedTypes = ["breakfast", "lunch", "dinner", "snack"]
        .filter((mt) => validatedSkipSlots[`${day}:${mt}`]);
      if (skippedTypes.length === 4) {
        return `    { "day": "${day}", "meals": [] }`;
      }
      const activeCount = 4 - skippedTypes.length;
      if (skippedTypes.length === 0) {
        return `    { "day": "${day}", "meals": [4 meal objects] }`;
      }
      const activeTypes = ["breakfast", "lunch", "dinner", "snack"]
        .filter((mt) => !validatedSkipSlots[`${day}:${mt}`]);
      return `    { "day": "${day}", "meals": [${activeCount} meal objects: ${activeTypes.join(", ")}] }`;
    });

    const skipInstruction = skipCount > 0
      ? `\n${skipCount} meal slot(s) are SKIPPED by the user. Do NOT generate recipes for skipped slots — omit them from the meals array entirely. Only generate recipes for active slots.\n`
      : "";

    const mealsPerDay = orderedDays.map((day) => {
      const active = ["breakfast", "lunch", "dinner", "snack"].filter((type) => !validatedSkipSlots[`${day}:${type}`]);
      return `- ${day}: ${active.join(", ") || "no meals (keep this day with an empty meals array)"}`;
    }).join("\n");
    const mealCountLine = skipCount > 0
      ? `Generate exactly these meals for ALL 7 days (${totalMeals} meals in total). Do not stop early:\n${mealsPerDay}`
      : "Every day MUST have exactly 4 meals (breakfast, lunch, dinner, snack).";

    // Scale variety constraints proportionally
    const minProteins = skipCount > 0 ? Math.max(3, Math.ceil(totalMeals / 6)) : 5;
    const maxChicken = skipCount > 0 ? Math.max(2, Math.ceil(totalMeals / 9)) : 3;
    const preferenceChecklistLines = [
      preferredCuisines.length > 0
        ? `[ ] Preferred cuisines are intentionally represented across the week where they fit: ${preferredCuisines.join(", ")}`
        : "",
      dietaryPreferences.length > 0
        ? `[ ] Every meal respects dietary preferences: ${dietaryPreferences.join(", ")}`
        : "",
      userAllergens.length > 0
        ? `[ ] No meal contains profile allergens: ${userAllergens.join(", ")}`
        : "",
      toddlerFriendly
        ? `[ ] Every meal includes toddler-friendly execution and a toddlerTip`
        : "",
      glucoseFriendly
        ? `[ ] Every meal includes glucose-friendly choices and a glucoseTip`
        : "",
    ].filter(Boolean).join("\n");

    // Title prompt — push the model toward a distinct, week-specific name that
    // draws on the context it already has (preferences, audience, batch day,
    // optional ISO start date). Built as a separate string and woven into the
    // scope instruction below so the JSON skeleton stays valid for the model.
    const weekOfHint = (() => {
      if (!validatedStartDate) return "";
      try {
        const formatted = new Date(`${validatedStartDate}T00:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return `Week of ${formatted}`;
      } catch {
        return "";
      }
    })();
    const titleContextBullets = [
      preferredCuisines.length > 0
        ? `- preferred cuisines: ${preferredCuisines.join(", ")}`
        : "",
      dietaryPreferences.length > 0
        ? `- dietary preferences: ${dietaryPreferences.join(", ")}`
        : "",
      toddlerFriendly ? "- audience flag: toddler-friendly" : "",
      glucoseFriendly ? "- audience flag: glucose-conscious" : "",
      batchCookDay ? `- batch-cook day: ${batchCookDay}` : "",
      householdSize ? `- household size: ${householdSize}` : "",
      weekOfHint ? `- week marker: ${weekOfHint}` : "",
    ].filter(Boolean).join("\n");
    const titleInstruction = `TITLE — the "title" field MUST be a unique, evocative, week-specific name (<=60 characters). Draw on the concrete context for THIS plan:
${titleContextBullets || "- (no extra context — make the title cue the cuisine, audience, or week marker the plan actually expresses)"}
Examples of the tone and specificity expected (DO NOT copy these verbatim — they are illustrations only):
- "Greek Coastal Comforts, ${weekOfHint || "Week of May 24"}"
- "Toddler-Friendly Levantine Spread"
- "Glucose-Steady Tuscan Kitchen"
FORBIDDEN generic placeholders: "Mediterranean Week", "Healthy Family Plan", "Weekly Meal Plan", "My Plan", "Mediterranean Meal Plan". If your first instinct is one of those, rewrite using a real cuisine, audience, or week-of-${weekOfHint ? weekOfHint.replace(/^Week of /, "") : "date"} cue from above.`;

    const scopeInstruction = `\n\nGENERATE A COMPLETE 7-DAY MEAL PLAN.
The "days" array MUST contain EXACTLY 7 objects, one per day, in this order: ${orderedDays.join(", ")}.
Each day name must appear EXACTLY ONCE — no duplicates, no missing days.
${mealCountLine}${skipInstruction}
${batchCookDay ? `${batchCookDay} is BOTH the prep day AND a regular meal day — generate meals for all non-skipped slots on ${batchCookDay} just like any other day. Do NOT create a separate entry for ${batchCookDay} — it appears once in the days array at its position in the week order.` : ""}

SERVING COUNT:
- Household size from the user's profile is ${householdSize}.
- Every normal meal MUST set "servings": ${householdSize} and scale ingredient quantities for exactly ${householdSize} people.
- The only exception is a source recipe intentionally cooked larger for a later leftover meal; in that case the source recipe's ingredients and servings may be a whole-number multiple of ${householdSize}, and the later leftover meal still uses "servings": ${householdSize}.

PREP DAY DESIGN (prep day = ${batchCookDay}):
- Lunches use pre-cooked components from prep day. Write in cooked form: "1.5 cups cooked quinoa" not "0.75 cups dry quinoa." Lunch prep time and steps reflect assembly only.
- Dinners may benefit from prep (pre-chopped veggies, marinades) but each should be the best recipe for its slot.

BATCH DECLARATIONS:
- The top-level "batches" array declares every reusable prep-day component and every doubled leftover-source portion referenced anywhere in the plan. Each batch: { "id": "<mnemonic id>", "task": "<what was prepped>", "yield": "<amount produced>", "storage": "<how/how-long to store>", "useBy": "<day or date>", "time": "~N min" }.
- Give each batch a short, unique mnemonic id (first letter of the key component + sequence, e.g. "Q1" for the first Quinoa batch, "S1" for the first Salmon batch) — the letter is a naming convenience, not a validated pattern; ids just need to be unique within the plan.
- Every meal's "uses" array lists the batch id(s) it consumes (empty array [] when it consumes none); every meal that produces a batch sets "creates" to that batch's id (null otherwise). Every "uses"/"creates" id MUST resolve to a real entry in "batches".
Return this exact JSON structure:
{
  "title": "<one creative, week-specific title here, <=60 chars>",
  "days": [
${daySlotDescriptions.join(",\n")}
  ],
  "batches": [{ "id": "Q1", "task": "Cook quinoa for the week", "yield": "6 cups cooked", "storage": "Refrigerate up to 4 days", "useBy": "Thursday", "time": "~20 min" }]
}

${titleInstruction}

Each meal object: ${mealJsonSchema}

For any optional field that does not apply to a meal (libraryRecipeId, customRecipeId, toddlerTip, glucoseTip, source_meal_id, pinned, ingredient prep, status, cautionNote, workflow, storage, cookTime, totalTime, creates), use null — never omit the key. Every meal's "uses" array is required — use an empty array [] when the meal consumes no batch.

Do NOT generate prepTips — they will be generated separately.

FINAL CHECKLIST — verify every item before responding:
[ ] EXACTLY 7 day objects in the days array, one per day: ${orderedDays.join(", ")} — no duplicate days, no missing days
[ ] ${totalMeals} meals total, every meal has non-zero calories, protein, carbs, AND fats
[ ] Every normal meal has "servings": ${householdSize}; only leftover source recipes may use a whole-number multiple of ${householdSize}
${preferenceChecklistLines ? `${preferenceChecklistLines}\n` : ""}[ ] No recipe title or core concept repeated (leftover/reheat meals are the one exception)
[ ] >=${minProteins} different primary proteins across the week; chicken in <=${maxChicken} meals total
[ ] No ingredient appears in >3 of ${totalMeals} meals
[ ] Prep-ahead recipes (energy bites, egg muffins, overnight oats) list FULL raw ingredients with quantities — NEVER "6 bites from Sunday" or "3 egg muffins from prep day"
[ ] Ingredient quantities are realistic for the serving count (≥6 oz raw protein per serving — e.g., 6 servings needs ≥2.25 lbs)
[ ] Leftover source recipes have ACTUALLY DOUBLED ingredient quantities (not just doubled servings) — compare each ingredient against the per-serving minimum × serving count
[ ] Leftover meals: source cooked BEFORE the leftover in the week order (never reference a later day's recipe); source has portioning step; leftover has reheating steps
[ ] Every leftover meal carries source_meal_id pointing to an EARLIER meal's id (earlier day, or earlier slot same day); never a later day or later slot.
[ ] EVERY meal tagged "leftover"/"leftovers"/"reheat" has source_meal_id set to a real earlier meal id in this plan. No leftover tag without a real source.
[ ] NO recipe title contains "(from X)" or "(leftover from X)" — leftover provenance lives only in source_meal_id, never in title text.
[ ] NO recipe step text names a downstream consumer day+mealType (no "refrigerate for Wednesday lunch") unless that consumer meal has source_meal_id pointing back; prefer generic portioning steps.
[ ] NO ingredient line references a source meal by day+mealType (no "from Monday dinner") — leftovers emit a portion-reference line resolving to a declared batch id and link via source_meal_id.
[ ] Every "uses"/"creates" id resolves against a declared entry in the top-level "batches" array — no dangling batch references.
[ ] If source-to-leftover gap > 3 days, source has freeze step AND a thaw nightly prep tip exists for the leftover day.
[ ] Food safety: freeze/thaw for pre-cooked proteins >3 days, grains >4 days
[ ] >=3 seasonings per recipe beyond salt/pepper/oil; flavorNotes on every recipe
[ ] Every ingredient quantity is realistic for the serving count
[ ] Every meal has "status" set (fresh/prep-linked/leftover); every status:"leftover" meal has a real source_meal_id
[ ] Every meal has "cautionNote" set to a real hazard reason or null — never a generic filler
[ ] Every meal has "workflow" and "storage" as terse-imperative one-liners (or null if truly not applicable)
[ ] Every meal has "cookTime" and "totalTime" in the same "N min" free-text format as prepTime`;

    console.log(`[generate-meal-plan] Starting 7-day generation: days=[${orderedDays}], skipped=${skipCount}, totalMeals=${totalMeals}, model=${AI_MODEL}`);
    const startTime = Date.now();
    // Cap quality-retry cost on slow models — emit best-effort plan past budget.
    // Env-overridable via the RETRY_TIME_BUDGET_MS secret (no redeploy) so the cap can
    // track the live model's latency: lower it for slow models (GLM ~30s/call) to skip
    // runaway retries, raise it for fast ones (gpt-oss-low ~6s) to keep retries + prep
    // tips. Garbage/empty → default 45_000. ponytail: parse-or-default, no validation lib.
    const RETRY_TIME_BUDGET_MS = Number(Deno.env.get("RETRY_TIME_BUDGET_MS")) || 45_000;

    // Stream the response immediately so the Supabase gateway sees bytes
    // flowing and doesn't kill the connection during the long OpenAI wait.
    const encoder = new TextEncoder();
    const CHUNK_SIZE = 200;

    const stream = new ReadableStream({
      async start(controller) {
        // Send keepalive SSE comments every 15s while OpenAI calls run.
        // The client already skips lines starting with ":" (SSE spec).
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch { /* stream may already be closed */ }
        }, 15_000);

        try {
          // --- Step 1: Generate meal plan (with transient error retry) ---
          const result = await withRetry(
            () => generateCompletion(systemPrompt, userContent, scopeInstruction, API_KEY, AI_MODEL, { cerebrasSchema: MEAL_PLAN_SCHEMA }),
            { label: "meal-plan-generation" },
          );

          // FX-5: the rate-limit slot is consumed only once a usable plan exists —
          // see the recordAction call after the Step 4c degenerate-plan guard, so
          // neither transient failures (truncation, parse, timeout, 429) nor an
          // incomplete plan the user is told to retry burn quota.

          const mealsElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[generate-meal-plan] Meal generation complete in ${mealsElapsed}s`);

          // --- Step 2: Schema validation ---
          const schemaResult = validateMealPlanSchema(result);
          if (!schemaResult.success && (Date.now() - startTime) < RETRY_TIME_BUDGET_MS) {
            console.warn(`[generate-meal-plan] Schema validation failed:`, schemaResult.issues.join("; "));
            // Retry once with targeted fix prompt — contained (FX-4): a throw here
            // must never discard the usable base plan already in `result`.
            const fixInstruction = `Your previous response had schema issues:\n${schemaResult.issues.map(i => `- ${i}`).join("\n")}\n\nPlease regenerate a valid response fixing these issues. ${scopeInstruction}`;
            try {
              const retryResult = await withRetry(
                () => generateCompletion(systemPrompt, userContent, fixInstruction, API_KEY, AI_MODEL, { cerebrasSchema: MEAL_PLAN_SCHEMA }),
                { label: "meal-plan-schema-retry", maxRetries: 0 },
              );
              const retrySchema = validateMealPlanSchema(retryResult);
              if (!retrySchema.success) {
                console.error(`[generate-meal-plan] Schema retry also failed:`, retrySchema.issues.join("; "));
                // Fall through with original result — best effort
              } else {
                // Use the fixed result
                Object.assign(result, retryResult);
              }
            } catch (schemaRetryErr) {
              console.warn(`[generate-meal-plan] Schema retry failed — keeping best-effort base plan:`, schemaRetryErr instanceof Error ? schemaRetryErr.message : schemaRetryErr);
            }
          } else if (!schemaResult.success) {
            console.warn(`[generate-meal-plan] Skipped schema retry — time budget exceeded (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed); emitting best-effort plan`);
          }

          // Extract days from the result (handle both flat and nested structures)
          let allDays = (
            Array.isArray(result.days) ? result.days
            : Array.isArray((result as { weekPlan?: { days?: unknown } }).weekPlan?.days) ? ((result as { weekPlan: { days: unknown[] } }).weekPlan.days)
            : []
          ) as PlannerDay[];

          // Defensive: deduplicate days — if the AI produced two entries for the
          // same day name, merge their meals into the first occurrence.
          {
            const seen = new Map<string, number>();
            const deduped: typeof allDays = [];
            for (const d of allDays) {
              const existing = seen.get(d.day);
              if (existing !== undefined) {
                console.warn(`[generate-meal-plan] Duplicate day "${d.day}" — merging meals into first occurrence`);
                deduped[existing].meals = [...deduped[existing].meals, ...(d.meals || [])];
              } else {
                seen.set(d.day, deduped.length);
                deduped.push(d);
              }
            }
            allDays = deduped;
          }

          // Defensive: strip any recipes the AI produced for skipped slots
          if (skipCount > 0) {
            allDays = allDays.map((d) => ({
              ...d,
              meals: (d.meals || []).filter((m) => !validatedSkipSlots[`${d.day}:${m.mealType}`]),
            }));
          }

          // --- Step 3: Allergen safety check ---
          const allRecipes = allDays.flatMap((d) =>
            d.meals.filter((m) => !m.pinned).map((m) => ({ title: m.title, ingredients: m.ingredients }))
          );
          const allergenViolations = checkAllergens(allRecipes, userAllergens);
          // ponytail: await HERE, before the RETRY_TIME_BUDGET_MS check below —
          // charges the judge's latency to the SAME budget window; do not move.
          const judgeViolations = await judgeAllergens(allRecipes, userAllergens);
          if (judgeViolations.length > 0) {
            const keywordPairs = new Set(allergenViolations.map((v) => `${v.recipeTitle}|${v.allergen}`));
            const dedupedJudge = judgeViolations.filter((v) => !keywordPairs.has(`${v.recipeTitle}|${v.allergen}`));
            allergenViolations.push(...dedupedJudge);
            console.log(`[generate-meal-plan] allergen-judge: keyword=${keywordPairs.size} agreed=${judgeViolations.length - dedupedJudge.length} judgeOnly=${dedupedJudge.length}`);
          }
          // ponytail: the post-retry re-check below stays keyword-only — a JEV-
          // flagged recipe replaced by another JEV-flaggable one isn't re-caught;
          // this avoids a second judge call on the critical path.
          if (allergenViolations.length > 0 && (Date.now() - startTime) < RETRY_TIME_BUDGET_MS) {
            console.error(`[generate-meal-plan] ALLERGEN VIOLATIONS:`, JSON.stringify(allergenViolations));
            // This is critical — retry once asking AI to fix the specific recipes.
            // Contained (FX-4): a throw must not discard the usable base plan; the
            // unresolved violations still surface to the client as a warning below.
            const violationList = allergenViolations
              .map((v) => `Recipe "${v.recipeTitle}" contains "${v.ingredient}" which matches allergen "${v.allergen}" (keyword: "${v.matchedKeyword}")`)
              .join("\n");
            const allergenFixInstruction = `CRITICAL ALLERGEN SAFETY FAILURE. Your previous response contained these allergen violations:\n${violationList}\n\nThe user has allergies: ${userAllergens.join(", ")}. Replace ALL violating recipes with allergen-safe alternatives. ${scopeInstruction}`;
            try {
              const allergenRetryResult = await withRetry(
                () => generateCompletion(systemPrompt, userContent, allergenFixInstruction, API_KEY, AI_MODEL, { cerebrasSchema: MEAL_PLAN_SCHEMA }),
                { label: "meal-plan-allergen-retry", maxRetries: 0 },
              );
              // Re-extract and re-validate allergens
              const retryDays = (Array.isArray(allergenRetryResult.days) ? allergenRetryResult.days : []) as typeof allDays;
              const retryRecipes = retryDays.flatMap((d) =>
                d.meals.filter((m) => !m.pinned).map((m) => ({ title: m.title, ingredients: m.ingredients }))
              );
              const retryAllergenViolations = checkAllergens(retryRecipes, userAllergens);
              if (retryAllergenViolations.length === 0) {
                // Use the allergen-safe result
                allDays = retryDays;
                Object.assign(result, allergenRetryResult);
                console.log(`[generate-meal-plan] Allergen retry succeeded — all violations resolved`);
              } else {
                console.error(`[generate-meal-plan] Allergen retry STILL has violations:`, JSON.stringify(retryAllergenViolations));
                // Continue with best effort — client should be warned
              }
            } catch (allergenRetryErr) {
              console.warn(`[generate-meal-plan] Allergen retry failed — keeping best-effort base plan (client warned via validationWarnings):`, allergenRetryErr instanceof Error ? allergenRetryErr.message : allergenRetryErr);
            }
          } else if (allergenViolations.length > 0) {
            console.error(`[generate-meal-plan] ALLERGEN VIOLATIONS (retry skipped — time budget exceeded):`, JSON.stringify(allergenViolations));
          }

          allDays = scaleLibraryMealsToHousehold(allDays, householdSize);

          // --- Step 3b: Silently correct rotation errors (model returned all 7
          // unique days in a valid week order but starting on the wrong day).
          // This must run BEFORE business-logic validation so the day_order
          // error (now severity=error) doesn't trigger a needless retry on a
          // plan that we can fix in place. The helper returns null when the
          // days array is incomplete, duplicated, or non-contiguous — in which
          // case we fall through to the existing validation/retry path.
          const expectedFirstDay = orderedDays[0];
          const rotated = rotateDaysToStart(allDays, expectedFirstDay);
          if (rotated && rotated !== allDays && rotated[0].day !== allDays[0].day) {
            console.log(`[generate-meal-plan] Auto-rotated days from ${allDays[0]?.day}-start to ${expectedFirstDay}-start`);
            allDays = rotated;
            // Mirror the rotation into the underlying result object so the
            // eventual response payload (and any later code that reads
            // result.days) sees the corrected order. Pattern matches the
            // Object.assign(result, ...) calls used elsewhere in this file
            // when allDays is mutated post-parse.
            (result as { days?: typeof allDays }).days = allDays;
          }

          // --- Step 4: Business logic validation ---
          // D-21: batches rides result.batches into 17-09's OPTIONAL batches
          // options-field (Array.isArray-guarded, default []) — legacy-safe
          // whether 17-09's field has landed in this worktree yet or not.
          const bizValidation = validateMealPlan(allDays, [], {
            orderedDays,
            skipSlots: validatedSkipSlots,
            householdSize,
            dietaryPreferences,
            preferredCuisines,
            toddlerFriendly,
            glucoseFriendly,
            batches: Array.isArray(result.batches) ? result.batches : [],
          });
          if (bizValidation.violations.length > 0) {
            const errors = bizValidation.violations.filter((v) => v.severity === "error");
            const warnings = bizValidation.violations.filter((v) => v.severity === "warning");
            if (errors.length > 0) {
              console.error(`[generate-meal-plan] Validation errors:`, errors.map((e) => e.message).join("; "));
            }
            if (warnings.length > 0) {
              console.warn(`[generate-meal-plan] Validation warnings:`, warnings.map((w) => w.message).join("; "));
            }
            // Only retry on errors (not warnings) — and only if we haven't already retried
            if (errors.length > 0 && !allergenViolations.length && schemaResult.success && (Date.now() - startTime) < RETRY_TIME_BUDGET_MS) {
              const fixPrompt = `Your previous response had these issues:\n${formatViolationsForRetry(bizValidation.violations)}\n\nPlease regenerate fixing these specific problems. ${scopeInstruction}`;
              try {
                const bizRetryResult = await withRetry(
                  () => generateCompletion(systemPrompt, userContent, fixPrompt, API_KEY, AI_MODEL, { cerebrasSchema: MEAL_PLAN_SCHEMA }),
                  { label: "meal-plan-validation-retry", maxRetries: 0 },
                );
                const retryDays2 = (Array.isArray(bizRetryResult.days) ? bizRetryResult.days : []) as typeof allDays;
                const scaledRetryDays2 = scaleLibraryMealsToHousehold(retryDays2, householdSize);
                const retryValidation = validateMealPlan(scaledRetryDays2, [], {
                  orderedDays,
                  skipSlots: validatedSkipSlots,
                  householdSize,
                  dietaryPreferences,
                  preferredCuisines,
                  toddlerFriendly,
                  glucoseFriendly,
                  batches: Array.isArray(bizRetryResult.batches) ? bizRetryResult.batches : [],
                });
                const retryErrors = retryValidation.violations.filter((v) => v.severity === "error");
                const retryMeals = countMeals(scaledRetryDays2);
                const currentMeals = countMeals(allDays);
                if (retryErrors.length < errors.length && retryMeals >= currentMeals) {
                  allDays = scaledRetryDays2;
                  Object.assign(result, bizRetryResult);
                  console.log(`[generate-meal-plan] Validation retry improved: ${errors.length} → ${retryErrors.length} errors`);
                } else if (retryErrors.length < errors.length) {
                  console.warn(`[generate-meal-plan] Validation retry rejected — fewer errors but lower coverage (${retryMeals} < ${currentMeals} meals); keeping original`);
                }
              } catch (retryErr) {
                console.warn(`[generate-meal-plan] Validation retry failed:`, retryErr instanceof Error ? retryErr.message : retryErr);
              }
            } else if (errors.length > 0 && !allergenViolations.length && schemaResult.success) {
              console.warn(`[generate-meal-plan] Skipped business-rule retry — time budget exceeded (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed); emitting best-effort plan`);
            }
          }

          // --- Step 4b: Completeness check — retry if any day is missing meals ---
          {
            const MEAL_TYPES_ALL = ["breakfast", "lunch", "dinner", "snack"] as const;
            const missingByDay: Array<{ day: string; missing: string[] }> = [];
            for (const dayName of orderedDays) {
              const day = allDays.find((d) => d.day === dayName);
              const activeMealTypes = MEAL_TYPES_ALL.filter((mt) => !validatedSkipSlots[`${dayName}:${mt}`]);
              if (activeMealTypes.length === 0) continue;
              const existingTypes = new Set((day?.meals ?? []).map((m) => m.mealType));
              const missing = activeMealTypes.filter((mt) => !existingTypes.has(mt));
              if (missing.length > 0) missingByDay.push({ day: dayName, missing });
            }
            if (missingByDay.length > 0 && (Date.now() - startTime) < RETRY_TIME_BUDGET_MS) {
              const missingList = missingByDay.map((d) => `- ${d.day}: missing ${d.missing.join(", ")}`).join("\n");
              console.warn(`[generate-meal-plan] Completeness check — missing meals:\n${missingList}`);
              const completenessFixPrompt = `Your previous response was missing these meals:\n${missingList}\n\nPlease regenerate the COMPLETE plan ensuring every active meal slot is filled. ${scopeInstruction}`;
              try {
                const completenessRetryResult = await withRetry(
                  () => generateCompletion(systemPrompt, userContent, completenessFixPrompt, API_KEY, AI_MODEL, { cerebrasSchema: MEAL_PLAN_SCHEMA }),
                  { label: "meal-plan-completeness-retry", maxRetries: 0 },
                );
                const retryDays3 = (Array.isArray(completenessRetryResult.days) ? completenessRetryResult.days : []) as typeof allDays;
                // Only use retry if it has strictly more meals than the current result
                const currentTotal = countMeals(allDays);
                const retryTotal = countMeals(retryDays3);
                if (retryTotal > currentTotal) {
                  allDays = scaleLibraryMealsToHousehold(retryDays3, householdSize);
                  Object.assign(result, completenessRetryResult);
                  console.log(`[generate-meal-plan] Completeness retry succeeded: ${currentTotal} → ${retryTotal} meals`);
                } else {
                  console.warn(`[generate-meal-plan] Completeness retry did not improve coverage (${currentTotal} → ${retryTotal} meals) — keeping original`);
                }
              } catch (completenessErr) {
                console.warn(`[generate-meal-plan] Completeness retry failed:`, completenessErr instanceof Error ? completenessErr.message : completenessErr);
              }
            } else if (missingByDay.length > 0) {
              console.warn(`[generate-meal-plan] Skipped completeness retry — time budget exceeded (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed); emitting best-effort plan`);
            }
          }

          // --- Step 4c: Degenerate-plan guard — fail below 50% coverage instead of emitting. ---
          // Small gaps still flow (client has a completeness banner + per-day Regenerate).
          // Throwing here reaches the stream catch below, which clears the keepalive and
          // emits data: {"error":{"message"}} — nothing is emitted as a plan, no prep-tips call.
          {
            const activeSlots = countActiveSlots(orderedDays, validatedSkipSlots);
            const produced = countMeals(allDays);
            if (activeSlots > 0 && produced < Math.ceil(activeSlots * 0.5)) {
              console.error(`[generate-meal-plan] Degenerate plan: ${produced} of ${activeSlots} active meal slots filled — failing instead of emitting`);
              throw new Error(`Plan came back incomplete — only ${produced} of ${activeSlots} meals were generated. Please try again.`);
            }
          }

          // FX-5: consume the daily rate-limit slot only now — the plan has
          // passed every retry and the degenerate-plan guard, so a generation
          // the user is told to retry never costs them one of their slots.
          await recordAction(userId, "generate");

          allDays = scaleLibraryMealsToHousehold(allDays, householdSize);

          // --- LEFT-03: repair-then-strip phantom leftovers BEFORE emit (D-02). ---
          // Authoritative server-side twin of the frontend repairPhantomLeftovers
          // (src/lib/mealPlanParser.ts) — Deno cannot import the TS module, so the
          // rule is DUPLICATED identically: a leftover/reheat-tagged meal with no
          // resolving source_meal_id is re-linked to a real, chronologically-earlier
          // -slot meal that restates its normalized title (nearest-earlier on ties,
          // earlier-slot only); on no match the leftover tag(s) are stripped. Runs on
          // allDays before mealSummary so repaired ids reach the prep tips, and before
          // the client-side validator gate. Never invents a non-existent id, never
          // block-saves, never re-rolls.
          {
            const LEFTOVER_TAG_RE = /\b(?:leftover|leftovers|reheat)\b/i;
            const normalizeLeftoverTitle = (title: string): string =>
              title
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ") // strip punctuation (incl. &) to spaces
                .replace(/\band\b/g, " ")      // drop the standalone connector word
                .replace(/\s+/g, " ")
                .trim();

            const allMealIds = new Set<string>();
            const idPos = new Map<string, { dayIndex: number; slotIndex: number }>();
            const titleIndex = new Map<string, Array<{ id: string; dayIndex: number; slotIndex: number }>>();
            allDays.forEach((d, dayIndex) => {
              for (const m of d.meals ?? []) {
                if (!m || typeof m.id !== "string" || !m.id) continue;
                allMealIds.add(m.id);
                const slotIndex = SLOT_ORDER.indexOf(m.mealType);
                idPos.set(m.id, { dayIndex, slotIndex });
                const key = normalizeLeftoverTitle(typeof m.title === "string" ? m.title : "");
                if (!key) continue;
                const entry = { id: m.id, dayIndex, slotIndex };
                const list = titleIndex.get(key);
                if (list) list.push(entry);
                else titleIndex.set(key, [entry]);
              }
            });

            let repairedCount = 0;
            let strippedCount = 0;
            const cleanedDays = allDays.map((d, dayIndex) => ({
              ...d,
              meals: (d.meals ?? []).map((m) => {
                const tags = Array.isArray(m.tags) ? m.tags : [];
                const hasLeftoverTag = tags.some((t) => typeof t === "string" && LEFTOVER_TAG_RE.test(t));
                if (!hasLeftoverTag) return m;
                const phantomSlotIndex = SLOT_ORDER.indexOf(m.mealType);
                const src = m.source_meal_id ? idPos.get(m.source_meal_id) : undefined;
                const resolves = !!src && (
                  src.dayIndex < dayIndex ||
                  (src.dayIndex === dayIndex && src.slotIndex >= 0 && phantomSlotIndex >= 0 && src.slotIndex < phantomSlotIndex)
                );
                if (resolves) return m;

                // resolves is false: forward link OR phantom — fall through to re-link/strip
                const candidates = titleIndex.get(normalizeLeftoverTitle(typeof m.title === "string" ? m.title : "")) ?? [];
                const earlier = candidates.filter(
                  (c) =>
                    c.id !== m.id &&
                    (c.dayIndex < dayIndex ||
                      (c.dayIndex === dayIndex && c.slotIndex < phantomSlotIndex)),
                );
                if (earlier.length > 0) {
                  // Nearest earlier slot = latest day, then latest slot, still before the phantom.
                  const nearest = earlier.reduce((best, c) =>
                    c.dayIndex > best.dayIndex ||
                    (c.dayIndex === best.dayIndex && c.slotIndex > best.slotIndex)
                      ? c
                      : best,
                  );
                  repairedCount++;
                  return { ...m, source_meal_id: nearest.id };
                }
                strippedCount++;
                return {
                  ...m,
                  tags: tags.filter((t) => !(typeof t === "string" && LEFTOVER_TAG_RE.test(t))),
                  source_meal_id: undefined,
                  // D-23: a stripped phantom keeps no dangling batch reference —
                  // edge twin of the client strip in src/lib/mealPlanParser.ts.
                  uses: undefined,
                };
              }),
            }));
            allDays = cleanedDays;
            if (repairedCount > 0 || strippedCount > 0) {
              console.warn(`[generate-meal-plan] Phantom leftovers: repaired ${repairedCount}, stripped ${strippedCount} before emit.`);
            }
          }

          // --- NUTR-02: deterministic contradictory-tag strip BEFORE emit (D-06). ---
          // Reuses the shared contradictoryNutritionTags helper (Plan 18-01) so a
          // "Low Carb"/"Keto"/"High Protein" tag that contradicts the meal's own
          // reported macros is removed rather than shown to the user — guaranteed,
          // not gated behind the budget-limited fix-retry. Additive, tag-array-in/
          // tag-array-out: it never touches macros, ingredients, or any tag that
          // contradictoryNutritionTags did not flag. Runs after LEFT-03 (so a
          // stripped leftover tag doesn't confuse this pass) and before Step 5's
          // mealSummary, so a dropped tag never reaches persistence or prep tips.
          {
            let strippedTagCount = 0;
            allDays = allDays.map((d) => ({
              ...d,
              meals: (d.meals ?? []).map((m) => {
                const bad = contradictoryNutritionTags(m);
                if (bad.length === 0) return m;
                strippedTagCount += bad.length;
                return {
                  ...m,
                  tags: (Array.isArray(m.tags) ? m.tags : []).filter((t) => !bad.includes(t)),
                };
              }),
            }));
            if (strippedTagCount > 0) {
              console.warn(`[generate-meal-plan] Stripped ${strippedTagCount} contradictory nutrition tag(s) before emit.`);
            }
          }

          // --- Step 5: Generate prep tips with full-week visibility ---
          const prepDay = batchCookDay; // prep day = day before week starts
          // Exclude fully-skipped days from nightly tips
          const nightlyDays = orderedDays.filter((d) => {
            if (d === prepDay) return false;
            if (skipCount > 0) {
              const allSkipped = ["breakfast", "lunch", "dinner", "snack"]
                .every((mt) => validatedSkipSlots[`${d}:${mt}`]);
              if (allSkipped) return false;
            }
            return true;
          });
          // Fully-skipped days (all four meal types skipped) — shared by the prompt
          // directive (D-01), nightly chaining (D-08), and the server-side strip (D-03).
          const fullySkippedDays = skipCount > 0
            ? orderedDays.filter((d) =>
                ["breakfast", "lunch", "dinner", "snack"].every((mt) => validatedSkipSlots[`${d}:${mt}`]),
              )
            : [];
          // The prep/batch-cook day is a legitimate prep day even when its MEALS are
          // skipped (e.g. skip Fri/Sat/Sun with a Sunday week-start → prepDay = Saturday).
          // Exempt it from the skipped-day rejection so its prep-day tasks survive (G-12-01).
          // Only skipped COOK days are forbidden in tips; prep-day tasks are tagged prepDay.
          const skippedCookDays = fullySkippedDays.filter((d) => d !== prepDay);
          // Nightly tips chain forward to the NEXT active cook day; the final active
          // cook day of any week gets no nightly tip (D-08). nightlyDays already excludes
          // prepDay + fully-skipped days, so nightlyDays[i + 1] is the next active cook
          // day automatically (chains over skipped days, no prepDay wrap).
          const nightlyTipDays = nightlyDays.slice(0, Math.max(0, nightlyDays.length - 1));
          const skipDirective = skippedCookDays.length > 0
            ? `Skipped days: ${skippedCookDays.join(", ")}. Do NOT generate any prep tip whose day is a skipped day. Do NOT reference any meal scheduled on a skipped slot. Do NOT generate a night-before tip for the night before a skipped day.\n\n`
            : "";
          const mealSummary = allDays.map((d) => {
            const meals = d.meals.map((m) => `  - ${m.mealType}: ${m.title} (${(m.ingredients || []).slice(0, 5).map((i: unknown) => typeof i === "string" ? i : (i as Record<string, string>).name ?? "").join(", ")}${(m.ingredients || []).length > 5 ? "..." : ""})`).join("\n");
            const skippedTypes = skipCount > 0
              ? ["breakfast", "lunch", "dinner", "snack"].filter((mt) => validatedSkipSlots[`${d.day}:${mt}`])
              : [];
            const skipNote = skippedTypes.length > 0 ? `\n  - SKIPPED: ${skippedTypes.join(", ")}` : "";
            return `${d.day}:\n${meals}${skipNote}`;
          }).join("\n\n");

          // D-14: append a compact batch-table summary (ids + tasks) to the
          // mealSummary context so nightly prep tips reference the same batches
          // consistently. TEXT-level only — PREP_TIPS_SCHEMA is unchanged, and
          // batches live in the MAIN call so this survives a prep-tips budget-skip.
          const resultBatchesRaw = Array.isArray((result as { batches?: unknown }).batches)
            ? (result as { batches: Array<{ id?: unknown; task?: unknown }> }).batches
            : [];
          const batchTableSummary = resultBatchesRaw
            .filter((b): b is { id: string; task?: unknown } => !!b && typeof b.id === "string" && b.id.length > 0)
            .map((b) => `${b.id} (${typeof b.task === "string" && b.task ? b.task : "prep task"})`)
            .join(", ");
          const mealSummaryWithBatches = batchTableSummary
            ? `${mealSummary}\n\nBATCHES:\n${batchTableSummary}`
            : mealSummary;

          const prepTipPrompt = `You are a meal prep strategist. Given the complete 7-day meal plan below, analyze all recipes and generate a prep strategy as JSON.

MEAL PLAN:
${mealSummaryWithBatches}

PREP DAY: ${prepDay}
WEEK ORDER: ${orderedDays.join(", ")}

${skipDirective}Generate this JSON structure:
{
  "prepTips": [
    { "id": "tip-prep-1", "day": "${prepDay}", "tip": "...", "referenced_meal_ids": ["mon-dinner", "wed-lunch"] },
    ... (5-8 prep day tasks)${nightlyTipDays.map((d: string) => `,\n    { "id": "tip-${d.toLowerCase()}-night", "day": "${d}", "tip": "...", "referenced_meal_ids": ["..."] }`).join("")}
  ]
}

OUTPUT SCHEMA — required fields per tip:
- "id": optional kebab-case string (e.g., "tip-prep-1", "tip-mon-night"). Stable within the plan.
- "day": REQUIRED day name string (e.g., "Sunday", "Monday"). Never include "night" or other suffix.
- "tip": REQUIRED string — the prep task itself.
- "referenced_meal_ids": array of meal "id" strings (from the MEAL PLAN above) that this tip's work feeds into. STRONGLY PREFERRED on every tip. If you include ids, every id MUST exist in the plan JSON above — do not invent ids.

SPECIFICITY REQUIREMENT (PREP-01):
- Each prep-day tip MUST name the specific recipe(s) being prepped (no generic "batch-cook proteins" phrasing).
- For batch-cook style tips (verbs: roast, grill, bake, simmer, sear, braise, cook, sauté, poach) the tip MUST include a quantity. Example: "Roast 3 lbs chicken thighs on Sunday for Mon dinner (Sheet-Pan Chicken) and Wed lunch (Chicken Grain Bowl)."
- For light-prep tips (verbs: wash, chop, portion, set up, prep, mince, slice) quantities are optional. Example: "Wash and chop produce for Mon dinner and Tue lunch."
- Prep actions must be sensible for the food type: wash fresh produce only — never breads, wraps, tortillas, or dry goods.
- Nightly tips MUST point to the NEXT chronological cook day's meals — name the meal titles in the tip text.

RULES:

1. PREP DAY TASKS (5-8 tasks for ${prepDay}, all with "day": "${prepDay}"):
   Analyze all recipes and identify everything that can be prepped ahead. Order by impact — highest weeknight time saved first. Only include tasks that genuinely save time during the week.
   Types of prep day tasks (include whichever apply to the week's recipes):
   - Wash, chop, and portion vegetables that appear across multiple recipes — be specific about which vegetables and quantities
   - Cook proteins needed for early-week meals (days 1-3); freeze portions for days 4+
   - Prepare grains or legumes that will be reused across the week
   - Make sauces, dressings, and marinades that keep all week
   - Prep make-ahead breakfasts (overnight oats, egg muffins) and snacks (energy bites)
   - Pre-marinate meats for early-week dinners
   - Form/shape items that can be stored raw (meatballs, patties)
   Each task MUST include: specific action, a REALISTIC per-task time estimate written as "~N min" (e.g., "~25 min") that reflects how long THAT task genuinely takes — never a uniform placeholder reused across tasks — and which meals (by day + title) it feeds.
   Food safety: proteins cooked on prep day for use on days 4+ MUST include freeze-and-portion instructions. Grains beyond day 4 need the same.

2. EXACTLY ${nightlyTipDays.length} nightly prep tips, one per night.
   The "day" field must be ONLY the day name (e.g., "Monday", NOT "Monday night").
   Each nightly tip preps for the NEXT day's meals:
${nightlyTipDays.map((d: string, i: number) => {
  const nextDay = nightlyDays[i + 1];
  return `   - ${d} night preps for ${nextDay}'s meals`;
}).join("\n")}
   Rules for nightly tips:
   - Reference the NEXT day's specific meal titles and ingredients
   - NEVER reference the current day's meals — those are already done
   - Each nightly tip MUST name 2+ concrete actions on specific items (e.g., "thaw the chicken thighs, chop the bell peppers, and portion the rice") — never a single generic instruction like "set out ingredients for dinner".
   - Each nightly tip MUST include a REALISTIC per-task minute estimate written as "~N min" (e.g., "~8 min") that reflects the actual work. Do NOT stamp a uniform/boilerplate estimate (such as a blanket "~10 min") on every tip — vary it to the real task.
   - Include thaw reminders if tomorrow's meals use a frozen prep-day component (proteins/grains prepped on ${prepDay} and used on day 4+ of the week)
   - Keep tips actionable and specific (5–10 minutes of evening prep)
   - Worked example of the expected pattern: "Thaw the salmon fillets and whisk together the lemon-dill marinade for Tuesday's Baked Salmon (~8 min)."

3. Food safety: pre-cooked proteins last 3 days refrigerated, grains 4 days, sauces/dressings 5-7 days. For meals beyond the safe window, the prep day task must include freeze instructions and the corresponding nightly tip must include a thaw reminder.`;

          console.log(`[generate-meal-plan] Starting prep tips generation...`);
          let prepResult: Record<string, unknown>;
          if ((Date.now() - startTime) > RETRY_TIME_BUDGET_MS) {
            console.warn(`[generate-meal-plan] Skipped prep tips — time budget exceeded (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed); emitting plan without prep tips`);
            prepResult = { prepTips: [] };
          } else {
            try {
              prepResult = await withRetry(
                () => generateCompletion(
                  `You are a meal prep strategist. Respond with ONLY valid JSON.${retryAddendum}`,
                  [{ type: "text", text: prepTipPrompt }],
                  "",
                  API_KEY,
                  AI_MODEL,
                  { cerebrasBudget: 6000, cerebrasSchema: PREP_TIPS_SCHEMA, schemaName: "prep_tips" },
                ),
                { label: "prep-tips-generation" },
              );
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.warn(`[generate-meal-plan] Prep tips generation failed — emitting plan without prep tips:`, msg);
              prepResult = { prepTips: [] };
            }
          }

          // Validate prep tips schema
          const prepSchema = validatePrepTipsSchema(prepResult);
          if (!prepSchema.success) {
            console.warn(`[generate-meal-plan] Prep tips schema issues:`, prepSchema.issues.join("; "));
          }

          // --- Skip-slot strip (D-03/D-06/D-07): silently drop any prep tip whose day
          // is a fully-skipped day, whose text names a fully-skipped weekday, or whose
          // only meal references resolve to skipped/unresolvable slots — BEFORE merge/emit
          // so newly generated plans are saved clean at source. Never blocks save.
          const rawPrepTips = Array.isArray(prepResult.prepTips) ? prepResult.prepTips : [];
          let cleanedPrepTips = rawPrepTips;
          // Run for ANY skip (matches the frontend twin, D-04 "keep the rule identical"):
          // the referenced_meal_ids pairing check is meaningful even with only partial
          // skips. The day-field/text-scan rejections apply only to fully-skipped days.
          if (skipCount > 0 && rawPrepTips.length > 0) {
            // Resolve meal id -> { day, mealType } from the generated days.
            const mealSlotById = new Map<string, { day: string; mealType: string }>();
            for (const d of allDays) {
              for (const m of d.meals) {
                if (m && typeof m.id === "string") {
                  mealSlotById.set(m.id, { day: d.day, mealType: m.mealType });
                }
              }
            }
            // Whole-word regex over the closed set of skipped COOK day names — the prep
            // day is exempt (G-12-01). Server-derived, no user input — no ReDoS surface.
            // Null when there are no skipped cook days (an empty alternation would match every tip).
            const skipDayRegex = skippedCookDays.length > 0
              ? new RegExp(`\\b(${skippedCookDays.join("|")})\\b`, "i")
              : null;
            const skippedCookDaySet = new Set(skippedCookDays);
            cleanedPrepTips = rawPrepTips.filter((tip: { day?: string; tip?: string; referenced_meal_ids?: string[] }) => {
              // D-07a: structured day field is a skipped cook day → drop (prep day exempt, G-12-01).
              if (typeof tip.day === "string" && skippedCookDaySet.has(tip.day)) return false;
              // D-07a/c: text names a skipped cook day → drop (text scan wins, even with valid ids).
              if (skipDayRegex && typeof tip.tip === "string" && skipDayRegex.test(tip.tip)) return false;
              // D-07b/d: keep only referenced_meal_ids resolving to a known, non-skipped slot.
              if (Array.isArray(tip.referenced_meal_ids) && tip.referenced_meal_ids.length > 0) {
                const validIds = tip.referenced_meal_ids.filter((id: string) => {
                  const slot = mealSlotById.get(id);
                  return !!slot && !validatedSkipSlots[`${slot.day}:${slot.mealType}`];
                });
                if (validIds.length === 0) return false; // no valid id survives → drop
                tip.referenced_meal_ids = validIds; // ≥1 survives → keep with filtered ids
              }
              return true; // no referenced_meal_ids / empty → pairing check skipped (D-07d)
            });
            const strippedCount = rawPrepTips.length - cleanedPrepTips.length;
            if (strippedCount > 0) {
              console.warn(`[generate-meal-plan] Stripped ${strippedCount} skip-violating prep tip(s) before emit.`);
            }
          }

          clearInterval(keepalive);

          const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[generate-meal-plan] Full generation (meals + prep tips) complete in ${totalElapsed}s`);

          // Retries above can replace meals, so scan the plan that is actually going
          // out. Earlier violations are kept too because they include the judge's
          // findings, and matching is by title, so meals no longer in the plan are ignored.
          const finalMeals = allDays.flatMap((d) => d.meals.filter((m) => !m.pinned));
          const finalAllergenViolations = [...checkAllergens(finalMeals, userAllergens), ...allergenViolations];
          markAllergenCautions(finalMeals, finalAllergenViolations);

          // Build validation warnings for client
          const validationWarnings = [
            ...(finalAllergenViolations.length > 0 ? [`Allergen safety: potential allergens detected in recipes — please review ingredients carefully.`] : []),
            ...bizValidation.violations.filter((v) => v.severity === "error").map((v) => v.message),
          ];

          const merged = {
            weekPlan: {
              // D-05: overwrite AI-emitted title with deterministic dinner-distribution builder.
              title: computeDinnerCuisineTitle(allDays) ?? "Weekly Meal Plan",
              days: allDays,
              batchCookDay,           // edge-authoritative source of truth (D-01/D-02)
              // D-01 (emission wiring): thread the AI-emitted batches[] through so
              // normalizeMealPlan receives raw.weekPlan.batches. The validation-retry
              // path is already covered by Object.assign(result, bizRetryResult) above,
              // which copies the retry's batches onto result before this literal runs.
              batches: Array.isArray(result.batches) ? result.batches : [],
            },
            prepTips: cleanedPrepTips,
            ...(validationWarnings.length > 0 ? { warnings: validationWarnings } : {}),
          };

          // Emit the merged result as SSE data events
          const jsonStr = JSON.stringify(merged);
          for (let i = 0; i < jsonStr.length; i += CHUNK_SIZE) {
            const chunk = jsonStr.slice(i, i + CHUNK_SIZE);
            const sseEvent = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
            controller.enqueue(encoder.encode(`data: ${sseEvent}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          clearInterval(keepalive);
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("generate-meal-plan stream error:", msg);
          const errEvent = JSON.stringify({ error: { message: msg } });
          controller.enqueue(encoder.encode(`data: ${errEvent}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-meal-plan error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
