/**
 * Post-AI business logic validation for meal plans.
 *
 * Runs after Zod schema validation passes. Catches semantic issues the schema
 * can't express: duplicate days, nutrition gaps, protein variety, leftover
 * chain integrity, food safety, seasoning depth, shopping list quality.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MealPlanValidationOptions {
  /** Ordered day names for the week (e.g. ["Sunday", "Monday", ...]) */
  orderedDays: string[];
  /** Validated skip slots (e.g. { "Wednesday:dinner": true }) */
  skipSlots?: Record<string, true>;
  /** Household size from profile (for serving count validation) */
  householdSize?: number;
  /** Dietary preferences from profile. These are treated as plan constraints when selected. */
  dietaryPreferences?: string[];
  /** Preferred cuisines from profile. These are preference signals, not hard exclusions. */
  preferredCuisines?: string[];
  /** Whether every meal should include toddler-friendly support. */
  toddlerFriendly?: boolean;
  /** Whether every meal should include glucose-friendly support. */
  glucoseFriendly?: boolean;
  /** AI-emitted named prep batches for this plan (BATCH-01, D-21). OPTIONAL
   * with a `[]` default — NOT a required positional param — so legacy call
   * sites that don't pass it yet still type-check (wave-3 seam with 17-07's
   * sibling call-site update; order-independent either way). */
  batches?: Array<{
    id: string;
    task: string | null;
    yield: string | null;
    storage: string | null;
    useBy: string | null;
    time: string | null;
  }>;
}

export interface ValidationViolation {
  rule: string;
  severity: "error" | "warning";
  message: string;
}

export interface MealPlanValidationResult {
  valid: boolean;
  violations: ValidationViolation[];
}

interface Meal {
  id?: string;
  source_meal_id?: string;
  /** Lifecycle status (Phase 15, MEAL-01). Only field the phantom-leftover
   * guard below needs — the 5 display-only fields (cautionNote/workflow/
   * storage/cookTime/totalTime) are not validated server-side. */
  status?: "fresh" | "prep-linked" | "leftover";
  title: string;
  mealType: string;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  ingredients: Array<{ name: string; [key: string]: unknown }>;
  steps: string[];
  toddlerTip?: string;
  glucoseTip?: string;
  flavorNotes?: string;
  pinned?: boolean;
  /** Batch ids this meal consumes (BATCH-01, D-04). Validated against the
   * plan's declared batches[] by batch_ref_unresolved/leftover_batch_missing
   * below — resolution only, never the mnemonic letter choice (D-03). */
  uses?: string[];
  /** Batch id this meal creates, if it is a batch/leftover source
   * (BATCH-01, D-04). Validated against batches[] the same way as uses[]. */
  creates?: string | null;
  /** AI-emitted nutrition/dietary tags (e.g. "Low Carb", "High Protein",
   * "Mediterranean"). Free string array, additive/optional (Phase 18,
   * NUTR-02) — consumed by contradictoryNutritionTags below; unrelated
   * cuisine/lifestyle tags are never validated. */
  tags?: string[];
}

interface DayPlan {
  day: string;
  meals: Meal[];
}

// ---------------------------------------------------------------------------
// Common seasoning words that don't count toward the >=3 seasoning rule
// ---------------------------------------------------------------------------

const EXCLUDED_SEASONINGS = new Set([
  "salt", "kosher salt", "sea salt", "pepper", "black pepper",
  "oil", "olive oil", "extra-virgin olive oil", "vegetable oil",
  "canola oil", "cooking spray", "avocado oil",
]);

// ponytail: duplicated from generate-meal-plan/index.ts SLOT_ORDER — no shared module worth the coupling
const SLOT_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;

/** Count distinct seasonings in an ingredient list (beyond salt/pepper/oil). */
function countSeasonings(ingredients: Array<{ name: string }>): number {
  const found = new Set<string>();
  for (const ing of ingredients) {
    const lower = ing.name.toLowerCase().trim();
    // Skip if it's an excluded base seasoning
    if (EXCLUDED_SEASONINGS.has(lower)) continue;
    // Look for spice/herb keywords
    const spiceMatch = lower.match(
      /\b(cumin|paprika|smoked paprika|oregano|thyme|basil|rosemary|coriander|turmeric|cinnamon|cayenne|chili powder|chili flake|garlic powder|onion powder|za'atar|sumac|dill|mint|parsley|cilantro|sage|bay leaf|nutmeg|allspice|cardamom|ginger|curry powder|garam masala|chipotle|ancho|saffron|fennel seed|mustard seed|red pepper flake|italian seasoning|herbes de provence|five.?spice|tajin|adobo|berbere|harissa|ras el hanout|everything bagel seasoning)\b/
    );
    if (spiceMatch) {
      found.add(spiceMatch[1]);
    }
  }
  return found.size;
}

// ---------------------------------------------------------------------------
// Protein detection
// ---------------------------------------------------------------------------

const PROTEIN_KEYWORDS: Record<string, string[]> = {
  chicken: ["chicken"],
  beef: ["beef", "ground beef", "steak", "sirloin", "chuck"],
  pork: ["pork", "bacon", "ham", "sausage", "prosciutto", "chorizo"],
  turkey: ["turkey", "ground turkey"],
  lamb: ["lamb"],
  fish: ["salmon", "tuna", "cod", "tilapia", "halibut", "trout", "snapper", "bass", "catfish", "mahi", "swordfish", "anchovy", "sardine", "white fish"],
  shrimp: ["shrimp", "prawn"],
  tofu: ["tofu"],
  tempeh: ["tempeh"],
  eggs: ["egg", "eggs"],
  lentils: ["lentil", "lentils"],
  beans: ["bean", "beans", "chickpea", "chickpeas", "black bean", "kidney bean", "cannellini", "white bean"],
};

/** Identify the primary protein in a meal from its ingredients. */
function detectProtein(ingredients: Array<{ name: string }>): string | null {
  const text = ingredients.map(i => i.name).join(" ").toLowerCase();
  for (const [protein, keywords] of Object.entries(PROTEIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return protein;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Leftover detection
// ---------------------------------------------------------------------------

/** Heuristic: a meal is a leftover if its ingredients reference another meal's title. */
function isLeftoverMeal(meal: Meal, allTitles: Set<string>): boolean {
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  const steps = Array.isArray(meal.steps) ? meal.steps : [];
  const ingText = ingredients.map(i => i.name).join(" ").toLowerCase();
  for (const title of allTitles) {
    if (title !== String(meal.title).toLowerCase() && ingText.includes(title)) {
      return true;
    }
  }
  // Also check common leftover patterns
  return /\bleftover\b|\breheat\b|\bfrom\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
    .test(ingredients.map(i => i.name).join(" ") + " " + steps.join(" "));
}

/** A source recipe can intentionally make extra servings for a later leftover meal. */
function isLeftoverSourceMeal(meal: Meal): boolean {
  const steps = Array.isArray(meal.steps) ? meal.steps : [];
  const text = steps.join(" ").toLowerCase();
  return /\b(portion|reserve|save)\b.*\b(leftover|later|tomorrow|lunch|dinner|refrigerate|freeze)\b/.test(text) ||
    /\b(refrigerate|freeze)\b.*\b(leftover|portion|half)\b/.test(text);
}

// ---------------------------------------------------------------------------
// Recipe completeness detection (VALID-01, D-04/D-05) — the §A2b "Step 1 and
// nothing else" defect. Tiered minimum step counts + a served-or-stored
// final-step check, factored into one helper so both validateMealPlan's
// per-meal loop and validateSwapMeal (D-07) run the same two rules.
// ---------------------------------------------------------------------------

const DINNER_MIN_STEPS = 4;
const LUNCH_MIN_STEPS = 2;
const BREAKFAST_MIN_STEPS = 2;
const SNACK_MIN_STEPS = 1;
/** Leftover reheat-and-serve meals are legitimately short — overrides the
 * mealType tier floor regardless of mealType (RESEARCH A2). */
const LEFTOVER_MIN_STEPS = 2;

const STEP_TIER_FLOORS: Record<string, number> = {
  breakfast: BREAKFAST_MIN_STEPS,
  lunch: LUNCH_MIN_STEPS,
  dinner: DINNER_MIN_STEPS,
  snack: SNACK_MIN_STEPS,
};

// Served-or-stored terminal-step keyword alternation — flat, ReDoS-safe
// (T-16-01), matching every other heuristic in this file (hasGluten,
// isLeftoverMeal). serve/store/plate/garnish are corpus-attested
// (RESEARCH.md Code Examples); enjoy/finish/chill/freeze are generous
// [ASSUMED] extensions.
const SERVED_OR_STORED_PATTERN = /\b(serve|served|serving|plate|plated|garnish|store|stored|refrigerate|portion|transfer|enjoy|finish|chill|freeze)\b/i;

// ---------------------------------------------------------------------------
// Nutrition plausibility constants (Phase 18, NUTR-01/02) — live-telemetry
// calibration knobs. Tune after observing real violation rates; do not
// hand-wave new thresholds directly into the rule bodies below.
// ---------------------------------------------------------------------------

// Atwater internal-consistency tolerance (D-02/D-03). The deviation base is
// REPORTED calories (not the computed Atwater value) — this is deliberate:
// the daysWith() secondary fixture in validation_test.ts deviates 100 kcal
// off a 420-kcal reported value (23.8%, under the 105 kcal band here) but
// 31% off its own 320-kcal Atwater value (would breach a 25%-of-Atwater
// band). Flipping the base breaks ~20 existing tests via fixture fallout.
const ATWATER_TOL_PCT = 0.25;
const ATWATER_TOL_FLOOR_KCAL = 75;

// Per-serving bounds sanity (D-04) — generous, mealType-differentiated. The
// classic failure this catches: whole-recipe macros pasted into a
// per-serving field (a 4-serving dinner reporting ~1600 kcal/serving).
const CAL_MIN_MAIN = 100;
const CAL_MAX_MAIN = 1400;
const CAL_MIN_SNACK = 40;
const CAL_MAX_SNACK = 700;
const PROTEIN_MAX = 100;
const CARBS_MAX = 250;
const FATS_MAX = 150;

// Keto/low-carb thresholds (D-07) — single source of truth shared between
// dietary_preference_mismatch (below) and nutrition_tag_contradiction
// (Task 2). Never duplicate these numbers.
const KETO_MAX_CARBS = 20;
const LOW_CARB_MAX_CARBS = 35;

// High-protein tag floor (D-07) — FDA "high protein" claim standard is
// >=20% DV (>=10g protein/serving); flag the tag only when protein falls
// BELOW this floor (bias-lean underflag). Outlier protein-claim floor
// (D-05) — the value above which a missing protein-source ingredient is
// suspicious enough to warn on.
const HIGH_PROTEIN_TAG_MIN = 10;
const PROTEIN_OUTLIER_FLOOR = 40;

/**
 * Shared per-meal completeness checks. Returns steps_too_few when the step
 * count is below the meal's tier floor (dinner-tier meals use the leftover
 * override when status === "leftover") and steps_no_finish when neither of
 * the last 1-2 steps reaches a served-or-stored final step.
 */
function checkMealCompleteness(meal: Meal): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const steps = Array.isArray(meal.steps) ? meal.steps : [];

  const floor = meal.status === "leftover"
    ? LEFTOVER_MIN_STEPS
    : STEP_TIER_FLOORS[meal.mealType] ?? LUNCH_MIN_STEPS;

  if (steps.length < floor) {
    violations.push({
      rule: "steps_too_few",
      severity: "error",
      message: `"${meal.title}" (${meal.mealType}) has ${steps.length} step(s) but needs at least ${floor}`,
    });
  }

  const tail = steps.slice(-Math.min(2, steps.length));
  const hasFinish = tail.some((step) => SERVED_OR_STORED_PATTERN.test(step));
  if (!hasFinish) {
    violations.push({
      rule: "steps_no_finish",
      severity: "error",
      message: `"${meal.title}" method does not reach a served-or-stored final step`,
    });
  }

  return violations;
}

/**
 * Shared per-meal batch-integrity check (BATCH-02, D-21) — mirrors
 * checkMealCompleteness's "one function, two callers" shape so both
 * validateMealPlan's per-meal loop and validateSwapMeal (Phase 16 D-07
 * detect-and-log parity) run the same rule. Biased-lean: flags a
 * status:"leftover" meal ONLY when it has zero usable batch reference at
 * all (empty uses[], or — when batchIds is available — every uses[] entry
 * fails to resolve). Partial-resolution problems are already reported
 * per-ref by batch_ref_unresolved above; this rule is the "clear structural
 * break" backstop, never a judgment call. When batchIds is omitted (the
 * validateSwapMeal/regen surface, which has no access to the plan's full
 * batches[] table), only the "empty" half of the check runs — swap-meal
 * structurally cannot emit uses/creates/status:"leftover" at all (D-04), so
 * this is a defensive no-op there today, ready for a future caller that does
 * pass a leftover-status meal.
 */
function checkLeftoverBatchMissing(
  meal: Meal & { dayName?: string },
  batchIds?: Set<string>,
): ValidationViolation[] {
  if (meal.status !== "leftover") return [];
  const uses = Array.isArray(meal.uses) ? meal.uses : [];
  const hasUsableBatchRef = batchIds
    ? uses.some((ref) => batchIds.has(ref))
    : uses.length > 0;
  if (hasUsableBatchRef) return [];
  const where = meal.dayName ? ` on ${meal.dayName}` : "";
  return [{
    rule: "leftover_batch_missing",
    severity: "error",
    message: `"${meal.title}"${where} has status:"leftover" but no resolving batch reference in uses[] — every leftover meal MUST reference at least one real batch id via uses.`,
  }];
}

/** Normalizes a free-text tag for matching (lowercase, hyphen/space-insensitive)
 * — mirrors normalizePreference's shape exactly. A small local copy rather
 * than coupling to generate-meal-plan's DIETARY_TAG_ALIASES (ponytail
 * precedent at line 97 favors this over cross-module coupling, per D-07). */
function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Pure, exported nutrition tag-vs-macro contradiction check (Phase 18,
 * NUTR-02, D-07). Consumed by this file's checkMealNutrition below AND by
 * Plan 18-02's edge-side tag strip / Plan 18-03's client-side tag strip
 * (contract: return the ORIGINAL, unnormalized tag strings that contradict).
 * Only the checkable macro-backed vocabulary participates — keto/low-carb
 * (carbs) and high-protein (protein). "High Fiber" and every non-nutrition
 * tag (cuisine, "Toddler-Friendly", "Mediterranean") are uncheckable and are
 * never matched, let alone returned. Each macro comparison is individually
 * Number.isFinite-guarded (T-18-01) so a malformed macro never throws.
 */
export function contradictoryNutritionTags(meal: Meal): string[] {
  const tags = Array.isArray(meal.tags) ? meal.tags : [];
  const contradictory: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const normalized = normalizeTag(tag);
    if (normalized === "keto" && Number.isFinite(meal.carbs) && meal.carbs > KETO_MAX_CARBS) {
      contradictory.push(tag);
    } else if (normalized === "low carb" && Number.isFinite(meal.carbs) && meal.carbs > LOW_CARB_MAX_CARBS) {
      contradictory.push(tag);
    } else if (normalized === "high protein" && Number.isFinite(meal.protein) && meal.protein < HIGH_PROTEIN_TAG_MIN) {
      contradictory.push(tag);
    }
  }
  return contradictory;
}

/**
 * Shared per-meal nutrition plausibility checks (Phase 18, NUTR-01/02).
 * Mirrors checkMealCompleteness's "one function, two callers" shape (D-08):
 * validateMealPlan's per-meal loop runs it with error-severity violations
 * riding the existing fix-retry; validateSwapMeal runs the identical helper
 * as detect-and-log only — no new retry loop is added there.
 *
 * The Atwater + bounds error checks below are gated on allFinite &&
 * allPositive so a zero or non-finite macro meal is owned solely by
 * nutrition_zero (D-04, no double-fire) and a malformed/Gemini-fallback
 * macro never throws (T-18-01, the coercion boundary).
 */
function checkMealNutrition(meal: Meal): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const { calories, protein, carbs, fats } = meal;

  const macros = [calories, protein, carbs, fats];
  const allFinite = macros.every((v) => Number.isFinite(v));
  const allPositive = allFinite && macros.every((v) => v > 0);

  if (allFinite && allPositive) {
    // nutrition_implausible (D-02/D-03): reported calories must approximate
    // 4*protein + 4*carbs + 9*fats (Atwater factors) within tolerance.
    const atwater = 4 * protein + 4 * carbs + 9 * fats;
    const tolerance = Math.max(ATWATER_TOL_PCT * calories, ATWATER_TOL_FLOOR_KCAL);
    if (Math.abs(calories - atwater) > tolerance) {
      violations.push({
        rule: "nutrition_implausible",
        severity: "error",
        message: `"${meal.title}" reports ${calories} calories but its macros (${protein}g protein, ${carbs}g carbs, ${fats}g fats) compute to ~${Math.round(atwater)} via Atwater factors (4/4/9 kcal per gram) — adjust calories or macros to agree.`,
      });
    }

    // nutrition_bounds (D-04): per-serving bounds sanity, mealType-differentiated.
    // Catches whole-recipe macros pasted into a per-serving field.
    const [calMin, calMax] = meal.mealType === "snack"
      ? [CAL_MIN_SNACK, CAL_MAX_SNACK]
      : [CAL_MIN_MAIN, CAL_MAX_MAIN];

    if (calories < calMin || calories > calMax) {
      violations.push({
        rule: "nutrition_bounds",
        severity: "error",
        message: `"${meal.title}" (${meal.mealType}) reports ${calories} calories per serving, outside the plausible ${calMin}-${calMax} range — check for whole-recipe macros pasted into a per-serving field.`,
      });
    }
    if (protein > PROTEIN_MAX) {
      violations.push({
        rule: "nutrition_bounds",
        severity: "error",
        message: `"${meal.title}" reports ${protein}g protein per serving, above the plausible max of ${PROTEIN_MAX}g — check for whole-recipe macros pasted into a per-serving field.`,
      });
    }
    if (carbs > CARBS_MAX) {
      violations.push({
        rule: "nutrition_bounds",
        severity: "error",
        message: `"${meal.title}" reports ${carbs}g carbs per serving, above the plausible max of ${CARBS_MAX}g — check for whole-recipe macros pasted into a per-serving field.`,
      });
    }
    if (fats > FATS_MAX) {
      violations.push({
        rule: "nutrition_bounds",
        severity: "error",
        message: `"${meal.title}" reports ${fats}g fats per serving, above the plausible max of ${FATS_MAX}g — check for whole-recipe macros pasted into a per-serving field.`,
      });
    }
  }

  // nutrition_tag_contradiction (D-07, warning): independent of the
  // allFinite/allPositive gate above — each macro comparison is individually
  // Number.isFinite-guarded inside contradictoryNutritionTags (T-18-01).
  for (const tag of contradictoryNutritionTags(meal)) {
    const normalized = normalizeTag(tag);
    let detail = "";
    if (normalized === "keto") {
      detail = `its ${carbs}g carbs exceed the Keto threshold of ${KETO_MAX_CARBS}g`;
    } else if (normalized === "low carb") {
      detail = `its ${carbs}g carbs exceed the Low Carb threshold of ${LOW_CARB_MAX_CARBS}g`;
    } else if (normalized === "high protein") {
      detail = `its ${protein}g protein is below the High Protein floor of ${HIGH_PROTEIN_TAG_MIN}g`;
    }
    violations.push({
      rule: "nutrition_tag_contradiction",
      severity: "warning",
      message: `"${meal.title}" is tagged "${tag}" but ${detail} — drop or correct the tag.`,
    });
  }

  // nutrition_protein_unsupported (D-05, warning): an outlier protein claim
  // with zero detectable protein-source ingredient. Only the outlier-value
  // branch (not a tag-claim branch, per D-05/Task 2 action) so the
  // Greek-yogurt 25g fixture stays clean — a "High Protein" tag on a
  // low-protein meal is already covered by the tag-contradiction check
  // above. detectProtein's documented dairy/nut blind spot is why this is
  // warning-only, never error.
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  if (
    detectProtein(ingredients) === null &&
    Number.isFinite(protein) &&
    protein >= PROTEIN_OUTLIER_FLOOR
  ) {
    violations.push({
      rule: "nutrition_protein_unsupported",
      severity: "warning",
      message: `"${meal.title}" reports ${protein}g protein but no protein-source ingredient was detected — verify the ingredient list supports this claim.`,
    });
  }

  return violations;
}

function normalizePreference(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mealIngredientText(meal: Meal): string {
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  return ingredients.map((ingredient) => ingredient.name).join(" ").toLowerCase();
}

function mealSearchText(meal: Meal): string {
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  const steps = Array.isArray(meal.steps) ? meal.steps : [];
  return [
    meal.title,
    meal.mealType,
    meal.toddlerTip ?? "",
    meal.glucoseTip ?? "",
    meal.flavorNotes ?? "",
    steps.join(" "),
    ingredients.map((ingredient) => ingredient.name).join(" "),
  ].join(" ").toLowerCase();
}

function cleanDairyAlternatives(text: string): string {
  return text
    .replace(/\b(?:almond|oat|soy|coconut|cashew|rice|hemp) milk\b/g, "")
    .replace(/\b(?:almond|peanut|cashew|sunflower|nut) butter\b/g, "");
}

function hasAnimalProtein(meal: Meal): boolean {
  return /\b(chicken|beef|pork|bacon|ham|sausage|turkey|lamb|veal|salmon|tuna|cod|tilapia|halibut|trout|snapper|sardine|anchovy|fish|shrimp|prawn|crab|lobster|clam|mussel|oyster|scallop|shellfish|gelatin)\b/
    .test(mealIngredientText(meal));
}

function hasEgg(meal: Meal): boolean {
  return /\b(egg|eggs)\b/.test(mealIngredientText(meal));
}

function hasDairy(meal: Meal): boolean {
  const text = cleanDairyAlternatives(mealIngredientText(meal));
  return /\b(milk|cheese|yogurt|butter|cream|feta|mozzarella|cheddar|parmesan|ricotta|cottage cheese|sour cream|ghee|half and half)\b/
    .test(text);
}

function hasGluten(meal: Meal): boolean {
  const text = mealIngredientText(meal);
  if (/\bgluten free\b/.test(text)) return false;
  return /\b(wheat|bread|pita|naan|tortilla|pasta|spaghetti|couscous|farro|barley|bulgur|seitan|breadcrumbs|croutons|soy sauce)\b/
    .test(text);
}

function hasGrains(meal: Meal): boolean {
  return /\b(rice|quinoa|oat|oats|wheat|bread|pasta|couscous|farro|barley|bulgur|corn|tortilla|flour)\b/
    .test(mealIngredientText(meal));
}

function hasLegumesOrSoy(meal: Meal): boolean {
  return /\b(bean|beans|chickpea|chickpeas|lentil|lentils|peanut|peanuts|soy|tofu|tempeh|edamame|hummus)\b/
    .test(mealIngredientText(meal));
}

function hasAddedSugarOrSweetener(meal: Meal): boolean {
  return /\b(sugar|brown sugar|maple syrup|honey|agave|molasses|corn syrup)\b/
    .test(mealIngredientText(meal));
}

function hasToddlerSupport(meal: Meal): boolean {
  if (meal.toddlerTip && meal.toddlerTip.trim().length > 0) return true;
  const text = mealSearchText(meal);
  return /\btoddler\b|\bfinger food\b|\bsoft texture\b|\bmild\b/.test(text);
}

function hasGlucoseSupport(meal: Meal): boolean {
  if (meal.glucoseTip && meal.glucoseTip.trim().length > 0) return true;
  const text = mealSearchText(meal);
  return /\bglucose\b|\blow glycemic\b|\blow-glycemic\b|\blow carb\b|\blow-carb\b|\bketo\b|\bblood sugar\b/.test(text);
}

function validateMealPersonalization(
  meal: Meal,
  options: Pick<MealPlanValidationOptions, "householdSize" | "dietaryPreferences" | "toddlerFriendly" | "glucoseFriendly">,
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const householdSize = typeof options.householdSize === "number" && Number.isFinite(options.householdSize) && options.householdSize > 0
    ? Math.round(options.householdSize)
    : null;

  if (householdSize && meal.servings !== householdSize && !isLeftoverSourceMeal(meal)) {
    violations.push({
      rule: "servings_household_mismatch",
      severity: "error",
      message: `"${meal.title}" serves ${meal.servings}, but the user's household size is ${householdSize}`,
    });
  }

  const preferences = (options.dietaryPreferences ?? []).map(normalizePreference);
  for (const preference of preferences) {
    if (preference === "mediterranean") continue;

    if (preference === "vegetarian" && hasAnimalProtein(meal)) {
      violations.push({
        rule: "dietary_preference_mismatch",
        severity: "error",
        message: `"${meal.title}" conflicts with Vegetarian preference`,
      });
    }

    if (preference === "vegan" && (hasAnimalProtein(meal) || hasEgg(meal) || hasDairy(meal) || /\bhoney\b/.test(mealIngredientText(meal)))) {
      violations.push({
        rule: "dietary_preference_mismatch",
        severity: "error",
        message: `"${meal.title}" conflicts with Vegan preference`,
      });
    }

    if (preference === "gluten free" && hasGluten(meal)) {
      violations.push({
        rule: "dietary_preference_mismatch",
        severity: "error",
        message: `"${meal.title}" conflicts with Gluten-Free preference`,
      });
    }

    if (preference === "dairy free" && hasDairy(meal)) {
      violations.push({
        rule: "dietary_preference_mismatch",
        severity: "error",
        message: `"${meal.title}" conflicts with Dairy-Free preference`,
      });
    }

    if (preference === "keto" && meal.carbs > KETO_MAX_CARBS) {
      violations.push({
        rule: "dietary_preference_mismatch",
        severity: "error",
        message: `"${meal.title}" has ${meal.carbs}g carbs, which conflicts with Keto preference`,
      });
    }

    if (preference === "low carb" && meal.carbs > LOW_CARB_MAX_CARBS) {
      violations.push({
        rule: "dietary_preference_mismatch",
        severity: "error",
        message: `"${meal.title}" has ${meal.carbs}g carbs, which conflicts with Low-Carb preference`,
      });
    }

    if (preference === "paleo" && (hasGrains(meal) || hasLegumesOrSoy(meal) || hasDairy(meal))) {
      violations.push({
        rule: "dietary_preference_mismatch",
        severity: "error",
        message: `"${meal.title}" conflicts with Paleo preference`,
      });
    }

    if (preference === "whole30" && (hasGrains(meal) || hasLegumesOrSoy(meal) || hasDairy(meal) || hasAddedSugarOrSweetener(meal))) {
      violations.push({
        rule: "dietary_preference_mismatch",
        severity: "error",
        message: `"${meal.title}" conflicts with Whole30 preference`,
      });
    }
  }

  if (options.toddlerFriendly && !hasToddlerSupport(meal)) {
    violations.push({
      rule: "missing_toddler_support",
      severity: "error",
      message: `"${meal.title}" is missing toddler-friendly guidance`,
    });
  }

  if (options.glucoseFriendly && !hasGlucoseSupport(meal)) {
    violations.push({
      rule: "missing_glucose_support",
      severity: "error",
      message: `"${meal.title}" is missing glucose-friendly guidance`,
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

/**
 * Validate a parsed meal plan against business rules.
 *
 * @param days - The days array from the AI response
 * @param shoppingList - The shopping list from the AI response
 * @param options - Validation context (ordered days, skip slots, etc.)
 */
export function validateMealPlan(
  days: DayPlan[],
  shoppingList: Array<{ name: string; quantity: string; aisle: string }>,
  options: MealPlanValidationOptions,
): MealPlanValidationResult {
  const violations: ValidationViolation[] = [];
  const { orderedDays, skipSlots = {}, batches = [] } = options;
  const skipCount = Object.keys(skipSlots).length;
  const totalExpectedMeals = 28 - skipCount;

  // --- Day structure checks ---

  // 1. Exactly 7 day objects
  if (days.length !== 7) {
    violations.push({
      rule: "day_count",
      severity: "error",
      message: `Expected 7 days, got ${days.length}`,
    });
  }

  // 2. No duplicate day names
  const dayNames = days.map((d) => d.day);
  const uniqueDays = new Set(dayNames);
  if (uniqueDays.size !== dayNames.length) {
    const dupes = dayNames.filter((d, i) => dayNames.indexOf(d) !== i);
    violations.push({
      rule: "duplicate_days",
      severity: "error",
      message: `Duplicate day names: ${[...new Set(dupes)].join(", ")}`,
    });
  }

  // 3. Correct day order
  const actualOrder = days.map((d) => d.day);
  const expectedOrder = orderedDays;
  if (actualOrder.length === 7) {
    for (let i = 0; i < 7; i++) {
      if (actualOrder[i] !== expectedOrder[i]) {
        violations.push({
          rule: "day_order",
          severity: "error",
          message: `Day ${i + 1} is "${actualOrder[i]}", expected "${expectedOrder[i]}"`,
        });
        break; // One message is enough
      }
    }
  }

  // --- Collect all non-pinned meals ---
  const allMeals: (Meal & { dayName: string })[] = [];
  for (const day of days) {
    for (const meal of day.meals) {
      if (meal.pinned) continue; // Skip pinned stubs
      allMeals.push({ ...meal, dayName: day.day });
    }
  }

  // 4. Every active slot has a meal
  if (allMeals.length < totalExpectedMeals * 0.9) {
    violations.push({
      rule: "meal_count",
      severity: "warning",
      message: `Expected ~${totalExpectedMeals} meals, got ${allMeals.length}`,
    });
  }

  // --- Nutrition checks ---

  // 5. All nutrition values non-zero
  for (const meal of allMeals) {
    if (meal.calories <= 0 || meal.protein <= 0 || meal.carbs <= 0 || meal.fats <= 0) {
      const zeros = [];
      if (meal.calories <= 0) zeros.push("calories");
      if (meal.protein <= 0) zeros.push("protein");
      if (meal.carbs <= 0) zeros.push("carbs");
      if (meal.fats <= 0) zeros.push("fats");
      violations.push({
        rule: "nutrition_zero",
        severity: "error",
        message: `"${meal.title}" has zero ${zeros.join(", ")}`,
      });
    }
  }

  // 6. Servings are positive integers
  for (const meal of allMeals) {
    if (!Number.isInteger(meal.servings) || meal.servings < 1) {
      violations.push({
        rule: "servings_invalid",
        severity: "error",
        message: `"${meal.title}" has invalid servings: ${meal.servings}`,
      });
    }

    violations.push(...validateMealPersonalization(meal, options));
  }

  // --- Variety checks ---

  // 7. Protein variety: >= 5 different proteins, chicken <= 3 meals
  const proteinCounts = new Map<string, number>();
  for (const meal of allMeals) {
    const protein = detectProtein(meal.ingredients);
    if (protein) {
      proteinCounts.set(protein, (proteinCounts.get(protein) || 0) + 1);
    }
  }

  const minProteins = skipCount > 0 ? Math.max(3, Math.ceil(totalExpectedMeals / 6)) : 5;
  const maxChicken = skipCount > 0 ? Math.max(2, Math.ceil(totalExpectedMeals / 9)) : 3;

  if (proteinCounts.size < minProteins) {
    violations.push({
      rule: "protein_variety",
      severity: "warning",
      message: `Only ${proteinCounts.size} different proteins (need >= ${minProteins}): ${[...proteinCounts.keys()].join(", ")}`,
    });
  }

  const chickenCount = proteinCounts.get("chicken") || 0;
  if (chickenCount > maxChicken) {
    violations.push({
      rule: "chicken_overuse",
      severity: "warning",
      message: `Chicken appears in ${chickenCount} meals (max ${maxChicken})`,
    });
  }

  // 8. No recipe title or concept repeated (except leftovers)
  const allTitles = new Set(allMeals.map((m) => m.title.toLowerCase()));
  const titleCounts = new Map<string, number>();
  for (const meal of allMeals) {
    const key = meal.title.toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  for (const [title, count] of titleCounts) {
    if (count > 1) {
      // Allow if one is a leftover variant
      const meals = allMeals.filter((m) => m.title.toLowerCase() === title);
      const hasLeftover = meals.some((m) => isLeftoverMeal(m, allTitles));
      if (!hasLeftover) {
        violations.push({
          rule: "duplicate_recipe",
          severity: "warning",
          message: `Recipe title repeated ${count}x: "${title}"`,
        });
      }
    }
  }

  // --- Seasoning & flavor checks ---

  // 9. >= 3 seasonings per recipe beyond salt/pepper/oil
  for (const meal of allMeals) {
    const seasoningCount = countSeasonings(meal.ingredients);
    if (seasoningCount < 3) {
      violations.push({
        rule: "seasoning_count",
        severity: "warning",
        message: `"${meal.title}" has only ${seasoningCount} seasonings (need >= 3)`,
      });
    }
  }

  // 10. flavorNotes present on every recipe
  for (const meal of allMeals) {
    if (!meal.flavorNotes || meal.flavorNotes.trim().length === 0) {
      violations.push({
        rule: "missing_flavor_notes",
        severity: "warning",
        message: `"${meal.title}" is missing flavorNotes`,
      });
    }
  }

  // --- Shopping list checks ---

  // 11. All 3 fields present on every item
  for (const item of shoppingList) {
    if (!item.name || !item.aisle) {
      violations.push({
        rule: "shopping_item_incomplete",
        severity: "warning",
        message: `Shopping list item missing fields: ${JSON.stringify(item)}`,
      });
    }
  }

  // 12. Item count within expected range
  const minItems = skipCount > 0 ? Math.max(15, Math.round(35 * totalExpectedMeals / 28)) : 35;
  const maxItems = skipCount > 0 ? Math.max(25, Math.round(55 * totalExpectedMeals / 28)) : 55;
  if (shoppingList.length < minItems) {
    violations.push({
      rule: "shopping_list_too_short",
      severity: "warning",
      message: `Shopping list has ${shoppingList.length} items (expected >= ${minItems})`,
    });
  }
  if (shoppingList.length > maxItems + 10) {
    // Allow some slack above max
    violations.push({
      rule: "shopping_list_too_long",
      severity: "warning",
      message: `Shopping list has ${shoppingList.length} items (expected <= ~${maxItems})`,
    });
  }

  // 13. Preferred cuisines should appear when possible, but they are not hard exclusions.
  const preferredCuisines = (options.preferredCuisines ?? [])
    .map(normalizePreference)
    .filter(Boolean);
  if (preferredCuisines.length > 0) {
    const matchingMeals = allMeals.filter((meal) => {
      const text = mealSearchText(meal);
      return preferredCuisines.some((cuisine) => text.includes(cuisine));
    });
    if (matchingMeals.length === 0) {
      violations.push({
        rule: "preferred_cuisine_missing",
        severity: "warning",
        message: `No meals clearly match preferred cuisines: ${options.preferredCuisines?.join(", ")}`,
      });
    }
  }

  // --- Leftover chain checks ---

  // 14. Leftover meals: source must be earlier in the week (cross-day AND same-day slot ordering).
  //     Scans title+steps+ingredients via mealSearchText (widened from ingredient-names-only).
  const dayIndex = new Map(orderedDays.map((d, i) => [d, i]));

  // Build id → position map for source_meal_id chronology check.
  const mealPos = new Map<string, { d: number; s: number }>();
  for (const m of allMeals) {
    if (m.id) {
      mealPos.set(m.id, {
        d: dayIndex.get(m.dayName) ?? -1,
        s: SLOT_ORDER.indexOf(m.mealType as typeof SLOT_ORDER[number]),
      });
    }
  }

  // 17. Serving math (VALID-04, D-10): a source meal referenced by 1+
  //     dependents via source_meal_id must have enough servings to cover its
  //     own household consumption PLUS every dependent's servings. Structured
  //     backlink only — no prose-yield text parsing (D-11). Build the
  //     sourceId -> dependents[] map once, right after mealPos (do not
  //     rebuild allTitles/mealPos above).
  const dependentsBySource = new Map<string, (Meal & { dayName: string })[]>();
  for (const m of allMeals) {
    if (!m.source_meal_id) continue;
    const list = dependentsBySource.get(m.source_meal_id) ?? [];
    list.push(m);
    dependentsBySource.set(m.source_meal_id, list);
  }

  // --- Batch integrity checks (BATCH-01, D-21) ---
  // batchIds + usedByBatch are built ONCE here, immediately after
  // mealPos/dependentsBySource (reuse pattern — not rebuilt per rule).
  // usedByBatch is consumed again below by batch_orphaned; batchIds is also
  // consumed by leftover_batch_missing further down (shared per-meal loop
  // with leftover_phantom).
  const batchIds = new Set(batches.map((b) => b.id));

  // batch_id_duplicate (error): iterate batches with a running Set; push a
  // violation on the SECOND occurrence of an id.
  const seenBatchIds = new Set<string>();
  for (const batch of batches) {
    if (seenBatchIds.has(batch.id)) {
      violations.push({
        rule: "batch_id_duplicate",
        severity: "error",
        message: `Batch id "${batch.id}" is declared more than once in batches[] — every batch id must be unique.`,
      });
    }
    seenBatchIds.add(batch.id);
  }

  const usedByBatch = new Map<string, (Meal & { dayName: string })[]>();
  for (const m of allMeals) {
    const uses = Array.isArray(m.uses) ? m.uses : [];
    for (const ref of uses) {
      const list = usedByBatch.get(ref) ?? [];
      list.push(m);
      usedByBatch.set(ref, list);
    }
  }

  // batch_ref_unresolved (error): every uses[] entry and non-null creates id
  // must resolve against batchIds. Message names the meal, the offending
  // ref, and the actual declared batch ids — concrete enough for the retry
  // to act on (16-02 fixture standard).
  for (const meal of allMeals) {
    const uses = Array.isArray(meal.uses) ? meal.uses : [];
    const declaredIds = [...batchIds].join(", ") || "(none declared)";
    for (const ref of uses) {
      if (!batchIds.has(ref)) {
        violations.push({
          rule: "batch_ref_unresolved",
          severity: "error",
          message: `"${meal.title}" on ${meal.dayName} references batch "${ref}" in uses[], but no batch with that id exists. Declared batch ids: ${declaredIds}.`,
        });
      }
    }
    if (meal.creates && !batchIds.has(meal.creates)) {
      violations.push({
        rule: "batch_ref_unresolved",
        severity: "error",
        message: `"${meal.title}" on ${meal.dayName} declares creates:"${meal.creates}", but no batch with that id exists. Declared batch ids: ${declaredIds}.`,
      });
    }
  }

  // Defensive householdSize normalization (RESEARCH.md Open Question 2):
  // fall back to the D-10 default when householdSize is absent, NaN, zero,
  // or negative, matching the same normalization validateMealPersonalization
  // already applies.
  const normalizedHouseholdSize =
    typeof options.householdSize === "number" &&
    Number.isFinite(options.householdSize) &&
    options.householdSize > 0
      ? Math.round(options.householdSize)
      : null;

  for (const [sourceId, dependents] of dependentsBySource) {
    const source = allMeals.find((m) => m.id === sourceId);
    if (!source) continue; // unresolvable — already caught by leftover_phantom/leftover_unresolvable_source
    const dependentSum = dependents.reduce((sum, d) => sum + (d.servings || 0), 0);
    const ownDayConsumption = normalizedHouseholdSize ?? (dependentSum + 1);
    if (source.servings < dependentSum + ownDayConsumption) {
      violations.push({
        rule: "serving_math_short",
        severity: "error",
        message: `"${source.title}" serves ${source.servings}, but needs >= ${dependentSum + ownDayConsumption} to cover its own household (${ownDayConsumption}) plus ${dependents.length} dependent leftover meal(s) totaling ${dependentSum} servings.`,
      });
    }
  }

  const DAYS_PAT = "(monday|tuesday|wednesday|thursday|friday|saturday|sunday)";

  for (const meal of allMeals) {
    if (!isLeftoverMeal(meal, allTitles)) continue;

    const mealDayIdx = dayIndex.get(meal.dayName) ?? -1;
    const mealSlotIdx = SLOT_ORDER.indexOf(meal.mealType as typeof SLOT_ORDER[number]);
    let flagged = false;

    // DAY-REF scan: widened surface (title+steps+ingredients) and dual pattern.
    const text = mealSearchText(meal);
    // P1: verb/preposition + day → "from friday", "reheat wednesday", "save for sunday"
    const p1 = text.match(new RegExp(`\\b(?:from|on|for|reheat(?:ed)?|reserve[d]?|save[d]?)\\s+${DAYS_PAT}`, "i"));
    // P2: day (+optional 's) + slot word → "wednesday's dinner", "wednesday dinner"
    const p2 = text.match(new RegExp(`\\b${DAYS_PAT}(?:'s|'s)?\\s+(breakfast|lunch|dinner|snack)`, "i"));

    const rawDay = p2 ? p2[1] : p1 ? p1[1] : null;
    if (rawDay) {
      const sourceDayName = rawDay.charAt(0).toUpperCase() + rawDay.slice(1).toLowerCase();
      const sourceDayIdx = dayIndex.get(sourceDayName) ?? -1;
      const refSlot = p2 ? SLOT_ORDER.indexOf(p2[2].toLowerCase() as typeof SLOT_ORDER[number]) : -1;

      if (sourceDayIdx > mealDayIdx) {
        // Forward cross-day reference
        violations.push({
          rule: "leftover_chain",
          severity: "error",
          message: `"${meal.title}" on ${meal.dayName} references ${sourceDayName} which is not earlier in the week`,
        });
        flagged = true;
      } else if (
        sourceDayIdx === mealDayIdx &&
        mealSlotIdx >= 0 && refSlot >= 0 &&
        refSlot >= mealSlotIdx
      ) {
        // Same-day, later-or-equal slot reference
        violations.push({
          rule: "leftover_chain",
          severity: "error",
          message: `"${meal.title}" on ${meal.dayName} references ${sourceDayName} which is not earlier in the week`,
        });
        flagged = true;
      }
    }

    // SOURCE_MEAL_ID chronology: a forward or same-slot link is invalid.
    if (!flagged && meal.source_meal_id && mealPos.has(meal.source_meal_id)) {
      const src = mealPos.get(meal.source_meal_id)!;
      const isEarlier =
        src.d < mealDayIdx ||
        (src.d === mealDayIdx && src.s >= 0 && mealSlotIdx >= 0 && src.s < mealSlotIdx);
      if (!isEarlier) {
        violations.push({
          rule: "leftover_chain",
          severity: "error",
          message: `"${meal.title}" on ${meal.dayName} links to a source meal that is not earlier in the week`,
        });
      }
    }
  }

  // --- Phantom-leftover guard (edge-side second defense layer) ---

  // 15. A meal with status === "leftover" MUST have a source_meal_id that
  //     resolves to a real meal id already present in this plan (reuses the
  //     mealPos map built above — not rebuilt). This mirrors the client's
  //     repairPhantomLeftovers + LEFTOVER_PHANTOM_MEAL gate (Plan 15-01) as an
  //     independent server-side guard (Architectural Responsibility Map row
  //     2). Chronology (source must be earlier) stays the existing
  //     leftover_chain rule's job above; this rule only guards resolution
  //     (existence) — a "leftover" status is phantom if source_meal_id is
  //     absent or does not point to any real meal in the plan.
  for (const meal of allMeals) {
    if (meal.status === "leftover" && (!meal.source_meal_id || !mealPos.has(meal.source_meal_id))) {
      violations.push({
        rule: "leftover_phantom",
        severity: "error",
        message: `"${meal.title}" on ${meal.dayName} has status:"leftover" but no resolving source_meal_id — every leftover meal MUST link to an earlier real meal in the plan via source_meal_id.`,
      });
    }

    // 16. Recipe completeness (VALID-01, D-04/D-05): tiered minimum step
    //     count + served-or-stored final step.
    violations.push(...checkMealCompleteness(meal));

    // 16c. Nutrition plausibility (Phase 18, NUTR-01/02, D-08): Atwater
    //      consistency + per-serving bounds (error, rides the fix-retry) +
    //      tag contradiction / protein heuristic (warning, Task 2).
    violations.push(...checkMealNutrition(meal));

    // 16b. leftover_batch_missing (BATCH-02, D-21, error, biased-lean):
    //      reuses the batchIds Set built above alongside mealPos.
    violations.push(...checkLeftoverBatchMissing(meal, batchIds));
  }

  // batch_orphaned (warning — never triggers retry, per D-21/T-17-22): a
  // declared batch that no meal's uses[] references. Reuses the usedByBatch
  // map built above alongside batchIds.
  for (const batch of batches) {
    const usedBy = usedByBatch.get(batch.id);
    if (!usedBy || usedBy.length === 0) {
      violations.push({
        rule: "batch_orphaned",
        severity: "warning",
        message: `Batch "${batch.id}" is declared but no meal's uses[] references it.`,
      });
    }
  }

  // 18. Leftover-unresolvable-source (VALID-03, D-08): a leftover-looking
  //     meal whose ingredient text textually matches an EARLIER meal's
  //     title, but has no resolving source_meal_id and no day-reference
  //     text, is a validation error — the rule-14 blind spot (a coarse
  //     dish-name match alone currently produces zero violations). A match
  //     against only a LATER meal's title is a coincidental overlap, not a
  //     leftover relationship, and must NOT flag (chronology guard,
  //     RESEARCH.md Pitfall 7). Reuses allTitles/mealPos/isLeftoverMeal/
  //     DAYS_PAT/dayIndex built above — does not rebuild any of them.
  for (const meal of allMeals) {
    if (!isLeftoverMeal(meal, allTitles)) continue;

    // Already resolves via a valid source_meal_id -> covered by
    // leftover_chain/leftover_phantom above, not this rule.
    if (meal.source_meal_id && mealPos.has(meal.source_meal_id)) continue;

    const mealDayIdx = dayIndex.get(meal.dayName) ?? -1;
    const mealSlotIdx = SLOT_ORDER.indexOf(meal.mealType as typeof SLOT_ORDER[number]);

    // Day-reference text (P1/P2) is already covered by leftover_chain above.
    const text = mealSearchText(meal);
    const p1 = text.match(new RegExp(`\\b(?:from|on|for|reheat(?:ed)?|reserve[d]?|save[d]?)\\s+${DAYS_PAT}`, "i"));
    const p2 = text.match(new RegExp(`\\b${DAYS_PAT}(?:'s|'s)?\\s+(breakfast|lunch|dinner|snack)`, "i"));
    if (p1 || p2) continue;

    // Coarse dish-name match: does this meal's ingredient text contain
    // another meal's title, and is that matched title's meal EARLIER
    // (chronology guard, Pitfall 7 — copies the src.d < mealDayIdx ||
    // (src.d === mealDayIdx && src.s < mealSlotIdx) comparison used for
    // the source_meal_id chronology check above)?
    const ingText = mealIngredientText(meal);
    const matchesEarlierTitle = allMeals.some((other) => {
      if (other === meal) return false;
      const otherTitle = other.title.toLowerCase();
      if (otherTitle === meal.title.toLowerCase()) return false;
      if (!ingText.includes(otherTitle)) return false;
      const otherDayIdx = dayIndex.get(other.dayName) ?? -1;
      const otherSlotIdx = SLOT_ORDER.indexOf(other.mealType as typeof SLOT_ORDER[number]);
      return (
        otherDayIdx < mealDayIdx ||
        (otherDayIdx === mealDayIdx && otherSlotIdx >= 0 && mealSlotIdx >= 0 && otherSlotIdx < mealSlotIdx)
      );
    });

    if (matchesEarlierTitle) {
      violations.push({
        rule: "leftover_unresolvable_source",
        severity: "error",
        message: `"${meal.title}" on ${meal.dayName} appears to reference an earlier meal by name but has no resolving source_meal_id — link it to its source meal via source_meal_id.`,
      });
    }
  }

  return {
    valid: violations.filter((v) => v.severity === "error").length === 0,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Swap meal validation (lighter version)
// ---------------------------------------------------------------------------

export function validateSwapMeal(
  meal: Meal,
  existingTitles: string[],
  options: Pick<MealPlanValidationOptions, "householdSize" | "dietaryPreferences" | "toddlerFriendly" | "glucoseFriendly"> = {},
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const title = typeof meal.title === "string" && meal.title.trim() ? meal.title : "Untitled meal";
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];

  // Nutrition non-zero
  if (meal.calories <= 0 || meal.protein <= 0 || meal.carbs <= 0 || meal.fats <= 0) {
    const zeros = [];
    if (meal.calories <= 0) zeros.push("calories");
    if (meal.protein <= 0) zeros.push("protein");
    if (meal.carbs <= 0) zeros.push("carbs");
    if (meal.fats <= 0) zeros.push("fats");
    violations.push({
      rule: "nutrition_zero",
      severity: "error",
      message: `Swap meal "${title}" has zero ${zeros.join(", ")}`,
    });
  }

  // No repeat
  if (existingTitles.map((t) => t.toLowerCase()).includes(title.toLowerCase())) {
    violations.push({
      rule: "duplicate_recipe",
      severity: "error",
      message: `Swap meal "${title}" duplicates an existing recipe`,
    });
  }

  violations.push(...validateMealPersonalization(meal, options));

  // Seasoning count
  const seasoningCount = countSeasonings(ingredients);
  if (seasoningCount < 3) {
    violations.push({
      rule: "seasoning_count",
      severity: "warning",
      message: `Swap meal "${title}" has only ${seasoningCount} seasonings (need >= 3)`,
    });
  }

  // flavorNotes
  if (!meal.flavorNotes || meal.flavorNotes.trim().length === 0) {
    violations.push({
      rule: "missing_flavor_notes",
      severity: "warning",
      message: `Swap meal "${title}" is missing flavorNotes`,
    });
  }

  // Recipe completeness (VALID-01, D-07: shared helper, detect-and-log only
  // — the caller already handles logging, no retry added here).
  violations.push(...checkMealCompleteness(meal));

  // leftover_batch_missing (BATCH-02, D-21: shared per-meal helper,
  // detect-and-log only — Phase 16 D-07 parity, no new retry loop here). No
  // batchIds available on this surface (swap-meal structurally cannot emit
  // uses/creates/status:"leftover" at all, D-04) — the "empty uses[]" half
  // of the check still runs, ready for a future caller that passes a
  // leftover-status meal (e.g. regenerate-day, which does get both fields).
  violations.push(...checkLeftoverBatchMissing(meal));

  // Nutrition plausibility (Phase 18, NUTR-01/02, D-08: shared helper,
  // detect-and-log only — no retry added on this surface).
  violations.push(...checkMealNutrition(meal));

  return violations;
}

/**
 * If the days array contains all 7 unique day names in a valid week rotation
 * (e.g. Sun-Sat shifted from the expected Mon-Sun start), return a new array
 * rotated so days[0].day === expectedFirstDay. Returns null if the days array
 * is incomplete, has duplicates, contains unknown day names, or cannot be fixed
 * by a single rotation.
 *
 * Used by generate-meal-plan to silently correct the common model failure mode
 * where the AI returns the correct 7 days but starts on the wrong one.
 */
export function rotateDaysToStart<T extends { day: string }>(
  days: T[],
  expectedFirstDay: string,
): T[] | null {
  const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (!Array.isArray(days) || days.length !== 7) return null;
  const names = days.map((d) => d.day);
  const unique = new Set(names);
  if (unique.size !== 7) return null;
  for (const name of names) {
    if (!WEEK.includes(name)) return null;
  }
  const startIdx = names.indexOf(expectedFirstDay);
  if (startIdx === -1) return null;
  // Build the canonical contiguous sequence starting at expectedFirstDay.
  const expectedSequence: string[] = [];
  const startWeekIdx = WEEK.indexOf(expectedFirstDay);
  for (let i = 0; i < 7; i++) expectedSequence.push(WEEK[(startWeekIdx + i) % 7]);
  // Rotate the AI's order so the expected first day leads. (When startIdx === 0
  // this is a no-op rotation, but we still verify contiguity below so scrambled
  // arrays that happen to start with the expected day are correctly rejected.)
  const rotated = [...days.slice(startIdx), ...days.slice(0, startIdx)];
  // For rotation to be valid, the rotated order must equal the canonical
  // sequence — otherwise the days are scrambled, not just rotated.
  for (let i = 0; i < 7; i++) {
    if (rotated[i].day !== expectedSequence[i]) return null;
  }
  // If startIdx === 0 and the contiguity check passed, the array is already
  // correct — return the original reference so callers can detect "no change".
  return startIdx === 0 ? days : rotated;
}

/**
 * Format violations into a concise string for AI retry prompts.
 */
export function formatViolationsForRetry(violations: ValidationViolation[]): string {
  return violations
    .filter((v) => v.severity === "error")
    .map((v) => `- ${v.message}`)
    .join("\n");
}
