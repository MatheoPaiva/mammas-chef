import type { MealRecipe } from "@/types/mealPlan";
import type { RecipeMealType, RecipeSearchFilters } from "@/types/recipeLibrary";

export type ModifierCategory =
  | "time"
  | "protein"
  | "diet"
  | "meal"
  | "flavor"
  | "tag"
  | "cuisine"
  | "ingredient"
  | "avoid";

export interface ParseRecipeSearchQueryOptions {
  /**
   * Categories whose modifiers should be dropped from the parsed filters AND
   * from the queryTerms output. Used when the caller has an explicit chip-cleared
   * signal that must dominate over modifier syntax (CONTEXT D-16).
   *
   * Note: "ingredient" is an alias of the "protein" chip family (the only UI chip
   * that drives includeIngredients). Suppressing "protein" also drops ingredient
   * shorthand modifiers.
   */
  suppress?: ReadonlySet<ModifierCategory>;
}

const MEAL_TYPES = new Set<RecipeMealType>(["breakfast", "lunch", "dinner", "snack"]);

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Converts lightweight search chips into structured recipe filters while keeping
 * the rest as full-text query. Supported modifiers:
 * - ingredient:chickpea or include:chickpea
 * - avoid:shrimp
 * - cuisine:Greek
 * - tag:lemony (matches diet or flavor tags)
 * - diet:high-protein
 * - flavor:herby
 * - under:30, max:30, time:30
 * - meal:lunch
 *
 * @param options.suppress - Categories whose modifiers must be ignored (e.g. the
 *   user explicitly cleared the corresponding chip). Suppressed tokens are
 *   dropped entirely — they do NOT round-trip into the queryTerms output.
 *   Matches the "chips win on conflict" rule (CONTEXT D-16 / WR-02 fix).
 */
function tokenizeSearchQuery(rawQuery: string): string[] {
  return rawQuery.match(/[a-zA-Z]+:"[^"]+"|"[^"]+"|\S+/g) ?? [];
}

function unquote(value: string): string {
  return value.replace(/^"|"$/g, "").trim();
}

export function parseRecipeSearchQuery(
  rawQuery: string,
  baseFilters: RecipeSearchFilters = {},
  options: ParseRecipeSearchQueryOptions = {},
): { query: string; filters: RecipeSearchFilters } {
  const filters: RecipeSearchFilters = {
    ...baseFilters,
    tags: baseFilters.tags ? [...baseFilters.tags] : undefined,
    dietTags: baseFilters.dietTags ? [...baseFilters.dietTags] : undefined,
    flavorTags: baseFilters.flavorTags ? [...baseFilters.flavorTags] : undefined,
    includeIngredients: baseFilters.includeIngredients ? [...baseFilters.includeIngredients] : undefined,
    avoidIngredients: baseFilters.avoidIngredients ? [...baseFilters.avoidIngredients] : undefined,
  };
  const queryTerms: string[] = [];

  const isSuppressed = (category: ModifierCategory): boolean =>
    options.suppress?.has(category) ?? false;

  for (const token of tokenizeSearchQuery(rawQuery)) {
    const cleaned = unquote(token);
    const modifierMatch = cleaned.match(/^([a-zA-Z]+):(.+)$/);
    if (!modifierMatch) {
      queryTerms.push(cleaned);
      continue;
    }

    const [, rawKey, rawValue] = modifierMatch;
    const key = rawKey.toLowerCase();
    const value = unquote(rawValue);
    if (!value) continue;

    if (["ingredient", "include", "has"].includes(key)) {
      if (isSuppressed("protein") || isSuppressed("ingredient")) continue;
      filters.includeIngredients = [...(filters.includeIngredients ?? []), ...splitCsv(value)];
      continue;
    }

    if (["avoid", "without", "exclude"].includes(key)) {
      if (isSuppressed("avoid")) continue;
      filters.avoidIngredients = [...(filters.avoidIngredients ?? []), ...splitCsv(value)];
      continue;
    }

    if (key === "cuisine" || key === "region") {
      if (isSuppressed("cuisine")) continue;
      filters.cuisine = value;
      continue;
    }

    if (key === "tag") {
      if (isSuppressed("tag")) continue;
      filters.tags = [...(filters.tags ?? []), ...splitCsv(value)];
      continue;
    }

    if (key === "diet") {
      if (isSuppressed("diet")) continue;
      filters.dietTags = [...(filters.dietTags ?? []), ...splitCsv(value)];
      continue;
    }

    if (key === "flavor") {
      if (isSuppressed("flavor")) continue;
      filters.flavorTags = [...(filters.flavorTags ?? []), ...splitCsv(value)];
      continue;
    }

    if (["under", "max", "time"].includes(key)) {
      if (isSuppressed("time")) continue;
      const minutes = parsePositiveInt(value);
      if (minutes) filters.maxTotalTimeMinutes = minutes;
      continue;
    }

    if (key === "meal" || key === "type") {
      if (isSuppressed("meal")) continue;
      const mealType = value.toLowerCase() as RecipeMealType;
      if (MEAL_TYPES.has(mealType)) filters.mealType = mealType;
      continue;
    }

    queryTerms.push(cleaned);
  }

  return {
    query: queryTerms.join(" ").trim(),
    filters,
  };
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function recipeTimeMinutes(recipe: MealRecipe): number | undefined {
  const totalMatch = recipe.prepTime.match(/(\d+)\s*min(?:ute)?s?\s*total/i);
  if (totalMatch) return Number.parseInt(totalMatch[1], 10);

  const minuteMatches = Array.from(recipe.prepTime.matchAll(/\d+/g), (match) => Number.parseInt(match[0], 10))
    .filter((minutes) => Number.isFinite(minutes));
  if (minuteMatches.length === 0) return undefined;

  // Recipe cards may say "20 min active / 40 min total". If the word "total" is
  // missing, using the largest duration keeps the fallback filter conservative.
  return Math.max(...minuteMatches);
}

/** Applies the same lightweight constraints to in-memory fallback/favorite recipes. */
export function recipeMatchesSearch(recipe: MealRecipe, filters: RecipeSearchFilters, query = ""): boolean {
  if (filters.mealType && recipe.mealType !== filters.mealType) return false;

  const tags = recipe.tags.map(normalize);
  if (filters.tags?.length && !filters.tags.every((tag) => tags.includes(normalize(tag)))) return false;
  if (filters.dietTags?.length && !filters.dietTags.every((tag) => tags.includes(normalize(tag)))) return false;
  if (filters.flavorTags?.length && !filters.flavorTags.every((tag) => tags.includes(normalize(tag)))) return false;

  if (filters.toddlerFriendly && !recipe.toddlerTip?.trim()) return false;
  if (filters.glucoseFriendly && !recipe.glucoseTip?.trim()) return false;

  if (filters.cuisine) {
    const cuisine = normalize(filters.cuisine);
    if (!tags.some((tag) => tag.includes(cuisine))) return false;
  }

  if (filters.maxTotalTimeMinutes) {
    const minutes = recipeTimeMinutes(recipe);
    if (minutes !== undefined && minutes > filters.maxTotalTimeMinutes) return false;
  }

  const ingredientNames = recipe.ingredients.map((ingredient) => normalize(ingredient.name));
  if (filters.includeIngredients?.length && !filters.includeIngredients.every((ingredient) => (
    ingredientNames.some((name) => name.includes(normalize(ingredient)))
  ))) return false;
  if (filters.avoidIngredients?.length && filters.avoidIngredients.some((ingredient) => (
    ingredientNames.some((name) => name.includes(normalize(ingredient)))
  ))) return false;

  const haystack = [recipe.title, ...tags, ...ingredientNames].map(normalize);
  const queryTerms = tokenizeSearchQuery(query).map(unquote).map(normalize).filter(Boolean);
  if (queryTerms.length === 0) return true;

  return queryTerms.every((term) => haystack.some((value) => value.includes(term)));
}
