/**
 * shoppingListBuilder.ts — Single engine for building shopping lists from
 * recipe ingredients. Replaces the dual-system approach where System A used
 * AI-generated shopping lists and System B rebuilt from recipe ingredients.
 *
 * Now used everywhere: initial plan creation, meal swaps, and recipe inserts.
 *
 * Dedup strategy (two-tier):
 *   1. Primary key — strip parentheticals, strip prep-only words (fresh, frozen,
 *      chopped, cooked, etc.), singularize, sort tokens. Merges "Crumbled feta
 *      cheese" / "Crumbled feta" and "dry quinoa" / "cooked quinoa".
 *   2. Post-merge subset pass — if key A's tokens are a subset of key B's,
 *      merge them. "Bell pepper" ⊂ "bell pepper any color" → merge.
 *      "Black bean" and "cannellini bean" share only "bean" → stay separate.
 *
 * Unit aggregation (family-aware):
 *   - Within a unit family (volume, imperial weight, metric weight), convert to
 *     the largest unit and sum.
 *   - Across families, join with " + " (e.g., "200g + 1.5 cups").
 */

import type { GroceryItem, MealRecipe } from "@/types/mealPlan";
import { formatQuantity, categorizeAisle, capitalize, singularizeToken } from "./ingredientParser";
import { convertToStoreUnit } from "./storeUnitConverter";

/** Aisles where quantities should be stripped (bought by the jar/bottle/bag). */
const PANTRY_AISLES = new Set(["Spices & Seasonings", "Oils & Condiments", "Nuts & Seeds"]);

/**
 * Tiny-quantity thresholds (Phase 4 Plan 02, D-05/D-06/D-07).
 *
 * For non-pantry items where the merged quantity falls below a grocery-meaningful
 * threshold, strip the quantity and emit `pantry: true` — same display treatment
 * as PANTRY_AISLES items. Threshold check runs BEFORE the D-01 ceil so countable
 * produce always rounds up to ≥ 1 and stays in the list with a real quantity.
 *
 * QA-reported examples each threshold targets:
 *   - TINY_VOLUME_CUP (0.25 cup / 4 tbsp): "0.1 tbsp Black pepper" (caught by
 *     D-04 pantry-aisle anyway, but threshold is the safety net for non-pantry
 *     volume drops like "0.05 cup lemon juice").
 *   - TINY_IMPERIAL_WEIGHT_OZ (2 oz / 0.125 lb): "0.4 lb Large shrimp" = 6.4 oz
 *     → STAYS in list (above threshold). Catches genuinely tiny weights only.
 *   - TINY_METRIC_WEIGHT_G (50 g): catches "1 g saffron"-style metric drops.
 *   - Count family: NO threshold — D-01 ceil handles it. Anything ≥ 0.000001
 *     rounds to ≥ 1 (D-07 invariant: countable produce keeps a real quantity).
 */
const TINY_VOLUME_CUP = 0.25;
const TINY_IMPERIAL_WEIGHT_OZ = 2;
const TINY_METRIC_WEIGHT_G = 50;

/**
 * Strip prep/cut descriptions that appear AFTER a comma in ingredient names.
 * E.g. "Red onion, finely diced" → "Red onion"
 *      "Cucumber, sliced into 1/4-inch rounds" → "Cucumber"
 *      "Bell peppers (various colors), cut into 1-inch pieces" → "Bell peppers (various colors)"
 *
 * Does NOT strip leading adjectives that are product identity:
 *      "diced tomatoes" stays "diced tomatoes" (that's what you buy)
 *      "ground beef" stays "ground beef"
 */
const POST_COMMA_PREP = /,\s*(?:cut into|diced into|sliced into|chopped into|torn into|divided|rinsed(?:\s+and\s+drained)?|drained|for (?:serving|roasting|garnish|cooking|topping|adults?|adult\s+portion)|(?:finely |roughly |thinly |freshly )?(?:diced|minced|chopped|sliced|shredded|grated|crushed|cubed|quartered|halved|julienned|torn|crumbled|trimmed|peeled|deveined|spiralized|riced)).*$/i;

/** Parentheticals containing recipe instructions (not product descriptions). */
const INSTRUCTION_PARENS = /\s*\([^)]*(?:optional|for adults?|for toddler|from\s+\w+\s+prep|or\s+\w+\s+for)[^)]*\)/gi;

/** "from Sunday prep" as a suffix (not standalone — standalone caught by NON_PURCHASABLE). */
const FROM_DAY_PREP = /,?\s*from\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+prep\b.*/i;

/** "from Batch S1" as a suffix (batch-consumption reference, D-08). Batch ids are
 * short AI-controlled mnemonics (e.g. "S1", "Q1"), not user input — ReDoS-safe flat
 * match, modeled on FROM_DAY_PREP. */
const FROM_BATCH = /,?\s*from\s+batch\s+\w+\b.*/i;

/** "for adults" / "for adult portion" as a suffix. */
const FOR_AUDIENCE = /,?\s*for\s+(?:adults?|adult\s+portion)\b.*/i;

/** Strip prep descriptions from an ingredient name for cleaner dedup + display. */
function stripPrepDescription(name: string): string {
  return name
    .replace(INSTRUCTION_PARENS, "")   // strip recipe-instruction parens FIRST (before comma regex breaks them)
    .replace(POST_COMMA_PREP, "")
    .replace(FROM_DAY_PREP, "")
    .replace(FROM_BATCH, "")
    .replace(FOR_AUDIENCE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Items that should never appear on a shopping list.
 * Matches leftover references, cooking instructions, and non-purchasable items.
 */
const NON_PURCHASABLE_PATTERNS = [
  // Leftover/cross-references: "3 servings Greek Quinoa Salad from Monday lunch"
  /\bservings?\b.*\bfrom\b/i,
  // Standalone prep references: "from Sunday prep energy bites"
  /^from\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+prep\b/i,
  // Batch-consumption references (D-08): "3 prepared salmon portions from Batch S1".
  // Belt-and-braces alongside the FROM_BATCH suffix-stripper above — checked against
  // BOTH the raw and stripped ingredient name (see isNonPurchasable call site below)
  // so a strip-consumed match still counts even if it "somehow reaches aggregation".
  /\bfrom\s+batch\s+\w+/i,
  // "Salt and pepper to taste", "Salt to taste"
  /\bsalt and pepper\b/i,
  /\bto taste\b/i,
  // Water (plain water is not a shopping item)
  /^water\b/i,
  // Cooking spray
  /\bcooking spray\b/i,
];

/** Returns true if the ingredient name is not something you'd buy at a store. */
function isNonPurchasable(name: string): boolean {
  return NON_PURCHASABLE_PATTERNS.some((p) => p.test(name));
}

// ---------------------------------------------------------------------------
// Dedup key — strip prep words, parentheticals, singularize, sort tokens
// ---------------------------------------------------------------------------

/**
 * Prep/freshness/state words safe to strip — they never change the product
 * identity. "Fresh basil" and "basil" are the same purchase. "Cooked quinoa"
 * and "dry quinoa" are the same purchase.
 *
 * NOT included: words like "black", "ground", "smoked", "greek" which change
 * what you actually buy (black beans ≠ pinto beans, ground beef ≠ beef).
 */
const PREP_STRIP_WORDS = new Set([
  // Freshness / preservation ("dried" excluded — dried herbs ≠ fresh herbs)
  "fresh", "frozen", "canned",
  // Prep state
  "chopped", "diced", "minced", "sliced", "shredded", "grated", "crushed",
  "cubed", "quartered", "halved", "julienned", "torn", "crumbled", "trimmed",
  "peeled", "deveined", "spiralized", "riced", "pitted", "washed",
  // Cooking state
  "cooked", "raw", "uncooked", "dry", "toasted", "roasted",
  // Size descriptors
  "large", "medium", "small", "extra", "thin", "thick", "whole",
  // Adverbs
  "finely", "roughly", "thinly", "freshly",
  // Approximation
  "about", "approx", "approximately",
]);

/**
 * Build a canonical dedup key from an ingredient name.
 *
 * Steps: lowercase → strip parentheticals → remove punctuation → tokenize →
 * singularize → remove prep words → sort → join.
 *
 * Examples:
 *   "Crumbled feta cheese" → "cheese feta"
 *   "Fresh basil leaves"  → "basil leaf"
 *   "Bell peppers (any color)" → "bell pepper"
 *   "Cooked quinoa" → "quinoa"
 */
export function buildDedupKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")      // strip parentheticals
    .replace(/\bor\s+\w+/g, " ")     // strip "or water", "or breadcrumbs" alternatives
    .replace(/[^a-z0-9\s-]/g, " ")   // remove punctuation
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(singularizeToken)
    .filter((t) => !PREP_STRIP_WORDS.has(t) && !/^\d+$/.test(t));
  tokens.sort();
  return tokens.join(" ");
}

// ---------------------------------------------------------------------------
// Unit-family-aware aggregation
// ---------------------------------------------------------------------------

/**
 * Unit families for aggregation. Units within the same family can be converted
 * and summed. Cross-family quantities are joined with " + ".
 */
type UnitFamily = "volume" | "imperial_weight" | "metric_weight" | "count" | "descriptive";

const UNIT_FAMILY_MAP: Record<string, { family: UnitFamily; toBase: number }> = {
  // Volume — base unit: tbsp
  tsp:  { family: "volume", toBase: 1 / 3 },
  tbsp: { family: "volume", toBase: 1 },
  cup:  { family: "volume", toBase: 16 },
  pint: { family: "volume", toBase: 32 },
  quart: { family: "volume", toBase: 64 },
  // Imperial weight — base unit: oz
  oz: { family: "imperial_weight", toBase: 1 },
  lb: { family: "imperial_weight", toBase: 16 },
  // Metric weight — base unit: g
  g:  { family: "metric_weight", toBase: 1 },
  kg: { family: "metric_weight", toBase: 1000 },
  ml: { family: "metric_weight", toBase: 1 }, // rough ml≈g for aggregation
};

/** Preferred display unit per family (the "largest reasonable" unit). */
const PREFERRED_DISPLAY: Record<UnitFamily, { unit: string; fromBase: number }> = {
  volume:          { unit: "cup",  fromBase: 1 / 16 },
  imperial_weight: { unit: "lb",   fromBase: 1 / 16 },
  metric_weight:   { unit: "g",    fromBase: 1 },
  count:           { unit: "",     fromBase: 1 },
  descriptive:     { unit: "",     fromBase: 1 },
};

function getUnitFamily(unit: string): UnitFamily {
  if (!unit) return "count";
  const entry = UNIT_FAMILY_MAP[unit];
  return entry ? entry.family : "count";
}

function toBaseUnits(qty: number, unit: string): number {
  const entry = UNIT_FAMILY_MAP[unit];
  return entry ? qty * entry.toBase : qty;
}

/** A single quantity entry for an ingredient (qty + unit before aggregation). */
interface QtyEntry {
  quantity: number;
  unit: string;
}

/** A single traceability entry — which recipe (meal) an item's ingredients came
 * from, for shopping-list traceability (D-18, SHOP-04). Mirrors GroceryItem.sources. */
type GrocerySource = NonNullable<GroceryItem["sources"]>[number];

/** Aggregated ingredient before final formatting. */
interface AggregatedItem {
  /** Display name (from first occurrence). */
  name: string;
  /** All quantity entries, to be merged family-aware. */
  entries: QtyEntry[];
  /** The dedup key. */
  key: string;
  /** All tokens in the dedup key (for subset matching). */
  keyTokens: Set<string>;
  /** Recipes (deduped by mealId) that contributed to this aggregated item (D-18,
   * SHOP-04). Empty when recipes lack full identity (id/title/mealType/day) —
   * e.g. legacy call sites that predate the 17-06 wiring. */
  sources: GrocerySource[];
}

/** Builds a traceability source entry from a recipe, or null when the recipe
 * lacks the full identity (id/title/mealType) + caller-supplied day needed to
 * populate one. Backward-tolerant — callers that don't pass identity/day simply
 * produce items with no sources (D-18). */
function buildSourceEntry(recipe: RecipeInput): GrocerySource | null {
  if (!recipe.id || !recipe.title || !recipe.mealType || !recipe.day) return null;
  return { mealId: recipe.id, title: recipe.title, day: recipe.day, mealType: recipe.mealType };
}

/** Adds `source` to `target.sources`, deduped by mealId. No-op when source is null. */
function addSource(target: AggregatedItem, source: GrocerySource | null): void {
  if (!source) return;
  if (!target.sources.some((s) => s.mealId === source.mealId)) {
    target.sources.push(source);
  }
}

/**
 * Merge quantity entries using unit-family-aware aggregation.
 * Within a family → convert to preferred unit and sum.
 * Across families → join with " + ".
 */
function mergeQuantities(entries: QtyEntry[]): { quantity: number; unit: string } | string {
  if (entries.length === 0) return { quantity: 0, unit: "" };

  // Group by family
  const byFamily = new Map<UnitFamily, { baseTotal: number; unit: string }>();
  for (const e of entries) {
    const family = getUnitFamily(e.unit);
    const base = toBaseUnits(e.quantity, e.unit);
    const existing = byFamily.get(family);
    if (existing) {
      existing.baseTotal += base;
    } else {
      byFamily.set(family, { baseTotal: base, unit: e.unit });
    }
  }

  // Single family — convert to preferred display unit
  if (byFamily.size === 1) {
    const [family, { baseTotal }] = [...byFamily.entries()][0];
    const display = PREFERRED_DISPLAY[family];
    if (family === "count" || family === "descriptive") {
      return { quantity: baseTotal, unit: "" };
    }
    const converted = baseTotal * display.fromBase;
    // Step down to smaller unit when preferred unit shows ≈ 0
    if (family === "volume" && converted < 0.1) {
      if (baseTotal >= 0.1) return { quantity: baseTotal, unit: "tbsp" };
      return { quantity: baseTotal * 3, unit: "tsp" };
    }
    return { quantity: converted, unit: display.unit };
  }

  // Multiple families — format each and join with " + "
  const parts: string[] = [];
  for (const [family, { baseTotal }] of byFamily) {
    const display = PREFERRED_DISPLAY[family];
    if (family === "count" || family === "descriptive") {
      parts.push(formatQuantity(baseTotal, ""));
    } else {
      const converted = baseTotal * display.fromBase;
      // Step down to smaller unit when preferred unit shows ≈ 0
      if (family === "volume" && converted < 0.1) {
        if (baseTotal >= 0.1) {
          parts.push(formatQuantity(baseTotal, "tbsp"));
        } else {
          parts.push(formatQuantity(baseTotal * 3, "tsp"));
        }
      } else {
        parts.push(formatQuantity(converted, display.unit));
      }
    }
  }
  return parts.join(" + ");
}

// ---------------------------------------------------------------------------
// Product-identity words — if these appear in the non-overlapping tokens of a
// subset merge, block the merge. "almond" + "flour" = different product.
// ---------------------------------------------------------------------------

const PRODUCT_IDENTITY_WORDS = new Set([
  // Processed forms — "almond flour" ≠ "almonds", "garlic powder" ≠ "garlic"
  "flour", "meal", "powder", "extract", "syrup", "sugar", "honey", "dried",
  // Fats & liquids — "avocado oil" ≠ "avocado", "coconut milk" ≠ "coconut"
  "oil", "butter", "milk", "cream", "sauce", "paste", "vinegar", "wine",
  "juice", "broth", "stock", "water",
  // Proteins — prevent "olive oil" absorbing "tuna in olive oil"
  "tuna", "chicken", "beef", "pork", "turkey", "lamb", "salmon", "shrimp",
]);

// ---------------------------------------------------------------------------
// Cross-family produce resolution — convert mixed count + volume to single count
// ---------------------------------------------------------------------------

/** Approximate volume (cups) per single whole produce item. */
const PRODUCE_CUPS_PER_COUNT: Record<string, number> = {
  "bell pepper": 1,
  "onion": 1.5,
  "tomato": 0.75,
  "cucumber": 1.5,
  "zucchini": 1.25,
  "carrot": 0.5,
  "potato": 1,
  "sweet potato": 1,
};

/**
 * For Produce items with both count and volume families, convert volume to
 * approximate count and sum. Returns null if no resolution is possible.
 */
function resolveProduceCrossFamily(
  entries: QtyEntry[],
  name: string,
): { quantity: number; unit: string } | null {
  const lower = name.toLowerCase();

  // Find matching produce item
  let cupsPerCount: number | null = null;
  for (const [key, val] of Object.entries(PRODUCE_CUPS_PER_COUNT)) {
    if (lower.includes(key)) { cupsPerCount = val; break; }
  }
  if (cupsPerCount === null) return null;

  // Check we actually have both count and volume families
  const countEntries = entries.filter((e) => getUnitFamily(e.unit) === "count");
  const volumeEntries = entries.filter((e) => getUnitFamily(e.unit) === "volume");
  if (countEntries.length === 0 || volumeEntries.length === 0) return null;

  // Sum count entries
  let totalCount = 0;
  for (const e of countEntries) totalCount += e.quantity;

  // Convert volume entries to cups, then to approximate count
  let volumeInCups = 0;
  for (const e of volumeEntries) {
    const base = toBaseUnits(e.quantity, e.unit); // in tbsp
    volumeInCups += base / 16; // tbsp → cups
  }
  const volumeAsCount = volumeInCups / cupsPerCount;

  const total = totalCount + volumeAsCount;
  return { quantity: Math.ceil(total), unit: "" };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a deduplicated shopping list from recipe ingredients.
 *
 * 1. Parse each ingredient, strip prep descriptions, filter non-purchasable
 * 2. Aggregate by dedup key (primary pass)
 * 3. Post-merge subset pass (merge near-duplicates where one key ⊂ another)
 * 4. Family-aware unit aggregation
 * 5. Aisle categorization and store-unit conversion
 */
/** Input shape for {@link buildShoppingListFromRecipes} (D-18). `ingredients` /
 * `status` / `source_meal_id` are the original required-for-aggregation fields;
 * `id` / `title` / `mealType` / `day` are additive and OPTIONAL (unlike their
 * required status on `MealRecipe` itself) so existing call sites that only pass
 * `{ ingredients }`-shaped fixtures keep compiling — when any of the four are
 * absent, the contributing recipe simply produces no `sources` trace. */
type RecipeInput = Pick<MealRecipe, "ingredients" | "status" | "source_meal_id"> &
  Partial<Pick<MealRecipe, "id" | "title" | "mealType">> & { day?: string };

export function buildShoppingListFromRecipes(
  recipes: RecipeInput[],
): GroceryItem[] {

  // --- Pass 1: Parse and aggregate by primary dedup key ---
  const aggregated = new Map<string, AggregatedItem>();

  for (const recipe of recipes) {
    // SHOP-03/D-12/D-13: a genuine leftover (status:"leftover" AND a resolving
    // source_meal_id) mirrors its source's ingredients — the source's quantities
    // are already doubled to feed the household, so counting the leftover's
    // ingredients too would double-buy. Dual-signal guard: a leftover missing
    // source_meal_id (mislabeled/ambiguous) is NOT skipped — under-buying is the
    // strictly worse failure. Legacy status-less recipes naturally fail this
    // check and flow through unchanged (D-14).
    if (recipe.status === "leftover" && recipe.source_meal_id) continue;
    const source = buildSourceEntry(recipe);
    for (const ing of recipe.ingredients ?? []) {
      if (!ing.name) continue;
      const cleanName = stripPrepDescription(ing.name);
      // Checked against BOTH the raw and stripped name (D-08 belt-and-braces) —
      // a from-Batch/from-day-prep suffix stripper may have already consumed the
      // exact phrase a NON_PURCHASABLE_PATTERNS entry is designed to catch.
      if (isNonPurchasable(ing.name) || isNonPurchasable(cleanName)) continue;

      const key = buildDedupKey(cleanName);
      if (!key) continue; // safety: all tokens stripped

      const entry: QtyEntry = { quantity: ing.quantity, unit: ing.unit };
      const existing = aggregated.get(key);
      if (existing) {
        existing.entries.push(entry);
        addSource(existing, source);
      } else {
        aggregated.set(key, {
          name: cleanName,
          entries: [entry],
          key,
          keyTokens: new Set(key.split(" ")),
          sources: source ? [source] : [],
        });
      }
    }
  }

  // --- Pass 2: Subset merge ---
  // If key A's tokens are a proper subset of key B's tokens, merge A into B.
  // E.g. "bell pepper" ⊂ "bell pepper any color" → merge.
  // "black bean" and "cannellini bean" share only "bean" → neither is a subset.
  //
  // Guards to prevent false positives:
  //   - Subset must have ≥2 tokens (single-token keys like "almond" are too generic)
  //   - Non-overlapping tokens must not contain product-identity words
  //     (e.g., "flour" in {almond, flour} means almond flour ≠ almonds)
  const keys = [...aggregated.keys()];
  const merged = new Set<string>(); // keys that have been absorbed

  for (let i = 0; i < keys.length; i++) {
    if (merged.has(keys[i])) continue;
    const itemA = aggregated.get(keys[i])!;

    for (let j = i + 1; j < keys.length; j++) {
      if (merged.has(keys[j])) continue;
      const itemB = aggregated.get(keys[j])!;

      // Check if one is a subset of the other
      const aSubsetB = isSubset(itemA.keyTokens, itemB.keyTokens);
      const bSubsetA = isSubset(itemB.keyTokens, itemA.keyTokens);

      if (aSubsetB || bSubsetA) {
        const [subsetItem, supersetItem] = aSubsetB ? [itemA, itemB] : [itemB, itemA];

        // Guard: if non-overlapping tokens contain a product-identity word, these
        // are different products (e.g., "almond" vs "almond flour", "garlic" vs
        // "garlic powder", "avocado" vs "avocado oil", "dill" vs "dried dill")
        const nonOverlap = [...supersetItem.keyTokens].filter((t) => !subsetItem.keyTokens.has(t));
        if (nonOverlap.some((t) => PRODUCT_IDENTITY_WORDS.has(t))) continue;

        // Safe to merge — keep the shorter key (more general name) as survivor
        const absorbedKey = supersetItem.key;
        subsetItem.entries.push(...supersetItem.entries);
        for (const s of supersetItem.sources) addSource(subsetItem, s);
        aggregated.delete(absorbedKey);
        merged.add(absorbedKey);
      }
    }
  }

  // --- Pass 3: Format output ---
  return [...aggregated.values()].map((item) => {
    const aisle = categorizeAisle(item.name);
    // D-18: only attach `sources` when at least one contributing recipe carried
    // full identity + day — keeps the field absent (not an empty array) on
    // legacy/untraceable items, matching GroceryItem.sources' optional contract.
    const sourcesField = item.sources.length ? { sources: item.sources } : {};

    // Step A — Pantry-aisle (D-04): items bought by the bottle/jar/bag.
    // Replace the previous silent quantity-strip with an explicit pantry flag.
    if (PANTRY_AISLES.has(aisle)) {
      return { name: capitalize(item.name), quantity: "", aisle, status: "needed" as const, pantry: true, ...sourcesField };
    }

    const result = mergeQuantities(item.entries);

    // Step C — Tiny-quantity threshold (D-05, runs BEFORE D-01 ceil; D-07).
    // Only single-family volume/weight items can fall below threshold; count
    // and descriptive families are exempt (D-07 — countable items always ceil
    // up to a real quantity).
    if (typeof result !== "string" && isBelowTinyThreshold(result)) {
      return { name: capitalize(item.name), quantity: "", aisle, status: "needed" as const, pantry: true, ...sourcesField };
    }

    // Cross-family: try produce resolution first, then fall back to " + " format
    if (typeof result === "string") {
      if (aisle === "Produce") {
        const resolved = resolveProduceCrossFamily(item.entries, item.name);
        if (resolved) {
          const store = convertToStoreUnit({ ...resolved, name: item.name });
          return {
            name: capitalize(store.name),
            quantity: formatQuantity(store.quantity, store.unit),
            aisle,
            status: "needed" as const,
            ...sourcesField,
          };
        }
      }
      return {
        name: capitalize(item.name),
        quantity: result,
        aisle,
        status: "needed" as const,
        ...sourcesField,
      };
    }

    // Single-family: run through store-unit converter
    const store = convertToStoreUnit({ ...result, name: item.name });
    return {
      name: capitalize(store.name),
      quantity: formatQuantity(store.quantity, store.unit),
      aisle,
      status: "needed" as const,
      ...sourcesField,
    };
  });
}

/**
 * D-05/D-07: returns true when a merged single-family quantity is below the
 * grocery-meaningful threshold for its unit family. Volume → < 0.25 cup,
 * imperial weight → < 2 oz, metric weight → < 50 g. Count and descriptive
 * families never trip the threshold (D-07 — they ceil to ≥ 1 via D-01).
 */
function isBelowTinyThreshold(result: { quantity: number; unit: string }): boolean {
  if (result.quantity <= 0) return false;
  const family = getUnitFamily(result.unit);
  if (family === "volume") {
    // Base unit for volume is tbsp; convert displayed qty back to tbsp then to cups.
    const tbspTotal = toBaseUnits(result.quantity, result.unit);
    const cups = tbspTotal / 16;
    return cups < TINY_VOLUME_CUP;
  }
  if (family === "imperial_weight") {
    // Base unit is oz.
    const ozTotal = toBaseUnits(result.quantity, result.unit);
    return ozTotal < TINY_IMPERIAL_WEIGHT_OZ;
  }
  if (family === "metric_weight") {
    // Base unit is g.
    const gTotal = toBaseUnits(result.quantity, result.unit);
    return gTotal < TINY_METRIC_WEIGHT_G;
  }
  return false;
}

/** Returns true if `sub` is a subset of `sup` (every token in sub exists in sup). */
function isSubset(sub: Set<string>, sup: Set<string>): boolean {
  if (sub.size === 0 || sub.size > sup.size) return false;
  for (const token of sub) {
    if (!sup.has(token)) return false;
  }
  return true;
}
