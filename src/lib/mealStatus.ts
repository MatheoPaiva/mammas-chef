import type { MealRecipe } from "@/types/mealPlan";

/** Full-badge className map (modal), variant="outline" + className override
 * per 15-UI-SPEC.md §Color. Verbatim class strings — do NOT re-derive from
 * brand tokens. */
export const STATUS_BADGE_CLASSNAME: Record<NonNullable<MealRecipe["status"]>, string> = {
  fresh: "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200",
  "prep-linked": "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200",
  leftover: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
};

/** Full status label, modal badges only. */
export const STATUS_LABEL: Record<NonNullable<MealRecipe["status"]>, string> = {
  fresh: "FRESH COOK",
  "prep-linked": "USES PREP",
  leftover: "LEFTOVER",
};

/** Compact card status dot color, per 15-UI-SPEC.md §Component Contract Row 1. */
export const STATUS_DOT_CLASSNAME: Record<NonNullable<MealRecipe["status"]>, string> = {
  fresh: "bg-green-500",
  "prep-linked": "bg-blue-500",
  leftover: "bg-amber-500",
};

/** Compact card status label text, shorter than STATUS_LABEL. */
export const STATUS_COMPACT_LABEL: Record<NonNullable<MealRecipe["status"]>, string> = {
  fresh: "FRESH",
  "prep-linked": "PREP",
  leftover: "LEFTOVER",
};

/** Compact card status label text colors, per 15-UI-SPEC.md §Color per-status treatment. */
export const STATUS_COMPACT_TEXT_CLASSNAME: Record<NonNullable<MealRecipe["status"]>, string> = {
  fresh: "text-green-700 dark:text-green-400",
  "prep-linked": "text-blue-700 dark:text-blue-400",
  leftover: "text-amber-700 dark:text-amber-400",
};

/** Compacts an "N min"/"N minutes" free-text time value to "Nm". Unparseable
 * input passes through unchanged (never throws), matching prepTimeSavings.ts style. */
export function compactMinutes(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^\s*(\d+)\s*min(?:ute)?s?\s*$/i);
  return match ? `${match[1]}m` : value;
}

/** Extracts a compact duration string (e.g. "4d", "2h") from a free-text storage
 * instruction. Returns undefined when nothing parses. */
export function extractStorageDuration(storage: string | undefined): string | undefined {
  if (!storage) return undefined;
  const match = storage.match(/(\d+)\s*(day|days|hr|hrs|hour|hours)/i);
  if (!match) return undefined;
  const unit = /^h/i.test(match[2]) ? "h" : "d";
  return `${match[1]}${unit}`;
}

/** True when the free-text storage instruction mentions freezing. */
export function isFreezerStorage(storage: string | undefined): boolean {
  return !!storage && /freeze|frozen|freezer/i.test(storage);
}
