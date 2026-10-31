import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { asIngredients } from "@/lib/ingredientParser";
import { normalizeCustomRecipeInput, normalizeCustomRecipeNutrition, validateCustomRecipeInput } from "@/lib/customRecipeValidation";
import { insertRecipeIntoPlan } from "@/services/mealPlanDbService";
import type { CustomRecipeInput, CustomRecipeNutrition, CustomRecipeRow } from "@/types/customRecipe";
import type { Ingredient, MealRecipe } from "@/types/mealPlan";

interface CustomRecipeDbError {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
}

interface CustomRecipesQueryBuilder {
  select(columns: string): CustomRecipesQueryBuilder;
  insert(payload: Record<string, unknown>): { select(columns: string): { single(): Promise<{ data: CustomRecipeRow | null; error: CustomRecipeDbError | null }> } };
  update(payload: Record<string, unknown>): CustomRecipesQueryBuilder;
  eq(column: string, value: string): CustomRecipesQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): CustomRecipesQueryBuilder;
  single(): Promise<{ data: CustomRecipeRow | null; error: CustomRecipeDbError | null }>;
  then<TResult1 = { data: CustomRecipeRow[] | null; error: CustomRecipeDbError | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: CustomRecipeRow[] | null; error: CustomRecipeDbError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2>;
}

interface CustomRecipeSupabaseClient {
  from(table: "custom_recipes"): CustomRecipesQueryBuilder;
}

const db = supabase as unknown as CustomRecipeSupabaseClient;

const CUSTOM_RECIPE_SELECT = "id,user_id,title,meal_type,servings,prep_time_minutes,tags,ingredients,steps,toddler_tip,glucose_tip,flavor_notes,calories,protein,carbs,fats,status,created_at,updated_at";
const CUSTOM_RECIPE_SETUP_MESSAGE = "Custom recipe storage is not set up for this Supabase project. Apply supabase/migrations/20260519000000_add_custom_recipes.sql and reload the API schema.";

export function getCustomRecipeErrorMessage(error: CustomRecipeDbError | null | undefined, fallback: string): string {
  if (!error) return fallback;

  const text = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  if (
    text.includes("custom_recipes")
    && (
      text.includes("schema cache")
      || text.includes("could not find")
      || text.includes("does not exist")
      || text.includes("pgrst205")
    )
  ) {
    return CUSTOM_RECIPE_SETUP_MESSAGE;
  }

  return error.message ?? fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asStepStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      return [(item as { text: string }).text];
    }
    return [];
  });
}

function asMealType(value: string): MealRecipe["mealType"] {
  return value === "breakfast" || value === "lunch" || value === "snack" ? value : "dinner";
}

function formatPrepTime(minutes: number | null): string {
  if (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) return `${minutes} min`;
  return "Time varies";
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : fallback;
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : fallback;
}

export function customRecipeRowToMealRecipe(row: CustomRecipeRow): MealRecipe {
  return {
    id: row.id,
    customRecipeId: row.id,
    title: row.title,
    mealType: asMealType(row.meal_type),
    prepTime: formatPrepTime(row.prep_time_minutes),
    servings: toPositiveInt(row.servings, 2),
    calories: toPositiveInt(row.calories, 350),
    protein: toNonNegativeInt(row.protein, 0),
    carbs: toNonNegativeInt(row.carbs, 0),
    fats: toNonNegativeInt(row.fats, 0),
    tags: asStringArray(row.tags),
    ingredients: asIngredients(row.ingredients),
    steps: asStepStrings(row.steps),
    toddlerTip: row.toddler_tip ?? undefined,
    glucoseTip: row.glucose_tip ?? undefined,
    flavorNotes: row.flavor_notes ?? undefined,
  };
}

export async function estimateCustomRecipeNutrition(input: CustomRecipeInput): Promise<CustomRecipeNutrition> {
  const normalized = normalizeCustomRecipeInput(input);
  const { data, error } = await supabase.functions.invoke("estimate-custom-recipe-nutrition", {
    body: {
      title: normalized.title,
      servings: normalized.servings,
      ingredients: normalized.ingredients,
      steps: normalized.steps,
    },
  });

  if (error) throw new Error(error.message);
  const nutrition = normalizeCustomRecipeNutrition(data?.nutrition ?? data);
  if (!nutrition) throw new Error("AI nutrition estimate was invalid.");
  return nutrition;
}

function buildWritePayload(userId: string, input: CustomRecipeInput, nutrition: CustomRecipeNutrition) {
  const normalized = normalizeCustomRecipeInput(input);
  return {
    user_id: userId,
    title: normalized.title,
    meal_type: normalized.mealType,
    servings: normalized.servings,
    prep_time_minutes: normalized.prepTimeMinutes,
    tags: normalized.tags as unknown as Json,
    ingredients: normalized.ingredients as unknown as Json,
    steps: normalized.steps.map((text, index) => ({ order: index + 1, text })) as unknown as Json,
    toddler_tip: normalized.toddlerTip ?? null,
    glucose_tip: normalized.glucoseTip ?? null,
    flavor_notes: normalized.flavorNotes ?? null,
    calories: nutrition.calories,
    protein: nutrition.protein,
    carbs: nutrition.carbs,
    fats: nutrition.fats,
    status: "active",
  };
}

export async function listCustomRecipes(): Promise<MealRecipe[]> {
  const { data, error } = await db
    .from("custom_recipes")
    .select(CUSTOM_RECIPE_SELECT)
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(getCustomRecipeErrorMessage(error, "Failed to load custom recipes"));
  return (data ?? []).map(customRecipeRowToMealRecipe);
}

export async function getCustomRecipeRow(recipeId: string): Promise<CustomRecipeRow> {
  const { data, error } = await db
    .from("custom_recipes")
    .select(CUSTOM_RECIPE_SELECT)
    .eq("id", recipeId)
    .single();

  if (error || !data) throw new Error(getCustomRecipeErrorMessage(error, "Custom recipe not found"));
  return data;
}

export async function getCustomRecipeMealRecipe(recipeId: string): Promise<MealRecipe> {
  return customRecipeRowToMealRecipe(await getCustomRecipeRow(recipeId));
}

export async function createCustomRecipe(userId: string, input: CustomRecipeInput): Promise<MealRecipe> {
  const normalized = normalizeCustomRecipeInput(input);
  const errors = validateCustomRecipeInput(normalized);
  if (errors.length > 0) throw new Error(errors[0]);

  const nutrition = await estimateCustomRecipeNutrition(normalized);
  const { data, error } = await db
    .from("custom_recipes")
    .insert(buildWritePayload(userId, normalized, nutrition))
    .select(CUSTOM_RECIPE_SELECT)
    .single();

  if (error || !data) throw new Error(getCustomRecipeErrorMessage(error, "Failed to save custom recipe"));
  return customRecipeRowToMealRecipe(data);
}

export async function updateCustomRecipe(recipeId: string, userId: string, input: CustomRecipeInput): Promise<MealRecipe> {
  const normalized = normalizeCustomRecipeInput(input);
  const errors = validateCustomRecipeInput(normalized);
  if (errors.length > 0) throw new Error(errors[0]);

  const nutrition = await estimateCustomRecipeNutrition(normalized);
  const { data, error } = await db
    .from("custom_recipes")
    .update(buildWritePayload(userId, normalized, nutrition))
    .eq("id", recipeId)
    .select(CUSTOM_RECIPE_SELECT)
    .single();

  if (error || !data) throw new Error(getCustomRecipeErrorMessage(error, "Failed to update custom recipe"));
  return customRecipeRowToMealRecipe(data);
}

export async function archiveCustomRecipe(recipeId: string): Promise<void> {
  const { error } = await db
    .from("custom_recipes")
    .update({ status: "archived" })
    .eq("id", recipeId);
  if (error) throw new Error(getCustomRecipeErrorMessage(error, "Failed to archive custom recipe"));
}

export async function addCustomRecipeToPlan(
  recipeId: string,
  dayId: string,
  mealType: MealRecipe["mealType"],
  replace = false,
): Promise<MealRecipe> {
  const recipe = await getCustomRecipeMealRecipe(recipeId);
  const recipeForSlot = { ...recipe, mealType };
  await insertRecipeIntoPlan(dayId, recipeForSlot, replace);
  return recipeForSlot;
}

export function customRecipeInputFromMealRecipe(recipe: MealRecipe): CustomRecipeInput {
  const prepMinutes = Number.parseInt(recipe.prepTime, 10);
  return {
    title: recipe.title,
    mealType: recipe.mealType,
    servings: recipe.servings,
    prepTimeMinutes: Number.isFinite(prepMinutes) ? prepMinutes : null,
    tags: recipe.tags,
    ingredients: recipe.ingredients as Ingredient[],
    steps: recipe.steps,
    toddlerTip: recipe.toddlerTip,
    glucoseTip: recipe.glucoseTip,
    flavorNotes: recipe.flavorNotes,
  };
}
