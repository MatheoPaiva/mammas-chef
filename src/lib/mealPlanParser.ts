import type { MealPlanResponse, MealRecipe, DayPlan, GroceryItem, PrepBatch, PrepTip, SkipSlots } from "@/types/mealPlan";
import { isSlotSkipped } from "@/types/mealPlan";
import { normalizeIngredient } from "@/lib/ingredientParser";
import { ALL_WEEKDAYS, getBatchCookDay } from "@/constants/preferences";

// updatedPrepTips is the edge's merged tip list (kept tips + a tagged delta). It is
// optional here: when it is absent the caller keeps its current tips, so a missing
// list can never wipe the plan's prep tips (261007-slz).
export interface SwapResponse {
  newMeal: MealRecipe;
  updatedPrepTips?: PrepTip[];
  newShoppingItems: GroceryItem[];
}

export interface DayRegenerationResponse {
  newMeals: MealRecipe[];
  updatedPrepTips?: PrepTip[];
}

/** Well-formed tips from an edge-returned list; undefined when the field is not an array. */
function parseReturnedTips(value: unknown): PrepTip[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (t): t is PrepTip => !!t && typeof t === "object" && typeof t.day === "string" && typeof t.tip === "string",
  );
}

function stripCodeFences(rawText: string) {
  const trimmed = rawText.trim().replace(/^\uFEFF/, "");
  if (!trimmed.startsWith("```")) return trimmed;

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

const MEAL_TYPE_BY_POSITION: MealRecipe["mealType"][] = ["breakfast", "lunch", "dinner", "snack"];
const VALID_MEAL_TYPES = new Set(MEAL_TYPE_BY_POSITION);

/**
 * Sentinel prefix for synthesized IDs (WR-01).
 *
 * normalizeMeal must assign every meal an id so React keys and in-memory
 * mutations (swap/regen) have a stable handle even on legacy plans where
 * the AI never emitted ids. We tag synthesized ids with this prefix so
 * the dependency validator (validateMealPlanDependencies) can distinguish
 * "AI emitted ids" from "normalizer synthesized them" and refuse to enter
 * new-schema mode purely off our own bookkeeping. Exported for the
 * validator; do NOT use this prefix for any other purpose.
 */
export const SYNTHESIZED_ID_PREFIX = "gen-";

/**
 * Strip hallucinated leftover provenance from titles, step text, and
 * ingredient name strings. GPT-4.1-mini occasionally writes "(from Friday
 * Dinner)" / "portion for Wednesday lunch" / "1 serving X, from Monday
 * dinner" even after the prompt + retry pass. The validator catches these
 * (LEFTOVER_*_HALLUCINATED) but block-save means the user gets nothing. By
 * cleaning known patterns here BEFORE validation, we lose the AI's
 * (broken) leftover intent but the plan ships. Validator stays strict so
 * the codes surface in Sentry telemetry when the AI still slips through
 * with patterns we haven't normalized yet.
 *
 * IMPORTANT: only stripping cosmetic free-text. We never invent a
 * source_meal_id link — that would fake structural data the AI didn't
 * actually emit.
 */
const TITLE_LEFTOVER_ANNOTATION_RE =
  /\s*\((?:from|leftover\s+from|leftover)\s+[^)]+\)\s*$/i;
const STEP_DOWNSTREAM_PROMISE_RE =
  /\b(?:refrigerate|store|portion|save|set\s+aside|reserve|chill|pack)\b[^.]{0,80}\b(?:for|to)\b[^.]{0,40}\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next\s+day)(?:'s)?\b[^.]{0,40}\b(?:breakfast|lunch|dinner|snack)\b[^.]*\.?/gi;

function cleanLeftoverTitle(title: string): string {
  return title.replace(TITLE_LEFTOVER_ANNOTATION_RE, "").trim();
}

function cleanLeftoverStep(step: string): string {
  // Strip any sentence that promises a specific downstream consumer.
  // Collapse double spaces left behind.
  return step.replace(STEP_DOWNSTREAM_PROMISE_RE, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Repair-then-strip phantom leftover tags (validator code LEFTOVER_PHANTOM_MEAL),
 * LEFT-03. GPT-4.1-mini frequently tags a meal "leftover" / "leftovers" /
 * "reheat" without a resolving source_meal_id. validateMealPlanDependencies
 * (Step 2.65) treats this as a hard error and block-saves the entire plan; the
 * single retry reproduces the same model tic, so the user can generate nothing
 * (MAMMASCHEF-2D).
 *
 * A leftover almost always restates its source's title, so we FIRST attempt
 * repair: re-link the phantom to a real, chronologically-EARLIER-slot meal whose
 * normalized title matches (nearest-earlier on multiple matches), keeping the
 * leftover tag. Only when no earlier-slot title match exists do we fall back to
 * the original STRIP behavior (drop the leftover tag(s) + clear source_meal_id
 * so it becomes a fresh meal — quick-task 260615-u7m / commit 847dca5).
 *
 * We never invent a source_meal_id that does not point at a real earlier meal,
 * never block-save, and never re-roll. A leftover tag WITH an already-resolving
 * source_meal_id is left untouched. The edge function duplicates this exact rule
 * (Deno cannot import this module). The validator stays strict (D-04) and runs
 * AFTER this repair; genuinely-broken cases (chronology, hallucinated free-text)
 * remain caught.
 */
const LEFTOVER_TAG_RE = /\b(?:leftover|leftovers|reheat)\b/i;

/**
 * Normalized title key for earlier-slot leftover matching (D-03). Case-,
 * whitespace-, and punctuation-insensitive; drops the "&" / "and" connector so
 * "Chicken & Rice" and "Chicken and Rice" collapse to the same key. Linear
 * string ops only — no catastrophic backtracking.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // strip punctuation (incl. &) to spaces
    .replace(/\band\b/g, " ")     // drop the standalone connector word
    .replace(/\s+/g, " ")
    .trim();
}

interface LeftoverSourceCandidate {
  id: string;
  dayIndex: number;
  slotIndex: number;
}

/**
 * Nutrition-contradiction constants (NUTR-02, D-06/D-07). Client twin of
 * supabase/functions/_shared/validation.ts's KETO_MAX_CARBS / LOW_CARB_MAX_CARBS /
 * HIGH_PROTEIN_TAG_MIN — duplicated here because Deno cannot import this client TS
 * module (the accepted duplication precedent, identical to repairPhantomLeftovers'
 * "edge function duplicates this exact rule" note above). Values MUST stay in sync
 * with Plan 18-01's validation.ts constants; a shared fixture (carbs 36 / protein 8)
 * is asserted on both sides in their respective suites (T-18-07).
 */
const KETO_MAX_CARBS = 20;
const LOW_CARB_MAX_CARBS = 35;
const HIGH_PROTEIN_TAG_MIN = 10;

/**
 * Normalized tag key for contradiction matching (D-07) — lowercase,
 * hyphen/space-insensitive, mirrors validation.ts's normalizePreference and this
 * file's normalizeTitle. Linear string ops only — no catastrophic backtracking
 * (T-18-02 parity).
 */
function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Returns the subset of `tags` that contradict the reported macros (NUTR-02, D-06/
 * D-07): "keto" when carbs > KETO_MAX_CARBS, "low carb" when carbs > LOW_CARB_MAX_CARBS,
 * "high protein" when protein < HIGH_PROTEIN_TAG_MIN. Every other tag (High Fiber,
 * cuisine tags, Toddler-Friendly, Mediterranean, etc.) is uncheckable and never
 * returned. Macro comparisons are Number.isFinite-guarded (T-18-05) so a malformed/
 * non-finite macro never throws and never contradicts. Returns the ORIGINAL
 * (unnormalized) tag strings so callers can filter the source array by reference.
 */
function contradictoryNutritionTags(tags: string[], macros: { carbs: number; protein: number }): string[] {
  return tags.filter((tag) => {
    const normalized = normalizeTag(tag);
    if (normalized === "keto") {
      return Number.isFinite(macros.carbs) && macros.carbs > KETO_MAX_CARBS;
    }
    if (normalized === "low carb") {
      return Number.isFinite(macros.carbs) && macros.carbs > LOW_CARB_MAX_CARBS;
    }
    if (normalized === "high protein") {
      return Number.isFinite(macros.protein) && macros.protein < HIGH_PROTEIN_TAG_MIN;
    }
    return false;
  });
}

function repairPhantomLeftovers(days: DayPlan[], batches: PrepBatch[] = []): DayPlan[] {
  const batchIds = new Set(batches.map((b) => b.id));
  const allMealIds = new Set<string>();
  // normalizedTitle -> candidate source meals, recorded in chronological order.
  const titleIndex = new Map<string, LeftoverSourceCandidate[]>();
  days.forEach((day, dayIndex) => {
    for (const meal of day.meals ?? []) {
      if (!meal.id) continue;
      allMealIds.add(meal.id);
      const key = normalizeTitle(typeof meal.title === "string" ? meal.title : "");
      if (!key) continue;
      const slotIndex = MEAL_TYPE_BY_POSITION.indexOf(meal.mealType);
      const candidate: LeftoverSourceCandidate = { id: meal.id, dayIndex, slotIndex };
      const existing = titleIndex.get(key);
      if (existing) existing.push(candidate);
      else titleIndex.set(key, [candidate]);
    }
  });

  return days.map((day, dayIndex) => ({
    ...day,
    meals: (day.meals ?? []).map((meal) => {
      const tags = Array.isArray(meal.tags) ? meal.tags : [];
      const hasLeftoverTag = tags.some((t) => LEFTOVER_TAG_RE.test(t));
      // Dual-signal trigger (Phase 15, RESEARCH.md Pitfall 1): structured
      // status:"leftover" is an independent phantom-leftover signal, OR'd
      // with the existing tag check — a status-only phantom (no tag) must
      // still be caught here, not just at the tags-only LEFTOVER_PHANTOM_MEAL
      // validation gate.
      if (!hasLeftoverTag && meal.status !== "leftover") return meal;
      const resolves = !!meal.source_meal_id && allMealIds.has(meal.source_meal_id);
      if (resolves) return meal;

      // Phantom leftover: try to re-link to a real earlier-slot meal that
      // restates this title before falling back to strip.
      const phantomSlotIndex = MEAL_TYPE_BY_POSITION.indexOf(meal.mealType);
      const candidates = titleIndex.get(normalizeTitle(typeof meal.title === "string" ? meal.title : "")) ?? [];
      const earlier = candidates.filter(
        (c) =>
          c.id !== meal.id &&
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
        return { ...meal, source_meal_id: nearest.id, status: "leftover" };
      }
      // No earlier-slot title match. If `uses` still names a batch that really
      // exists in weekPlan.batches, that reference is independently verifiable
      // (leftoverCascade.findDependents matches on `uses` OR source_meal_id) —
      // leave the meal untouched rather than stripping a signal that still
      // works. Root-cause chain link 2 (leftover-swap-cascade): D-23's blanket
      // strip was wiping `uses`/status on every saved plan because
      // source_meal_id never resolves after a save/load round-trip, even
      // though the batch reference itself was perfectly intact.
      const usesRealBatch = Array.isArray(meal.uses) && meal.uses.some((id) => batchIds.has(id));
      if (usesRealBatch) return meal;

      // Truly dangling (no title match, no real batch reference) → strip to a
      // fresh meal (original D-23 behavior).
      return {
        ...meal,
        tags: tags.filter((t) => !LEFTOVER_TAG_RE.test(t)),
        source_meal_id: undefined,
        status: meal.status === "leftover" ? "fresh" : meal.status,
        uses: undefined,
      };
    }),
  }));
}

function synthesizeId(): string {
  // Per-call uniqueness via crypto.randomUUID — replaces a module-level
  // mutable counter (WR-02) which could collide across in-flight parses
  // and grew unboundedly for the life of the SPA session.
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${SYNTHESIZED_ID_PREFIX}${uuid}`;
}

function normalizeMeal(raw: Record<string, unknown>, index: number): MealRecipe {
  const rawType = typeof raw.mealType === "string" ? raw.mealType.toLowerCase().trim() : "";
  const mealType = VALID_MEAL_TYPES.has(rawType as MealRecipe["mealType"])
    ? (rawType as MealRecipe["mealType"])
    : MEAL_TYPE_BY_POSITION[index] ?? "dinner";

  // Hoisted so both the return object and the NUTR-02 tag strip below can read them.
  const calories = typeof raw.calories === "number" && !isNaN(raw.calories) ? raw.calories : 0;
  const protein = typeof raw.protein === "number" && !isNaN(raw.protein) ? raw.protein : 0;
  const carbs = typeof raw.carbs === "number" && !isNaN(raw.carbs) ? raw.carbs : 0;
  const fats = typeof raw.fats === "number" && !isNaN(raw.fats) ? raw.fats : 0;

  // Array-whitelist cast FIRST (T-15-01 DoS mitigation, unchanged) — only strings ever
  // reach the NUTR-02 contradiction strip below.
  const rawTags: string[] = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string")
    : [];
  const contradictingTags = contradictoryNutritionTags(rawTags, { carbs, protein });

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : synthesizeId(),
    /** Preserve AI-emitted leftover link (Plan 07-01 schema, 07-06 prompt). Used by
     * validateMealPlanDependencies (Plan 07-04) and the orchestrator retry loop
     * (Plan 07-05). Dropping it here silently disables the entire validation gate. */
    source_meal_id: typeof raw.source_meal_id === "string" && raw.source_meal_id ? raw.source_meal_id : undefined,
    /** Array-whitelist cast (Security V5 / T-15-01 DoS mitigation, mirrors the `tags`
     * line below) — ids this meal consumes from weekPlan.batches (D-04, D-15). Never
     * trust-casts a non-array or non-string entries. */
    uses: Array.isArray(raw.uses) ? raw.uses.filter((u): u is string => typeof u === "string") : [],
    /** String-or-undefined cast, mirrors source_meal_id above — id of the batch this
     * meal produces, when it is a batch-source meal (D-04, D-15). */
    creates: typeof raw.creates === "string" && raw.creates ? raw.creates : undefined,
    /** Whitelist-check against the literal status set, never trust-cast (Security V5
     * DoS mitigation, T-15-01) — mirrors the mealType whitelist pattern above. A
     * malformed/hallucinated AI status string must never reach the render layer. */
    status:
      raw.status === "fresh" || raw.status === "prep-linked" || raw.status === "leftover"
        ? raw.status
        : undefined,
    cautionNote: typeof raw.cautionNote === "string" && raw.cautionNote ? raw.cautionNote : undefined,
    workflow: typeof raw.workflow === "string" && raw.workflow ? raw.workflow : undefined,
    storage: typeof raw.storage === "string" && raw.storage ? raw.storage : undefined,
    cookTime: typeof raw.cookTime === "string" && raw.cookTime ? raw.cookTime : undefined,
    totalTime: typeof raw.totalTime === "string" && raw.totalTime ? raw.totalTime : undefined,
    libraryRecipeId: typeof raw.libraryRecipeId === "string" && raw.libraryRecipeId ? raw.libraryRecipeId : undefined,
    customRecipeId: typeof raw.customRecipeId === "string" && raw.customRecipeId ? raw.customRecipeId : undefined,
    title: typeof raw.title === "string" && raw.title ? cleanLeftoverTitle(raw.title) : "Untitled Recipe",
    mealType,
    prepTime: typeof raw.prepTime === "string" ? raw.prepTime : "",
    servings: typeof raw.servings === "number" && !isNaN(raw.servings) ? Math.round(raw.servings) : 2,
    calories,
    protein,
    carbs,
    fats,
    // NUTR-02/D-06: strip contradictory nutrition tags (Low Carb/Keto/High Protein
    // whose macros disagree) — additive-only filter on top of the T-15-01 whitelist
    // cast above. This is the single funnel every intake surface routes through
    // (full plan, swap, day-regen, saved-plan loads), so the strip covers them all.
    tags: rawTags.filter((t) => !contradictingTags.includes(t)),
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients.map(normalizeIngredient) : [],
    steps: Array.isArray(raw.steps)
      ? raw.steps
          .filter((s): s is string => typeof s === "string")
          .map(cleanLeftoverStep)
          .filter((s) => s.length > 0)
      : [],
    toddlerTip: typeof raw.toddlerTip === "string" ? raw.toddlerTip : undefined,
    glucoseTip: typeof raw.glucoseTip === "string" ? raw.glucoseTip : undefined,
    flavorNotes: typeof raw.flavorNotes === "string" ? raw.flavorNotes : undefined,
  };
}

// --- Prep-day re-tag (D-03, D-04, D-05) ---
const PREP_TIP_ID_RE = /^tip-prep-/i;

/**
 * Deterministic re-tag: forces prep-day tasks onto the canonical batchCookDay.
 * Nightly tips (id matches tip-{day}-night pattern) are left on their own day.
 * Identification: tip id starts with "tip-prep-" (D-04 primary signal).
 * Fallback when ids absent/inconsistent: the day carrying the most tips (>=3)
 * is treated as the prep day cluster (D-04 fallback). Pure, guarded, idempotent.
 */
function retagPrepDayTips(prepTips: PrepTip[], batchCookDay: string): PrepTip[] {
  // Primary signal: any tip whose id starts with "tip-prep-".
  const hasPrepIds = prepTips.some((t) => t.id && PREP_TIP_ID_RE.test(t.id));

  if (hasPrepIds) {
    return prepTips.map((t) =>
      t.id && PREP_TIP_ID_RE.test(t.id) ? { ...t, day: batchCookDay } : t,
    );
  }

  // Fallback: dominant task cluster (>=3 tips on the same day).
  const counts: Record<string, number> = {};
  for (const t of prepTips) { counts[t.day] = (counts[t.day] || 0) + 1; }
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0 || sorted[0][1] < 3) return prepTips;
  const impliedPrepDay = sorted[0][0];

  return prepTips.map((t) =>
    t.day === impliedPrepDay ? { ...t, day: batchCookDay } : t,
  );
}

export function normalizeMealPlan(raw: MealPlanResponse, weekStartDay?: string): MealPlanResponse {
  // Resolve batchCookDay precedence:
  //   1. Edge-authoritative value — but ONLY when it is a real weekday (WR-01).
  //      A garbage string ("Funday", " ") must not reach consumers as a label.
  //   2. Explicit weekStartDay hint → derive (WR-02 — the load-path source of
  //      truth; survives the post-load day re-sort because it is intrinsic to
  //      the plan's true start, not positional days[0]).
  //   3. Legacy positional days[0] derive (D-07 — preserves streaming-path
  //      behavior, which passes pre-sorted days and no weekStartDay).
  //   4. undefined.
  const edgeValue = raw.weekPlan.batchCookDay;
  const batchCookDay: string | undefined =
    typeof edgeValue === "string" && (ALL_WEEKDAYS as readonly string[]).includes(edgeValue)
      ? edgeValue
      : typeof weekStartDay === "string" && weekStartDay
        ? getBatchCookDay(weekStartDay)
        : raw.weekPlan.days?.[0]?.day
          ? getBatchCookDay(raw.weekPlan.days[0].day)
          : undefined;

  const normalizedDays: DayPlan[] = (raw.weekPlan.days ?? []).map((day) => ({
    day: typeof day.day === "string" ? day.day : "Day",
    meals: Array.isArray(day.meals)
      ? day.meals.map((m, i) => normalizeMeal(m as unknown as Record<string, unknown>, i))
      : [],
  }));

  // Hard [] default (D-05) — unlike batchCookDay's conditional spread above, batches
  // is ALWAYS present so downstream .length gates (D-17's Pipeline-toggle visibility)
  // are always safe to call without an optional-chain fallback. Computed before
  // repairPhantomLeftovers so it can cross-check `uses` against real batch ids.
  const normalizedBatches: PrepBatch[] = Array.isArray(raw.weekPlan.batches) ? raw.weekPlan.batches : [];

  // Strip phantom leftover tags (LEFTOVER_PHANTOM_MEAL) before validation so a
  // mislabeled leftover doesn't block-save the whole plan. See repairPhantomLeftovers.
  const repairedDays = repairPhantomLeftovers(normalizedDays, normalizedBatches);

  const normalizedWeekPlan = {
    ...raw.weekPlan,
    title: raw.weekPlan.title || "Weekly Meal Plan",
    days: repairedDays,
    batches: normalizedBatches,
    ...(batchCookDay ? { batchCookDay } : {}),
  };

  // Guard malformed prepTips elements (WR-03): a single null / non-object /
  // day-less element from the (unprotected) generation path must not throw and
  // fail the whole parse. Filter to well-formed PrepTip objects before re-tag;
  // the dropped elements never carried a usable day label anyway.
  const safeTips: PrepTip[] = Array.isArray(raw.prepTips)
    ? raw.prepTips.filter(
        (t): t is PrepTip =>
          !!t && typeof t === "object" && typeof (t as PrepTip).day === "string",
      )
    : [];

  const normalizedPrepTips =
    batchCookDay && safeTips.length > 0
      ? retagPrepDayTips(safeTips, batchCookDay)
      : safeTips;

  return {
    ...raw,
    weekPlan: normalizedWeekPlan,
    prepTips: normalizedPrepTips,
  };
}

/**
 * Strip skip-violating prep tips from a plan (D-04/D-06/D-07).
 *
 * Removes any prep tip whose `day` is a fully-skipped day (D-07a), whose text
 * names a fully-skipped weekday — whole-word, text-scan-wins so it drops even when
 * the tip carries valid meal ids (D-07a/c) — or whose only `referenced_meal_ids`
 * resolve to skipped/unresolvable slots (D-07b/d). Tips with no referenced_meal_ids
 * pass the pairing check (D-07d). Pure, guarded, idempotent; a no-op when no slots
 * are skipped (D-06).
 *
 * Mirrors the edge strip in generate-meal-plan/index.ts (the two runtimes can't
 * share a module; the rule is kept identical). Invoked at both choke-points: before
 * save on generation and on every saved-plan read, with skipSlots available (D-05).
 */
export function stripSkippedDayTips(plan: MealPlanResponse, skipSlots?: SkipSlots): MealPlanResponse {
  const slots = skipSlots ?? plan.skipSlots;
  if (!slots || Object.keys(slots).length === 0) return plan;

  const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
  // Fully-skipped days have no meals and never appear in weekPlan.days, so evaluate
  // the canonical weekday set against skipSlots (whose keys use canonical names) —
  // deriving candidates from plan.weekPlan.days would miss them entirely.
  // Only fully-skipped days (all four meal types skipped) are eligible for the
  // day-field and text-scan rejections — a partially-skipped day is still active.
  const fullySkippedDays = (ALL_WEEKDAYS as readonly string[]).filter((day) =>
    MEAL_TYPES.every((mt) => isSlotSkipped(slots, day, mt)),
  );
  // The prep/batch-cook day is a legitimate prep day even when its meals are skipped
  // (e.g. skip Fri/Sat/Sun with a Sunday week-start → prepDay = Saturday). Exempt it
  // from the day-field/text rejection so its prep-day tasks survive (G-12-01). Only
  // skipped COOK days are forbidden; prep-day tasks are tagged with the prep day.
  const prepDay = plan.weekPlan?.batchCookDay;
  const skippedCookDays = prepDay ? fullySkippedDays.filter((d) => d !== prepDay) : fullySkippedDays;

  // Resolve meal id -> { day, mealType } from the plan's days.
  const mealSlotById = new Map<string, { day: string; mealType: string }>();
  for (const day of plan.weekPlan?.days ?? []) {
    for (const meal of day.meals ?? []) {
      if (meal && typeof meal.id === "string") {
        mealSlotById.set(meal.id, { day: day.day, mealType: meal.mealType });
      }
    }
  }

  // Whole-word regex over the closed set of skipped COOK day names — prep day exempt
  // (plan-derived, no user input — no ReDoS surface).
  const skipDayRegex =
    skippedCookDays.length > 0 ? new RegExp(`\\b(${skippedCookDays.join("|")})\\b`, "i") : null;
  const skippedCookDaySet = new Set(skippedCookDays);

  const filtered: PrepTip[] = [];
  for (const tip of plan.prepTips ?? []) {
    // D-07a: structured day field is a skipped cook day → drop (prep day exempt, G-12-01).
    if (skippedCookDaySet.has(tip.day)) continue;
    // D-07a/c: text names a skipped cook day → drop (text scan wins, even with valid ids).
    if (skipDayRegex && typeof tip.tip === "string" && skipDayRegex.test(tip.tip)) continue;
    // D-07b/d: keep only referenced_meal_ids resolving to a known, non-skipped slot.
    if (Array.isArray(tip.referenced_meal_ids) && tip.referenced_meal_ids.length > 0) {
      const validIds = tip.referenced_meal_ids.filter((id) => {
        const slot = mealSlotById.get(id);
        return !!slot && !isSlotSkipped(slots, slot.day, slot.mealType);
      });
      if (validIds.length === 0) continue; // no valid id survives → drop
      filtered.push({ ...tip, referenced_meal_ids: validIds }); // ≥1 survives → keep (no mutation)
      continue;
    }
    filtered.push(tip); // no referenced_meal_ids / empty → pairing check skipped (D-07d)
  }

  return { ...plan, prepTips: filtered };
}

function isMealPlanShape(value: unknown): value is MealPlanResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<MealPlanResponse>;
  return !!candidate.weekPlan &&
    typeof candidate.weekPlan === "object" &&
    typeof candidate.weekPlan.title === "string" &&
    Array.isArray(candidate.weekPlan.days) &&
    Array.isArray(candidate.prepTips);
}

/** Bound the candidate-scan cost so an adversarial AI response (tens of
 * thousands of '{' chars) cannot stall the main thread for many seconds.
 * 20 is well above the real-world ceiling — a normal meal plan has at most
 * one top-level object plus a handful of false starts in markdown prose. */
const MAX_JSON_CANDIDATES = 20;

function findJsonObjectCandidates(text: string) {
  const candidates: string[] = [];

  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    if (candidates.length >= MAX_JSON_CANDIDATES) break;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
        continue;
      }

      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          break;
        }
        if (depth < 0) {
          // Unbalanced — abandon this start rather than continuing past
          // a stray closing brace that can never form a valid object.
          break;
        }
      }
    }
  }

  return candidates;
}

function parseCandidate(candidate: string) {
  const parsed = JSON.parse(candidate) as unknown;
  if (!isMealPlanShape(parsed)) {
    throw new Error("Parsed JSON did not match meal plan shape");
  }
  return normalizeMealPlan(parsed);
}

function isSwapResponseShape(value: unknown): value is SwapResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SwapResponse>;
  return (
    !!v.newMeal &&
    typeof v.newMeal === "object" &&
    typeof (v.newMeal as Partial<MealRecipe>).title === "string" &&
    Array.isArray(v.newShoppingItems)
  );
}

function parseSwapCandidate(candidate: string): SwapResponse {
  const parsed = JSON.parse(candidate) as unknown;
  if (!isSwapResponseShape(parsed)) {
    throw new Error("Parsed JSON did not match swap response shape");
  }
  return {
    ...parsed,
    newMeal: normalizeMeal(parsed.newMeal as unknown as Record<string, unknown>, 0),
    updatedPrepTips: parseReturnedTips(parsed.updatedPrepTips),
  };
}

export function parseSwapResponse(rawText: string): SwapResponse {
  const cleaned = stripCodeFences(rawText);

  try {
    return parseSwapCandidate(cleaned);
  } catch {
    const candidates = findJsonObjectCandidates(cleaned);
    for (const candidate of candidates) {
      try {
        return parseSwapCandidate(candidate);
      } catch {
        continue;
      }
    }
  }

  throw new Error("Unable to parse swap response");
}

// ---------------------------------------------------------------------------
// Day regeneration response parsing
// ---------------------------------------------------------------------------

function isDayRegenShape(value: unknown): value is DayRegenerationResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DayRegenerationResponse>;
  return Array.isArray(v.newMeals) && v.newMeals.length > 0;
}

function parseDayRegenCandidate(candidate: string): DayRegenerationResponse {
  const parsed = JSON.parse(candidate) as unknown;
  if (!isDayRegenShape(parsed)) {
    throw new Error("Parsed JSON did not match day regeneration response shape");
  }
  return {
    ...parsed,
    newMeals: parsed.newMeals.map((m, i) =>
      normalizeMeal(m as unknown as Record<string, unknown>, i),
    ),
    updatedPrepTips: parseReturnedTips(parsed.updatedPrepTips),
  };
}

export function parseDayRegenerationResponse(rawText: string): DayRegenerationResponse {
  const cleaned = stripCodeFences(rawText);

  try {
    return parseDayRegenCandidate(cleaned);
  } catch {
    const candidates = findJsonObjectCandidates(cleaned);
    for (const candidate of candidates) {
      try {
        return parseDayRegenCandidate(candidate);
      } catch {
        continue;
      }
    }
  }

  throw new Error("Unable to parse day regeneration response");
}

export function parseMealPlanResponse(rawText: string): MealPlanResponse {
  const cleaned = stripCodeFences(rawText);

  try {
    return parseCandidate(cleaned);
  } catch {
    const candidates = findJsonObjectCandidates(cleaned);

    for (const candidate of candidates) {
      try {
        return parseCandidate(candidate);
      } catch {
        continue;
      }
    }
  }

  throw new Error("Unable to parse meal plan response");
}
