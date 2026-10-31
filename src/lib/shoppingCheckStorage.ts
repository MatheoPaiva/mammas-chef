/**
 * shoppingCheckStorage.ts — persists shopping-list check-off state across
 * refresh, keyed per meal plan.
 *
 * Quick task 260707-tl3: checked items were held in pure ephemeral useState
 * inside ShoppingListContent, so every remount (including a page refresh)
 * re-seeded the list to all-unchecked. This helper persists the set of
 * checked item NAMES (the stable per-item identity — the shopping list
 * builder dedupes by name) to localStorage under the key
 * `shopping-checked:<planId>`.
 *
 * All localStorage access is try/catch guarded — Safari private mode throws
 * on access, and a persistence failure must never break the shopping list.
 * A dropped check-off is silent-degrade, not an error, so failures are
 * swallowed rather than logged to Sentry.
 */

const STORAGE_KEY_PREFIX = "shopping-checked:";

function storageKey(planId: string): string {
  return `${STORAGE_KEY_PREFIX}${planId}`;
}

/**
 * Reads the checked item names for a plan. Returns an empty Set if the key
 * is absent, empty, not valid JSON, or not a string array — absence of the
 * key means "all unchecked" (backward compatible with plans that predate
 * this feature).
 */
export function loadCheckedNames(planId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(planId));
    if (!raw) return new Set<string>();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
      return new Set<string>();
    }
    return new Set(parsed);
  } catch {
    return new Set<string>();
  }
}

/**
 * Writes the checked item names for a plan. An empty array clears the entry
 * entirely so an empty set leaves no residue in storage.
 */
export function saveCheckedNames(planId: string, names: string[]): void {
  try {
    if (names.length === 0) {
      localStorage.removeItem(storageKey(planId));
      return;
    }
    localStorage.setItem(storageKey(planId), JSON.stringify(names));
  } catch {
    // Safari private mode (or quota exhaustion) — silent-degrade, not an error.
  }
}
