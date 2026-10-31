import { supabase } from "@/integrations/supabase/client";
import { insertRecipeIntoPlan } from "@/services/mealPlanDbService";
import { normalizeUuid } from "@/lib/uuid";
import type { Ingredient, MealPlanResponse, MealRecipe } from "@/types/mealPlan";
import type { RecipeMealType, RecipeSearchFilters } from "@/types/recipeLibrary";

interface RecipeLibraryQueryBuilder {
  select(columns: string): RecipeLibraryQueryBuilder;
  in(column: string, values: string[]): RecipeLibraryQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): RecipeLibraryQueryBuilder;
  limit(count: number): RecipeLibraryQueryBuilder;
  contains(column: string, value: string[]): RecipeLibraryQueryBuilder;
  lte(column: string, value: number): RecipeLibraryQueryBuilder;
  ilike(column: string, pattern: string): RecipeLibraryQueryBuilder;
  textSearch(column: string, query: string, options?: { type?: "plain" | "phrase" | "websearch" }): RecipeLibraryQueryBuilder;
  eq(column: string, value: string): RecipeLibraryQueryBuilder;
  single(): Promise<{ data: unknown; error: { message?: string } | null }>;
  then<TResult1 = { data: RecipeLibraryRow[] | null; error: { message?: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: RecipeLibraryRow[] | null; error: { message?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2>;
}

interface RecipeLibrarySupabaseClient {
  from(table: "recipe_library"): RecipeLibraryQueryBuilder;
}

const db = supabase as unknown as RecipeLibrarySupabaseClient;

const RECIPE_LIBRARY_SELECT = "id,title,cuisine,region,meal_types,diet_tags,flavor_tags,active_time_minutes,total_time_minutes,servings,calories,protein,carbs,fats,ingredients,steps,toddler_tip,glucose_tip,status,source_attribution";

export interface RecipeLibraryRow {
  id: string;
  title: string;
  cuisine?: string | null;
  region?: string | null;
  meal_types?: string[] | null;
  diet_tags?: string[] | null;
  flavor_tags?: string[] | null;
  active_time_minutes?: number | null;
  total_time_minutes?: number | null;
  servings?: number | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  ingredients?: unknown;
  steps?: unknown;
  toddler_tip?: string | null;
  glucose_tip?: string | null;
  status?: string | null;
  source_attribution?: string | null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asMealType(value: unknown): RecipeMealType {
  return value === "breakfast" || value === "lunch" || value === "snack" ? value : "dinner";
}

function formatPrepTime(row: RecipeLibraryRow): string {
  const active = row.active_time_minutes;
  const total = row.total_time_minutes;
  if (typeof active === "number" && typeof total === "number" && active !== total) {
    return `${active} min active / ${total} min total`;
  }
  if (typeof total === "number") return `${total} min`;
  if (typeof active === "number") return `${active} min active`;
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

function mapIngredients(value: unknown): Ingredient[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Ingredient[] => {
    if (!item || typeof item !== "object") return [];
    const ingredient = item as Record<string, unknown>;
    const name = typeof ingredient.name === "string" ? ingredient.name : "";
    const quantity = typeof ingredient.quantity === "number" ? ingredient.quantity : Number(ingredient.quantity ?? 0);
    const unit = typeof ingredient.unit === "string" ? ingredient.unit : "";
    const prep = typeof ingredient.prep === "string" ? ingredient.prep : undefined;
    return name ? [{ name, quantity: Number.isFinite(quantity) ? quantity : 0, unit, prep }] : [];
  });
}

function normalizeIngredientNeedle(value: string): string {
  return value.trim().toLowerCase();
}

function ingredientNames(row: RecipeLibraryRow): string[] {
  return mapIngredients(row.ingredients).map((ingredient) => ingredient.name.toLowerCase());
}

function ingredientNameMatches(names: string[], needle: string): boolean {
  const normalized = normalizeIngredientNeedle(needle);
  return !!normalized && names.some((name) => name.includes(normalized));
}

function rowTags(row: RecipeLibraryRow): string[] {
  return [...asStringArray(row.diet_tags), ...asStringArray(row.flavor_tags), row.cuisine, row.region]
    .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    .map((tag) => tag.toLowerCase());
}

function tagMatches(tags: string[], needle: string): boolean {
  const normalized = needle.trim().toLowerCase();
  return !!normalized && tags.includes(normalized);
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]*/g)?.filter((term) => term.length > 1) ?? [];
}

function rowTitle(row: RecipeLibraryRow): string {
  return row.title.toLowerCase();
}

function rowMealTypes(row: RecipeLibraryRow): string[] {
  return asStringArray(row.meal_types).map((mealType) => mealType.toLowerCase());
}

function scoreNeedleMatches(values: string[], needles: string[], points: number): number {
  return needles.reduce((score, needle) => (
    values.some((value) => value.includes(needle.trim().toLowerCase())) ? score + points : score
  ), 0);
}

export function scoreRecipeLibraryRow(row: RecipeLibraryRow, filters: RecipeSearchFilters = {}, query = ""): number {
  const title = rowTitle(row);
  const names = ingredientNames(row);
  const tags = rowTags(row);
  const terms = queryTerms(query);

  let score = 0;
  for (const term of terms) {
    if (title === term) score += 12;
    else if (title.includes(term)) score += 8;
    if (names.some((name) => name.includes(term))) score += 4;
    if (tags.some((tag) => tag.includes(term))) score += 3;
  }

  if (filters.mealType && rowMealTypes(row).includes(filters.mealType)) score += 4;
  if (filters.cuisine && tags.some((tag) => tag.includes(filters.cuisine!.toLowerCase()))) score += 3;
  score += scoreNeedleMatches(names, filters.includeIngredients ?? [], 5);
  score += scoreNeedleMatches(tags, filters.tags ?? [], 3);
  score += scoreNeedleMatches(asStringArray(row.diet_tags).map((tag) => tag.toLowerCase()), filters.dietTags ?? [], 3);
  score += scoreNeedleMatches(asStringArray(row.flavor_tags).map((tag) => tag.toLowerCase()), filters.flavorTags ?? [], 3);

  return score;
}

function rankRecipeLibraryRows(rows: RecipeLibraryRow[], filters: RecipeSearchFilters, query: string): RecipeLibraryRow[] {
  return [...rows].sort((a, b) => {
    const scoreDelta = scoreRecipeLibraryRow(b, filters, query) - scoreRecipeLibraryRow(a, filters, query);
    return scoreDelta || a.title.localeCompare(b.title);
  });
}

function matchesClientSideFilters(row: RecipeLibraryRow, filters: RecipeSearchFilters): boolean {
  const includeIngredients = filters.includeIngredients?.filter((ingredient) => ingredient.trim()) ?? [];
  const avoidIngredients = filters.avoidIngredients?.filter((ingredient) => ingredient.trim()) ?? [];
  const broadTags = filters.tags?.filter((tag) => tag.trim()) ?? [];
  const flavorTags = filters.flavorTags?.filter((tag) => tag.trim()) ?? [];
  const cuisine = filters.cuisine?.trim().toLowerCase();

  const names = ingredientNames(row);
  const tags = rowTags(row);

  return includeIngredients.every((ingredient) => ingredientNameMatches(names, ingredient)) &&
    avoidIngredients.every((ingredient) => !ingredientNameMatches(names, ingredient)) &&
    broadTags.every((tag) => tagMatches(tags, tag)) &&
    flavorTags.every((tag) => tagMatches(asStringArray(row.flavor_tags).map((tag) => tag.toLowerCase()), tag)) &&
    (!cuisine || tags.some((tag) => tag.includes(cuisine))) &&
    (!filters.toddlerFriendly || !!row.toddler_tip?.trim()) &&
    (!filters.glucoseFriendly || !!row.glucose_tip?.trim());
}

function mapSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      return [(item as { text: string }).text];
    }
    return [];
  });
}

function hasCompleteRecipeSnapshot(meal: MealRecipe): boolean {
  return meal.ingredients.length > 0 &&
    meal.steps.length > 0 &&
    meal.servings > 0 &&
    meal.calories > 0 &&
    meal.protein >= 0 &&
    meal.carbs >= 0 &&
    meal.fats >= 0;
}

function mergeCanonicalRecipeSnapshot(canonical: MealRecipe, meal: MealRecipe, libraryRecipeId: string): MealRecipe {
  if (!hasCompleteRecipeSnapshot(meal)) {
    return {
      ...canonical,
      id: meal.id || canonical.id,
      mealType: meal.mealType,
      libraryRecipeId,
    };
  }

  return {
    ...canonical,
    ...meal,
    id: meal.id || canonical.id,
    mealType: meal.mealType,
    libraryRecipeId,
    tags: meal.tags.length > 0 ? meal.tags : canonical.tags,
    ingredients: meal.ingredients.length > 0 ? meal.ingredients : canonical.ingredients,
    steps: meal.steps.length > 0 ? meal.steps : canonical.steps,
    toddlerTip: meal.toddlerTip ?? canonical.toddlerTip,
    glucoseTip: meal.glucoseTip ?? canonical.glucoseTip,
    flavorNotes: meal.flavorNotes ?? canonical.flavorNotes,
  };
}

export function recipeLibraryRowToMealRecipe(row: RecipeLibraryRow): MealRecipe {
  const mealTypes = asStringArray(row.meal_types);
  const dietTags = asStringArray(row.diet_tags);
  const flavorTags = asStringArray(row.flavor_tags);

  return {
    id: row.id,
    libraryRecipeId: row.id,
    title: row.title,
    mealType: asMealType(mealTypes[0]),
    prepTime: formatPrepTime(row),
    servings: toPositiveInt(row.servings, 2),
    calories: toPositiveInt(row.calories, 350),
    protein: toNonNegativeInt(row.protein, 0),
    carbs: toNonNegativeInt(row.carbs, 0),
    fats: toNonNegativeInt(row.fats, 0),
    tags: Array.from(new Set([...dietTags, ...flavorTags, row.cuisine, row.region].filter((tag): tag is string => !!tag))),
    ingredients: mapIngredients(row.ingredients),
    steps: mapSteps(row.steps),
    toddlerTip: row.toddler_tip ?? undefined,
    glucoseTip: row.glucose_tip ?? undefined,
    flavorNotes: undefined,
  };
}

function buildRecipeLibraryFullTextQuery(filters: RecipeSearchFilters, query: string): string {
  return Array.from(new Set([
    query,
    ...(filters.includeIngredients ?? []),
    ...(filters.tags ?? []),
  ]
    .map((term) => term.trim())
    .filter(Boolean)))
    .join(" ");
}

function buildRecipeLibrarySearchRequest(filters: RecipeSearchFilters, query: string, useTextSearch: boolean) {
  const fullTextQuery = buildRecipeLibraryFullTextQuery(filters, query);
  let request = db
    .from("recipe_library")
    .select(RECIPE_LIBRARY_SELECT)
    .in("status", filters.statuses ?? ["reviewed", "tested"])
    .order("title", { ascending: true })
    .limit(50);

  if (filters.mealType) request = request.contains("meal_types", [filters.mealType]);
  if (filters.dietTags?.length) request = request.contains("diet_tags", filters.dietTags);
  if (filters.flavorTags?.length) request = request.contains("flavor_tags", filters.flavorTags);
  if (filters.maxTotalTimeMinutes) request = request.lte("total_time_minutes", filters.maxTotalTimeMinutes);
  // Cuisine is intentionally post-filtered client-side because users often type
  // regions like "Greek" while canonical rows may store cuisine="Mediterranean"
  // and region="Greek-inspired".
  if (useTextSearch && fullTextQuery) request = request.textSearch("search_vector", fullTextQuery, { type: "websearch" });

  return request;
}

function isSearchVectorUnavailable(message?: string): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("search_vector") && (
    normalized.includes("column") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find") ||
    normalized.includes("does not exist")
  );
}

export async function searchRecipeLibrary(filters: RecipeSearchFilters = {}, query = ""): Promise<RecipeLibraryRow[]> {
  const normalizedQuery = query.trim();
  let { data, error } = await buildRecipeLibrarySearchRequest(filters, normalizedQuery, true);

  // Older local/staging databases may have recipe_library but not the generated
  // search_vector yet. Keep browse/search usable by falling back to structured
  // filters plus client-side ranking instead of making the whole Recipes page fail.
  if (error && normalizedQuery && isSearchVectorUnavailable(error.message)) {
    ({ data, error } = await buildRecipeLibrarySearchRequest(filters, normalizedQuery, false));
  }

  if (error) throw error;
  return rankRecipeLibraryRows(
    (data ?? []).filter((row) => matchesClientSideFilters(row, filters)),
    filters,
    normalizedQuery,
  );
}

export async function searchMealRecipesFromLibrary(filters: RecipeSearchFilters = {}, query = ""): Promise<MealRecipe[]> {
  const rows = await searchRecipeLibrary(filters, query);
  return rows.map(recipeLibraryRowToMealRecipe);
}

export async function getRecipeLibraryMealRecipe(id: string): Promise<MealRecipe> {
  const { data, error } = await db
    .from("recipe_library")
    .select(RECIPE_LIBRARY_SELECT)
    .eq("id", id)
    .single();

  if (error) throw error;
  if (!data) throw new Error("Recipe library item not found");
  return recipeLibraryRowToMealRecipe(data as RecipeLibraryRow);
}

export async function addLibraryRecipeToPlan(
  recipeId: string,
  dayId: string,
  mealType: RecipeMealType,
  replace = false
): Promise<MealRecipe> {
  const recipe = await getRecipeLibraryMealRecipe(recipeId);
  const recipeForSlot = { ...recipe, mealType };
  await insertRecipeIntoPlan(dayId, recipeForSlot, replace);
  return recipeForSlot;
}

export async function hydrateLibraryRecipeReferences(mealPlan: MealPlanResponse): Promise<MealPlanResponse> {
  const rawLibraryIds = mealPlan.weekPlan.days
    .flatMap((day) => day.meals)
    .map((meal) => meal.libraryRecipeId)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  const libraryIds = Array.from(new Set(
    rawLibraryIds
      .map(normalizeUuid)
      .filter((id): id is string => !!id)
  ));

  if (rawLibraryIds.length === 0) return mealPlan;

  const clearUnknownLibraryReferences = (rowsById: Map<string, RecipeLibraryRow> = new Map()) => ({
    ...mealPlan,
    weekPlan: {
      ...mealPlan.weekPlan,
      days: mealPlan.weekPlan.days.map((day) => ({
        ...day,
        meals: day.meals.map((meal) => {
          const libraryId = normalizeUuid(meal.libraryRecipeId);
          if (!libraryId) return meal.libraryRecipeId ? { ...meal, libraryRecipeId: undefined } : meal;

          const row = rowsById.get(libraryId);
          if (!row) return { ...meal, libraryRecipeId: undefined };

          const canonical = recipeLibraryRowToMealRecipe(row);
          // Keep generated/adapted complete snapshots intact. The canonical row
          // is a fallback for lightweight stubs and missing metadata only.
          return mergeCanonicalRecipeSnapshot(canonical, meal, row.id);
        }),
      })),
    },
  });

  if (libraryIds.length === 0) return clearUnknownLibraryReferences();

  const { data, error } = await db
    .from("recipe_library")
    .select(RECIPE_LIBRARY_SELECT)
    .in("id", libraryIds);

  if (error) throw error;

  const rowsById = new Map((data ?? []).map((row) => [row.id, row]));
  return clearUnknownLibraryReferences(rowsById);
}
