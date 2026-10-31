import { z } from "npm:zod@3";

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

export const ShoppingItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.string(),
  aisle: z.string().min(1),
});

export const PrepTipSchema = z.object({
  day: z.string().min(1),
  tip: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Meal / Recipe schema
// ---------------------------------------------------------------------------

const VALID_MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

export const IngredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  unit: z.string(),
  prep: z.string().optional(),
});

export const MealSchema = z.object({
  id: z.string().min(1),
  libraryRecipeId: z.string().min(1).optional(),
  customRecipeId: z.string().min(1).optional(),
  title: z.string().min(3),
  mealType: z.enum(VALID_MEAL_TYPES),
  prepTime: z.string().min(1),
  servings: z.number().int().min(1),
  calories: z.number().min(1),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fats: z.number().min(0),
  tags: z.array(z.string()),
  ingredients: z.array(IngredientSchema).min(1),
  steps: z.array(z.string()).min(1),
  toddlerTip: z.string().optional(),
  glucoseTip: z.string().optional(),
  flavorNotes: z.string().min(1),
  pinned: z.boolean().optional(),
  // NEW for Phase 15 (log-only/non-blocking — additions are for diagnostic
  // quality, not enforcement; raw JSON still flows downstream regardless):
  source_meal_id: z.string().optional(),
  status: z.enum(["fresh", "prep-linked", "leftover"]).optional(),
  cautionNote: z.string().optional(),
  workflow: z.string().optional(),
  storage: z.string().optional(),
  cookTime: z.string().optional(),
  totalTime: z.string().optional(),
  // NEW for Phase 17 (log-only/non-blocking — additions are for diagnostic
  // quality, not enforcement; raw JSON still flows downstream regardless):
  uses: z.array(z.string()).optional(),
  creates: z.string().nullable().optional(),
});

// BatchSchema (D-02): id is the reference anchor; task/yield/storage/useBy/time
// are all nullable, matching the strict json_schema's BATCH_SCHEMA and the
// client PrepBatch interface so all three surfaces agree.
export const BatchSchema = z.object({
  id: z.string(),
  task: z.string().nullable(),
  yield: z.string().nullable(),
  storage: z.string().nullable(),
  useBy: z.string().nullable(),
  time: z.string().nullable(),
});

/** Relaxed meal schema for pinned stubs (all zeros allowed). */
const PinnedMealSchema = z.object({
  id: z.string().min(1),
  libraryRecipeId: z.string().min(1).optional(),
  customRecipeId: z.string().min(1).optional(),
  title: z.string().min(1),
  mealType: z.enum(VALID_MEAL_TYPES),
  pinned: z.literal(true),
}).passthrough();

const MealPlanMealSchema = z.union([MealSchema, PinnedMealSchema]);

export const DayPlanSchema = z.object({
  day: z.string().min(1),
  meals: z.array(MealPlanMealSchema),
});

// ---------------------------------------------------------------------------
// Raw AI response for full meal plan generation
// The AI returns { title, days, shoppingList } — the edge function wraps it
// into { weekPlan: { title, days }, shoppingList, prepTips }.
// ---------------------------------------------------------------------------

export const MealPlanAIResponseSchema = z.object({
  title: z.string().min(1),
  days: z.array(DayPlanSchema).min(1).max(7),
  shoppingList: z.array(ShoppingItemSchema).optional().default([]),
  // NEW for Phase 17 (log-only/non-blocking, D-24): batches is diagnostic only.
  batches: z.array(BatchSchema).optional(),
});

// ---------------------------------------------------------------------------
// Raw AI response for meal swap
// ---------------------------------------------------------------------------

export const SwapResponseSchema = z.object({
  newMeal: MealSchema,
  updatedPrepTips: z.array(PrepTipSchema),
  newShoppingItems: z.array(ShoppingItemSchema),
});

// ---------------------------------------------------------------------------
// Prep tips AI response
// ---------------------------------------------------------------------------

export const PrepTipsAIResponseSchema = z.object({
  prepTips: z.array(PrepTipSchema).min(1),
});

// ---------------------------------------------------------------------------
// Safe parse helpers — return { success, data?, issues? }
// ---------------------------------------------------------------------------

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  issues: string[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}

/**
 * Validate a raw AI meal plan response against the Zod schema.
 * Pinned recipe stubs (pinned: true) are accepted as lightweight placeholders
 * and must not be stripped from the raw object because generation code later
 * merges them with the full client-side recipe data.
 */
export function validateMealPlanSchema(
  raw: unknown,
): ValidationResult<z.infer<typeof MealPlanAIResponseSchema>> {
  const result = MealPlanAIResponseSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, issues: formatZodIssues(result.error) };
}

export function validateSwapSchema(
  raw: unknown,
): ValidationResult<z.infer<typeof SwapResponseSchema>> {
  const result = SwapResponseSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, issues: formatZodIssues(result.error) };
}

export function validatePrepTipsSchema(
  raw: unknown,
): ValidationResult<z.infer<typeof PrepTipsAIResponseSchema>> {
  const result = PrepTipsAIResponseSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, issues: formatZodIssues(result.error) };
}
