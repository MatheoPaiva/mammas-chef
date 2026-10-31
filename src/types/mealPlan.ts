export interface PrepTip {
  day: string;
  tip: string;
  /** Stable identifier for this prep tip. Optional for backwards-compat with older
   * saved plans that lack the field (D-03). */
  id?: string;
  /** Ids of MealRecipe entries this prep tip references. Optional for backwards-compat
   * with older saved plans that lack the field (D-03). */
  referenced_meal_ids?: string[];
}

/** A named prep batch (D-02) — the structural unit meals reference via
 * MealRecipe.uses/creates instead of prompt-policed leftover mirroring.
 * All fields except `id` are required-but-nullable on the wire, matching the
 * strict-schema `["type", "null"]` convention already used for MealRecipe's
 * status/cautionNote/workflow/storage fields. The list of meals that consume
 * this batch is deliberately NOT a stored field here — it is always derived
 * client-side by scanning meals for `uses.includes(batch.id)` (D-02), never
 * AI-emitted or persisted. */
export interface PrepBatch {
  id: string;
  task: string | null;
  yield: string | null;
  storage: string | null;
  useBy: string | null;
  time: string | null;
}

export interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
  /** Pre-formatted display string (e.g. '1/2', '1 1/4'). Populated at parse time by
   * normalizeIngredient via toDisplayFraction. Renderers prefer this over re-formatting
   * quantity. Optional for backwards-compat with older saved plans (D-04). */
  displayQuantity?: string;
  prep?: string;
}

export interface MealRecipe {
  id: string;
  /** When set, this meal is a leftover whose source recipe is the meal with this id
   * in the same plan (D-03). Validator in Plan 07-04 verifies the id resolves to an
   * earlier-slot meal. */
  source_meal_id?: string;
  /** Ids of PrepBatch entries this meal consumes (D-04, D-15). Optional/undefined-tolerant
   * for backward compat with pre-Phase-17 plans that predate the batch model — absent
   * means no batch UI renders for this meal. */
  uses?: string[];
  /** Id of the PrepBatch entry this meal produces, when it is a batch-source meal
   * (D-04, D-15). Optional/undefined-tolerant for backward compat with pre-Phase-17
   * plans; `null` is a valid AI-emitted "no batch produced" signal, distinct from
   * absent (undefined) on legacy data. */
  creates?: string | null;
  /** Canonical recipe_library id when this recipe was sourced from the reusable library. */
  libraryRecipeId?: string;
  /** User-owned custom_recipes id when this recipe was sourced from a private custom recipe. */
  customRecipeId?: string;
  title: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  prepTime: string;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  
  tags: string[];
  ingredients: Ingredient[];
  steps: string[];
  toddlerTip?: string;
  glucoseTip?: string;
  flavorNotes?: string;
  /** Lifecycle status: fresh | prep-linked | leftover. "skipped" is NEVER stored here —
   * it is a render-time-only state derived from skip_slots (D-05). Optional for
   * backward-compat with plans generated before Phase 15 and the Gemini fallback path. */
  status?: "fresh" | "prep-linked" | "leftover";
  /** Short AI-generated hazard reason (toddler choking/sodium/spice), D-03. Independent
   * of `status` — a cautioned leftover is still status:"leftover". */
  cautionNote?: string;
  /** One-line workflow summary, terse imperative (MEAL-02). */
  workflow?: string;
  /** One-line storage instruction, terse imperative (MEAL-02). */
  storage?: string;
  /** Free-text, same "N min" convention as prepTime (MEAL-03). Additive — prepTime is
   * kept untouched for its ~12 existing consumers. */
  cookTime?: string;
  totalTime?: string;
}

export interface DayPlan {
  day: string;
  meals: MealRecipe[];
}

export interface WeekPlan {
  title: string;
  days: DayPlan[];
  /** The prep/batch-cook day for this plan (day before the week starts).
   * Edge-authoritative: set by generate-meal-plan and carried through the
   * JSON round-trip. Optional for backwards-compat with legacy saved plans
   * that pre-date Phase 11 (D-02, D-07). */
  batchCookDay?: string;
  /** Named prep batches for this plan (D-02, D-15). Optional for backward compat with
   * legacy plans that predate the batch model; normalizeMealPlan hard-defaults this to
   * [] on read so consumers can always safely call .length (D-05). */
  batches?: PrepBatch[];
}

export interface GroceryItem {
  name: string;
  quantity: string;
  aisle: string;
  status: "needed" | "on_hand";
  /** True when item should display "check pantry" (pantry-aisle item per D-04
   * or non-pantry item below the tiny-quantity threshold per D-05). Renderers
   * show a visual badge in the DOM; text exports append "(check pantry)" via
   * formatGroceryLine. */
  pantry?: boolean;
  /** Recipes that consume this grocery item, for shopping-list traceability
   * (D-18, SHOP-04). Optional — absent on legacy plans or when the D-19 echo-id
   * did not round-trip; UI shows no expand affordance in that case. */
  sources?: Array<{ mealId: string; title: string; day: string; mealType: string }>;
}

/** Keys are "DayName:mealType", e.g. "Wednesday:dinner" */
export type SkipSlots = Record<string, true>;

export function skipSlotKey(day: string, mealType: string): string {
  return `${day}:${mealType}`;
}

export function isSlotSkipped(skipSlots: SkipSlots | undefined, day: string, mealType: string): boolean {
  return !!skipSlots?.[skipSlotKey(day, mealType)];
}

export interface MealPlanResponse {
  weekPlan: WeekPlan;
  shoppingList: GroceryItem[];
  prepTips: PrepTip[];
  startDate?: string;
  notes?: string;
  pantryItems?: string[];
  skipSlots?: SkipSlots;
}
