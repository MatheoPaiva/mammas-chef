/**
 * Shared deterministic dinner-cuisine title module (TITLE-02, Phase 13).
 *
 * D-01: Only dinner meals count toward the cuisine distribution.
 * D-02: The top cuisine must lead the runner-up by ≥2 dinners.
 * D-02a: Zero dinners → null.
 * D-03/D-04: Returns null for the generic case; caller emits "Weekly Meal Plan".
 * D-05: Used by both the retrieval-first path and the AI-fallback path.
 * D-06: Generation-time only — never called on read/normalize paths.
 */

// Cuisine vocabulary — matches the list in generate-meal-plan/index.ts:1046-1064.
// Exported so callers can import a single canonical list.
export const KNOWN_TITLE_CUISINES = [
  "mediterranean",
  "mexican",
  "italian",
  "indian",
  "thai",
  "chinese",
  "japanese",
  "korean",
  "greek",
  "middle eastern",
  "asian",
  "latin",
  "caribbean",
  "french",
  "spanish",
  "southern",
  "comfort",
] as const;

// Override map for title-casing edge cases (multi-word, hyphenated).
const TITLE_TOKEN_OVERRIDES: Record<string, string> = {
  "gluten free": "Gluten-Free",
  "gluten-free": "Gluten-Free",
  "dairy free": "Dairy-Free",
  "dairy-free": "Dairy-Free",
  "low carb": "Low-Carb",
  "low-carb": "Low-Carb",
  "high protein": "High-Protein",
  "high-protein": "High-Protein",
  "plant based": "Plant-Based",
  "plant-based": "Plant-Based",
  "whole30": "Whole30",
  "middle eastern": "Middle Eastern",
};

/**
 * Normalizes a string for cuisine comparison:
 * lowercases, &→"and", strips punctuation, collapses spaces.
 * Copied/owned here so the shared module has no imports from the edge entrypoint.
 */
export function normalizeTitleText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Title-cases a normalized cuisine string.
 * Applies TITLE_TOKEN_OVERRIDES first, then per-word capitalization.
 * Copied/owned here — same logic as index.ts:1099-1113.
 */
export function titleCaseToken(value: string): string {
  const normalized = normalizeTitleText(value).replace(/\s*-\s*/g, "-");
  const override =
    TITLE_TOKEN_OVERRIDES[normalized] ??
    TITLE_TOKEN_OVERRIDES[normalized.replace(/-/g, " ")];
  if (override) return override;

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .map((part) =>
          part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part
        )
        .join("-")
    )
    .join(" ");
}

// Minimal structural type so this module does not import PlannerMeal/PlannerDay
// from the edge entrypoint (avoids circular dependencies).
type DinnerCuisineMeal = { mealType: string; tags: string[] };
type DinnerCuisineDay = { meals: DinnerCuisineMeal[] };

/**
 * Compute the deterministic dinner-cuisine title per D-01/D-02.
 *
 * @param days  Assembled plan days (PlannerDay[] is structurally compatible).
 * @returns     Title-cased cuisine string if the leader has a ≥2-dinner lead;
 *              null otherwise (caller renders "Weekly Meal Plan").
 */
export function computeDinnerCuisineTitle(
  days: DinnerCuisineDay[],
): string | null {
  // D-01: filter to dinner meals only. Guard against null/undefined meals
  // (the AI-fallback path can pass raw, schema-fall-through meals — CR-01).
  const dinners = days
    .flatMap((d) => (Array.isArray(d?.meals) ? d.meals : []))
    .filter((m) => m && m.mealType === "dinner");

  // D-02a: no dinners → null.
  if (dinners.length === 0) return null;

  // Count each dinner by its first-matching KNOWN_TITLE_CUISINES entry.
  const counts = new Map<string, number>();
  for (const meal of dinners) {
    // CR-01: `tags` is not guaranteed to be an array on the AI-fallback path
    // (PinnedMealSchema is .passthrough() with no required tags; schema
    // validation can fall through). Degrade to "no cuisine" instead of throwing.
    const tags = Array.isArray(meal.tags) ? meal.tags : [];
    const normalizedTags = tags.map(normalizeTitleText);
    for (const cuisine of KNOWN_TITLE_CUISINES) {
      if (normalizedTags.some((tag) => tag.includes(cuisine))) {
        counts.set(cuisine, (counts.get(cuisine) ?? 0) + 1);
        break; // first matching cuisine wins per dinner (D-01 per-dinner first-match)
      }
    }
  }

  // No dinner had a recognizable cuisine tag.
  if (counts.size === 0) return null;

  // Rank descending by count.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topCuisine, topCount] = ranked[0];
  const runnerUpCount = ranked[1]?.[1] ?? 0;

  // D-02: lead must be ≥2; otherwise return null.
  if (topCount - runnerUpCount < 2) return null;

  return titleCaseToken(topCuisine);
}
