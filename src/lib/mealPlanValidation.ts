/**
 * Post-parse dependency validation for AI-generated meal plans.
 *
 * Pure function. No I/O, no toast, no Sentry. Caller (Plan 07-05) decides
 * what to do with the errors (retry prompt injection, toast, telemetry).
 *
 * Scope:
 *   - Resolve every MealRecipe.source_meal_id (leftover link) against the plan's id index.
 *   - Enforce chronological direction: leftovers can only point at strictly-earlier slots,
 *     where slot order within a day is derived from MEAL_TYPE_BY_POSITION (NOT array index).
 *   - Resolve every PrepTip.referenced_meal_ids[] id against the same index.
 *   - In new-schema mode (any meal has a populated id), require every PrepTip to carry
 *     a non-empty referenced_meal_ids array.
 *   - In legacy mode (no IDs anywhere), skip every check and return valid.
 *
 * Errors aggregate (no short-circuit) so a single retry round can fix them all.
 */
import type { MealPlanResponse, MealRecipe } from "@/types/mealPlan";
import { SYNTHESIZED_ID_PREFIX } from "@/lib/mealPlanParser";

/** Slot ordering within a day. Inlined (not cross-imported from mealPlanParser)
 * so the validator stays self-contained. */
const MEAL_TYPE_BY_POSITION = ["breakfast", "lunch", "dinner", "snack"] as const;

export interface ValidationError {
  code:
    | "LEFTOVER_FROM_FUTURE"
    | "LEFTOVER_SOURCE_MISSING"
    | "LEFTOVER_FROM_SELF_OR_LATER"
    | "PREP_TIP_REF_MISSING"
    | "LEFTOVER_TITLE_HALLUCINATED"
    | "LEFTOVER_STEP_HALLUCINATED"
    | "LEFTOVER_INGREDIENT_HALLUCINATED"
    | "LEFTOVER_PHANTOM_MEAL";
  message: string;
  dayIndex?: number;
  mealType?: string;
  sourceMealId?: string;
  sourceDayIndex?: number;
  sourceMealType?: string;
  prepTipDay?: string;
}

interface IndexEntry {
  dayIndex: number;
  slotIndex: number;
  day: string;
  mealType: MealRecipe["mealType"];
}

function slotIndexOf(mealType: string): number {
  return MEAL_TYPE_BY_POSITION.indexOf(mealType as (typeof MEAL_TYPE_BY_POSITION)[number]);
}

export function validateMealPlanDependencies(
  plan: MealPlanResponse,
): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const days = plan.weekPlan?.days ?? [];

  // Step 1: schema-mode detection. New-schema only if the AI actually
  // emitted an id on at least one meal. Ids synthesized by normalizeMeal
  // (SYNTHESIZED_ID_PREFIX, WR-01) are ignored here — otherwise the
  // validator would silently enter new-schema mode against a legacy plan
  // and apply leftover/prep-tip ref checks to plans that never opted in.
  const isNewSchema = days.some((d) =>
    (d.meals ?? []).some(
      (m) =>
        typeof m.id === "string" &&
        m.id.length > 0 &&
        !m.id.startsWith(SYNTHESIZED_ID_PREFIX),
    ),
  );
  if (!isNewSchema) {
    return { valid: true, errors: [] };
  }

  // Step 2: build the id index. Slot index derived from mealType, not array position.
  const idIndex = new Map<string, IndexEntry>();
  days.forEach((day, dayIndex) => {
    (day.meals ?? []).forEach((meal) => {
      const slotIndex = slotIndexOf(meal.mealType);
      if (!meal.id || slotIndex === -1) return;
      idIndex.set(meal.id, {
        dayIndex,
        slotIndex,
        day: day.day,
        mealType: meal.mealType,
      });
    });
  });

  // Step 2.5: detect hallucinated leftover annotations in titles.
  // AI sometimes adds "(from Friday Dinner)" / "(leftover from ...)" to the
  // title without setting source_meal_id, so display lies about provenance.
  // Source attribution must live in source_meal_id; free-text in titles is
  // unauditable.
  const titleAnnotationRe = /\((?:from|leftover\s+from|leftover)\s+[^)]+\)/i;
  days.forEach((day, dayIdx) => {
    (day.meals ?? []).forEach((meal) => {
      if (typeof meal.title !== "string") return;
      if (!titleAnnotationRe.test(meal.title)) return;
      const sourceId = meal.source_meal_id;
      const src = sourceId ? idIndex.get(sourceId) : undefined;
      if (!src) {
        errors.push({
          code: "LEFTOVER_TITLE_HALLUCINATED",
          message: `${day.day} ${meal.mealType} title '${meal.title}' includes a leftover annotation but has no resolving source_meal_id — leftover provenance must live in the source_meal_id field, not free text in the title.`,
          dayIndex: dayIdx,
          mealType: meal.mealType,
        });
      }
    });
  });

  // Step 2.6: detect ghost downstream-consumer promises in step text (G-04 Variant A).
  // Pattern: "...refrigerate/store/portion/save... for {day} {mealType}..."
  // If a meal's steps promise a downstream consumer, that consumer must
  // actually exist (some later meal must have source_meal_id pointing back here).
  // Build reverse index: meal ids that are referenced by source_meal_id.
  const referencedAsSource = new Set<string>();
  days.forEach((day) =>
    (day.meals ?? []).forEach((m) => {
      if (m.source_meal_id) referencedAsSource.add(m.source_meal_id);
    }),
  );
  const stepPromiseRe = /\b(?:refrigerate|store|portion|save|set\s+aside|reserve|chill|pack)\b[^.]{0,80}\b(?:for|to)\b[^.]{0,40}\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next\s+day)(?:'s)?\b[^.]{0,40}\b(?:breakfast|lunch|dinner|snack)\b/i;
  days.forEach((day, dayIdx) => {
    (day.meals ?? []).forEach((meal) => {
      const steps = meal.steps;
      if (!Array.isArray(steps) || steps.length === 0) return;
      const matched = steps.find(
        (s) => typeof s === "string" && stepPromiseRe.test(s),
      );
      if (!matched) return;
      // Promise found — meal must be referenced as source by some other meal.
      if (!meal.id || !referencedAsSource.has(meal.id)) {
        errors.push({
          code: "LEFTOVER_STEP_HALLUCINATED",
          message: `${day.day} ${meal.mealType} step promises a downstream consumer ("${matched.slice(0, 120)}") but no later meal has source_meal_id pointing back. Either link the consumer via source_meal_id, or remove the day/meal-specific promise from the step.`,
          dayIndex: dayIdx,
          mealType: meal.mealType,
        });
      }
    });
  });

  // Step 2.65: detect "phantom leftover" meals (G-06).
  // A meal is structurally a leftover if its tags include any leftover marker
  // (case-insensitive: "leftover", "leftovers", "reheat"). The AI sometimes
  // generates these as skeleton meals — short ingredient list with a single
  // recipe-named "leftover-from" item + reheat steps — but without a
  // resolving source_meal_id. The phantom meal references a source that
  // doesn't exist in the plan. Catch the shape, not the prose.
  const LEFTOVER_TAG_RE = /\b(?:leftover|leftovers|reheat)\b/i;
  days.forEach((day, dayIdx) => {
    (day.meals ?? []).forEach((meal) => {
      const tags = Array.isArray(meal.tags) ? meal.tags : [];
      // Dual-signal (Phase 15, RESEARCH.md Pitfall 1): the structured status
      // field is policed exactly like the free-text leftover tags — an
      // AI-emitted status:"leftover" with no real source_meal_id must not
      // present a false leftover to the user, even with zero leftover tags.
      const looksLikeLeftover =
        tags.some((t) => typeof t === "string" && LEFTOVER_TAG_RE.test(t)) ||
        meal.status === "leftover";
      if (!looksLikeLeftover) return;
      const sourceId = meal.source_meal_id;
      const src = sourceId ? idIndex.get(sourceId) : undefined;
      if (!src) {
        errors.push({
          code: "LEFTOVER_PHANTOM_MEAL",
          message: `${day.day} ${meal.mealType} '${meal.title}' is tagged as a leftover but has no resolving source_meal_id — every leftover meal MUST link to an earlier real meal in the plan via source_meal_id. Either set source_meal_id to a real earlier meal id, or remove the leftover tag and provide full raw ingredients + cooking steps.`,
          dayIndex: dayIdx,
          mealType: meal.mealType,
        });
      }
    });
  });

  // Step 2.7: detect "from X day {mealType}" in ingredient strings (G-04 Variant B).
  // If a meal's ingredients name a source meal by day+mealType, the meal must
  // have a resolving source_meal_id.
  const ingredientSourceRe = /\bfrom\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|yesterday|previous\s+day)(?:'s)?\s+(?:breakfast|lunch|dinner|snack)\b/i;
  days.forEach((day, dayIdx) => {
    (day.meals ?? []).forEach((meal) => {
      const ings = meal.ingredients;
      if (!Array.isArray(ings) || ings.length === 0) return;
      const matched = ings.find((i) => {
        const text =
          typeof i === "string"
            ? i
            : typeof i?.name === "string"
              ? i.name
              : "";
        return ingredientSourceRe.test(text);
      });
      if (!matched) return;
      const sourceId = meal.source_meal_id;
      const src = sourceId ? idIndex.get(sourceId) : undefined;
      if (!src) {
        const snippet =
          typeof matched === "string"
            ? matched
            : matched?.name || JSON.stringify(matched);
        errors.push({
          code: "LEFTOVER_INGREDIENT_HALLUCINATED",
          message: `${day.day} ${meal.mealType} ingredient '${String(snippet).slice(0, 120)}' references a source meal by day/mealType but has no resolving source_meal_id. Use source_meal_id to link the leftover; do not name the source in ingredient text.`,
          dayIndex: dayIdx,
          mealType: meal.mealType,
        });
      }
    });
  });

  // Step 3: leftover resolution + chronology check.
  days.forEach((day, consDayIndex) => {
    (day.meals ?? []).forEach((meal) => {
      const sourceId = meal.source_meal_id;
      if (!sourceId) return;

      const consSlot = slotIndexOf(meal.mealType);
      if (consSlot === -1) return; // unrecognized consumer mealType — skip

      const src = idIndex.get(sourceId);
      if (!src) {
        errors.push({
          code: "LEFTOVER_SOURCE_MISSING",
          message: `${day.day} ${meal.mealType} references missing source meal id ${sourceId} — every leftover must point to a meal that exists in this plan.`,
          dayIndex: consDayIndex,
          mealType: meal.mealType,
          sourceMealId: sourceId,
        });
        return;
      }

      if (src.dayIndex > consDayIndex) {
        errors.push({
          code: "LEFTOVER_FROM_FUTURE",
          message: `${day.day} ${meal.mealType} references ${src.day} ${src.mealType} (future day) — leftovers can only flow forward from earlier slots.`,
          dayIndex: consDayIndex,
          mealType: meal.mealType,
          sourceMealId: sourceId,
          sourceDayIndex: src.dayIndex,
          sourceMealType: src.mealType,
        });
        return;
      }

      if (src.dayIndex === consDayIndex && src.slotIndex >= consSlot) {
        errors.push({
          code: "LEFTOVER_FROM_SELF_OR_LATER",
          message: `${day.day} ${meal.mealType} references ${src.day} ${src.mealType} (same day, not earlier) — leftovers can only flow forward from earlier slots.`,
          dayIndex: consDayIndex,
          mealType: meal.mealType,
          sourceMealId: sourceId,
          sourceDayIndex: src.dayIndex,
          sourceMealType: src.mealType,
        });
      }
    });
  });

  // Step 4: prep tip reference resolution.
  // PREP_TIP_REF_REQUIRED is intentionally non-blocking: SC#4 requires that
  // references which exist must resolve to a real meal, not that every prep
  // tip must carry structured references. GPT-4.1-mini reliably names recipes
  // in tip text but doesn't always populate the structured array; treating
  // absence as a blocker would fail every fresh plan.
  const prepTips = plan.prepTips ?? [];
  for (const tip of prepTips) {
    const refs = tip.referenced_meal_ids;
    if (!refs || refs.length === 0) continue;
    for (const id of refs) {
      if (!idIndex.has(id)) {
        errors.push({
          code: "PREP_TIP_REF_MISSING",
          message: `Prep tip on ${tip.day} references missing meal id ${id} — every referenced_meal_ids entry must point to a meal that exists in this plan.`,
          prepTipDay: tip.day,
          sourceMealId: id,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
