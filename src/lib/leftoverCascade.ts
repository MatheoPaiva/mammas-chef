/**
 * leftoverCascade.ts — pure, deterministic dependent-repoint logic for BATCH-03
 * (Sentry MAMMASCHEF-32: "there is no connection between the meals that have a
 * relationship for leftovers … build your bridge of relationship between meals").
 *
 * Client-side and deterministic (D-10) — no new AI call. When a batch-source
 * meal is swapped or regenerated, this walks the plan for dependents (meals
 * that consume the source's batch, discovered via `source_meal_id` OR `uses`),
 * re-points their title + portion-reference ingredient lines to the new
 * source, and rewrites the batch entity while keeping its id (stable
 * identity — D-10). When the outgoing meal was itself a leftover and its
 * batch loses its last consumer, the now-orphaned batch is dropped from
 * `batches[]` and the source meal is left untouched (D-12).
 *
 * Modeled on mealPlanParser.ts's repairPhantomLeftovers shape ("scan all
 * days, build an index, remap matching meals, return new days") and its
 * whitelist-cast convention — never spreads untrusted data, always returns
 * new objects/arrays rather than mutating inputs.
 */
import type { DayPlan, Ingredient, MealRecipe, PrepBatch, WeekPlan } from "@/types/mealPlan";

export interface CascadeResult {
  /** days + batches, both rewritten when the cascade applies; identical
   * reference to the input weekPlan when nothing changed (zero dependents,
   * no orphaned batch). */
  weekPlan: WeekPlan;
  /** null when zero dependents were re-pointed (no copy change, D-10). Otherwise
   * the "{Day} {mealType}[, ...] updated to leftover {NewTitle}." clause per
   * 17-UI-SPEC.md §F Copywriting Contract — callers append this (with a leading
   * space) to the existing swap/regen toast's description; never a second
   * toast() call (TOAST_LIMIT=1). */
  toastDescriptionSuffix: string | null;
}

interface DependentRef {
  meal: MealRecipe;
  day: string;
}

/** Conservative storage default when a re-pointed batch had none (D-10). */
const DEFAULT_STORAGE = "Refrigerate up to 3 days.";

/** Batch ids are short AI-controlled mnemonics (e.g. "S1", "Q1"), never user
 * input — a flat escaped match is ReDoS-safe, mirroring shoppingListBuilder.ts's
 * FROM_BATCH precedent. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when an ingredient name is a portion-reference line naming `batchId`
 * (D-06, e.g. "3 prepared salmon portions from Batch S1"). */
function referencesBatch(name: string, batchId: string): boolean {
  return new RegExp(`from\\s+batch\\s+${escapeRegExp(batchId)}\\b`, "i").test(name);
}

/** Walk every day for meals that consume `sourceBatchId` — via `source_meal_id`
 * pointing at `oldMeal.id` OR `uses` containing the batch id (D-10 dual-signal
 * bias: either signal alone is enough, never silently dropped on ambiguous
 * data). Excludes `newMeal` itself by reference — it already occupies the old
 * slot in `weekPlan.days` by the time this runs. */
function findDependents(
  weekPlan: WeekPlan,
  oldMeal: MealRecipe,
  newMeal: MealRecipe,
  sourceBatchId: string,
): DependentRef[] {
  const results: DependentRef[] = [];
  for (const day of weekPlan.days) {
    for (const meal of day.meals ?? []) {
      if (meal === newMeal) continue;
      const bySourceId = meal.source_meal_id === oldMeal.id;
      const byUses = Array.isArray(meal.uses) && meal.uses.includes(sourceBatchId);
      if (bySourceId || byUses) {
        results.push({ meal, day: day.day });
      }
    }
  }
  return results;
}

/** Meals (other than `meal` itself, by identity) that depend on `meal`:
 * `source_meal_id === meal.id` OR (`meal.creates` && `uses` includes it).
 * Thin wrapper over findDependents for planEdits.skipMealInPlan (F2). */
export function findDependentMeals(weekPlan: WeekPlan, meal: MealRecipe): Array<{ meal: MealRecipe; day: string }> {
  const deps = findDependents(weekPlan, meal, meal, meal.creates ?? "");
  // No batch created → only the source_meal_id signal counts (never match a stray "" in `uses`).
  return meal.creates ? deps : deps.filter((d) => d.meal.source_meal_id === meal.id);
}

/** Re-point one dependent meal's title + portion-reference ingredient lines to
 * the new source (D-10). `uses` is left untouched — the batch id itself never
 * changes (stable identity). `source_meal_id` is refreshed to `newMeal.id`
 * only when it was already set (regen can change a meal's id; swap preserves
 * it, so this is a no-op in that case) — never invented. */
function rewriteDependentMeal(meal: MealRecipe, sourceBatchId: string, newMeal: MealRecipe): MealRecipe {
  const rewrittenIngredients: Ingredient[] = (meal.ingredients ?? []).map((ing) =>
    referencesBatch(ing.name, sourceBatchId)
      ? { ...ing, name: `prepared ${newMeal.title} portions from Batch ${sourceBatchId}` }
      : ing,
  );

  return {
    ...meal,
    title: `Leftover ${newMeal.title}`,
    ingredients: rewrittenIngredients,
    source_meal_id: meal.source_meal_id ? newMeal.id : meal.source_meal_id,
  };
}

/** Rewrite a batch entity's task/yield from the new source's title + servings;
 * keep storage if present, else a conservative default. Id is NEVER changed —
 * stable identity is the whole point of D-10. */
function rewriteBatchEntity(batch: PrepBatch, newMeal: MealRecipe): PrepBatch {
  return {
    ...batch,
    task: `Cook and portion ${newMeal.title}. Cool and store.`,
    yield: `${newMeal.servings} servings ${newMeal.title}`,
    storage: batch.storage || DEFAULT_STORAGE,
  };
}

function formatDependentLabel(dependent: DependentRef): string {
  return `${dependent.day} ${dependent.meal.mealType}`;
}

/** Comma-join with "and" before the last item (Oxford comma for 3+), per
 * 17-UI-SPEC.md §F: "one summarizing toast, not one per dependent." */
function joinDependentLabels(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function buildToastSuffix(dependents: DependentRef[], newSourceTitle: string): string {
  const labels = dependents.map(formatDependentLabel);
  return `${joinDependentLabels(labels)} updated to leftover ${newSourceTitle}.`;
}

/** True when any meal across `days` still consumes `batchId` via `uses`. */
function anyMealStillUses(days: DayPlan[], batchId: string): boolean {
  return days.some((day) => (day.meals ?? []).some((m) => Array.isArray(m.uses) && m.uses.includes(batchId)));
}

/**
 * Client-side, deterministic dependent-repoint cascade (D-10/D-12, BATCH-03).
 *
 * `weekPlan` must already have `newMeal` placed in `oldMeal`'s former slot
 * (Planner.tsx's swap/regen onDone computes `updatedDays` before calling this).
 *
 * Two independent cases, both checked on every call:
 *   1. `oldMeal` was a batch SOURCE (`oldMeal.creates` set) with dependents —
 *      re-point every dependent's title/ingredients to `newMeal` and rewrite
 *      the batch entity (same id). Produces the toast suffix.
 *   2. `oldMeal` was itself a batch CONSUMER (`oldMeal.uses` non-empty) and
 *      `newMeal` doesn't also consume one of those batches — if no other meal
 *      in the plan still uses it, drop the now-orphaned batch from
 *      `batches[]` (D-12). Silent — no toast copy.
 */
export function applyLeftoverCascade(
  weekPlan: WeekPlan,
  oldMeal: MealRecipe,
  newMeal: MealRecipe,
): CascadeResult {
  const batches = weekPlan.batches ?? [];

  let nextDays = weekPlan.days;
  let nextBatches = batches;
  let toastDescriptionSuffix: string | null = null;

  // --- Case 1: oldMeal was a batch SOURCE — re-point dependents (D-10). ---
  const sourceBatchId = oldMeal.creates;
  const dependents = sourceBatchId ? findDependents(weekPlan, oldMeal, newMeal, sourceBatchId) : [];

  if (sourceBatchId && dependents.length > 0) {
    const dependentIds = new Set(dependents.map((d) => d.meal.id));

    nextDays = weekPlan.days.map((day) => ({
      ...day,
      meals: (day.meals ?? []).map((meal) =>
        meal !== newMeal && dependentIds.has(meal.id)
          ? rewriteDependentMeal(meal, sourceBatchId, newMeal)
          : meal,
      ),
    }));

    nextBatches = batches.map((batch) => (batch.id === sourceBatchId ? rewriteBatchEntity(batch, newMeal) : batch));

    toastDescriptionSuffix = buildToastSuffix(dependents, newMeal.title);
  }

  // --- Case 2: oldMeal was itself a batch CONSUMER — drop orphaned batches (D-12). ---
  const consumedByOld = Array.isArray(oldMeal.uses) ? oldMeal.uses : [];
  if (consumedByOld.length > 0) {
    const stillConsumedByNew = new Set(Array.isArray(newMeal.uses) ? newMeal.uses : []);
    const droppedCandidates = consumedByOld.filter((id) => !stillConsumedByNew.has(id));

    if (droppedCandidates.length > 0) {
      const orphaned = droppedCandidates.filter((batchId) => !anyMealStillUses(nextDays, batchId));
      if (orphaned.length > 0) {
        const orphanedSet = new Set(orphaned);
        nextBatches = nextBatches.filter((b) => !orphanedSet.has(b.id));
      }
    }
  }

  if (nextDays === weekPlan.days && nextBatches === batches) {
    return { weekPlan, toastDescriptionSuffix: null };
  }

  return {
    weekPlan: { ...weekPlan, days: nextDays, batches: nextBatches },
    toastDescriptionSuffix,
  };
}
