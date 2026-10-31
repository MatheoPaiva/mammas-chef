/** Batch identity display constants (17-UI-SPEC.md §Color) — a single violet hue,
 * three treatment weights, scoped exclusively to batch-related elements so it never
 * collides with Phase 15's 5-value semantic status palette or the brand palette.
 * Plain classname string exports, not per-status Record maps, because batches have
 * only one visual "kind" (unlike mealStatus.ts's 3-value status enum). */

/** Outline pill (modal Batch ID pills, prep-day batch card's id chip). Exact class
 * string per 17-UI-SPEC.md §Color — do NOT re-derive from brand tokens. */
export const BATCH_BADGE_CLASSNAME =
  "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-200";

/** Icon + micro-text (card compact batch-chip cluster, prep-day card's "Used by"
 * line). Exact class string per 17-UI-SPEC.md §Color. */
export const BATCH_COMPACT_TEXT_CLASSNAME = "text-violet-700 dark:text-violet-400";

/** Solid fill — Pipeline batch bars ONLY (17-UI-SPEC.md §D), a deliberate exception
 * to the outline convention above: in the Pipeline the bar IS the primary visual
 * subject of its row. Exact class string per 17-UI-SPEC.md §Color. */
export const BATCH_BAR_CLASSNAME =
  "bg-violet-500 dark:bg-violet-600 text-white dark:text-violet-50 border border-violet-600 dark:border-violet-500";

/** Compacts a batch time value ("~N min" or "N min"/"N minutes") to "~Nm"/"Nm",
 * preserving an optional leading "~" (batch.time is stored as "~N min" per D-02,
 * unlike cookTime/totalTime's bare "N min" — compactMinutes in mealStatus.ts does
 * not tolerate the tilde). Unparseable input passes through unchanged (never
 * throws), matching compactMinutes' style. Flat, anchored regex — no nested
 * quantifiers, ReDoS-safe per the codebase's T-16-01 convention. */
export function compactBatchTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^\s*(~)?\s*(\d+)\s*min(?:ute)?s?\s*$/i);
  if (!match) return value;
  const [, tilde, digits] = match;
  return `${tilde ?? ""}${digits}m`;
}
