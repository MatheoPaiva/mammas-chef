/**
 * storeUnitConverter.ts — Converts aggregated recipe measurements into
 * store-friendly quantities (e.g. "14 cloves garlic" → "2 heads garlic").
 *
 * Runs after ingredient aggregation and before final formatting.
 */

// ---------------------------------------------------------------------------
// Conversion rules
// ---------------------------------------------------------------------------

interface ConversionRule {
  /** Substring match against the ingredient name (lowercased). */
  match: string;
  /** The recipe unit this rule applies to. Empty string = unitless count. */
  fromUnit: string;
  /** The store-friendly unit to convert to. */
  toUnit: string;
  /** Multiply the recipe quantity by this factor to get the store quantity. */
  factor: number;
  /** If true, round up to nearest whole number (default: true). */
  roundUp?: boolean;
}

const STORE_CONVERSIONS: ConversionRule[] = [
  // --- Produce ---
  // Garlic: ~10 cloves per head
  { match: "garlic", fromUnit: "clove", toUnit: "head", factor: 1 / 10 },
  // Garlic: unitless count (AI sometimes writes "12 garlic" without "cloves")
  { match: "garlic", fromUnit: "", toUnit: "head", factor: 1 / 10 },
  // Lemons/limes: keep as count but ensure whole numbers
  { match: "lemon", fromUnit: "", toUnit: "", factor: 1 },
  { match: "lime", fromUnit: "", toUnit: "", factor: 1 },
  // Lemon/lime juice: tbsp → fruit count (~3 tbsp per lemon, ~2 per lime)
  { match: "lemon", fromUnit: "tbsp", toUnit: "", factor: 1 / 3 },
  { match: "lime", fromUnit: "tbsp", toUnit: "", factor: 1 / 2 },
  // Fresh ginger: 1 tbsp minced ≈ 1-inch piece, buy ~2-inch pieces
  { match: "ginger", fromUnit: "tbsp", toUnit: "piece", factor: 1 / 2 },
  // Celery: ~0.5 cup chopped per stalk
  { match: "celery", fromUnit: "cup", toUnit: "stalk", factor: 2 },
  // Green onions/scallions: ~4 cups chopped per bunch
  { match: "green onion", fromUnit: "cup", toUnit: "bunch", factor: 1 / 4 },
  { match: "scallion", fromUnit: "cup", toUnit: "bunch", factor: 1 / 4 },
  // Leafy greens: ~5 packed cups per 5oz bag
  { match: "spinach", fromUnit: "cup", toUnit: "bag (5 oz)", factor: 1 / 5 },
  { match: "kale", fromUnit: "cup", toUnit: "bunch", factor: 1 / 8 },
  { match: "arugula", fromUnit: "cup", toUnit: "bag (5 oz)", factor: 1 / 5 },
  // Broccoli/cauliflower: ~4 cups florets per head
  { match: "broccoli", fromUnit: "cup", toUnit: "head", factor: 1 / 4 },
  { match: "cauliflower", fromUnit: "cup", toUnit: "head", factor: 1 / 4 },

  // --- Fresh herbs: ~1 cup (~16 tbsp) per bunch ---
  // tbsp factor 1/4: any ≥1 tbsp passes the <0.25 guard → always rounds to ≥1 bunch
  { match: "cilantro", fromUnit: "cup", toUnit: "bunch", factor: 1 },
  { match: "cilantro", fromUnit: "tbsp", toUnit: "bunch", factor: 1 / 4 },
  { match: "parsley", fromUnit: "cup", toUnit: "bunch", factor: 1 },
  { match: "parsley", fromUnit: "tbsp", toUnit: "bunch", factor: 1 / 4 },
  { match: "dill", fromUnit: "cup", toUnit: "bunch", factor: 1.33 },
  { match: "dill", fromUnit: "tbsp", toUnit: "bunch", factor: 1 / 4 },
  { match: "basil", fromUnit: "cup", toUnit: "bunch", factor: 1 },
  { match: "basil", fromUnit: "tbsp", toUnit: "bunch", factor: 1 / 4 },
  { match: "mint", fromUnit: "cup", toUnit: "bunch", factor: 1.33 },
  { match: "mint", fromUnit: "tbsp", toUnit: "bunch", factor: 1 / 4 },

  // --- Dairy & Eggs ---
  // Eggs: 12 per dozen
  { match: "egg", fromUnit: "", toUnit: "dozen", factor: 1 / 12 },
  // Eggs with "large" unit (AI sometimes writes "6 large eggs")
  { match: "egg", fromUnit: "large", toUnit: "dozen", factor: 1 / 12 },
  // Butter: 8 tbsp per stick, 2 sticks per cup
  { match: "butter", fromUnit: "tbsp", toUnit: "stick", factor: 1 / 8 },
  { match: "butter", fromUnit: "cup", toUnit: "stick", factor: 2 },
  // Heavy cream: 2 cups per pint
  { match: "heavy cream", fromUnit: "cup", toUnit: "pint", factor: 1 / 2 },
  // Ricotta: ~2 cups per 15oz container
  { match: "ricotta", fromUnit: "cup", toUnit: "container (15 oz)", factor: 1 / 2 },
  // Cottage cheese: ~2 cups per 16oz container
  { match: "cottage cheese", fromUnit: "cup", toUnit: "container (16 oz)", factor: 1 / 2 },
  // Crumbled feta: ~1 cup per 6oz container
  { match: "feta", fromUnit: "cup", toUnit: "container (6 oz)", factor: 1 },
  // Shredded cheese: ~2 cups per 8oz bag
  { match: "mozzarella", fromUnit: "cup", toUnit: "bag (8 oz)", factor: 1 / 2 },
  { match: "cheddar", fromUnit: "cup", toUnit: "bag (8 oz)", factor: 1 / 2 },
  // Grated parmesan: ~1.5 cups per 6oz container (standard wedge/grated size)
  { match: "parmesan", fromUnit: "cup", toUnit: "container (6 oz)", factor: 2 / 3 },
  // Greek yogurt: 1 cup = 8 oz, sold in 32oz containers
  { match: "greek yogurt", fromUnit: "cup", toUnit: "container (32 oz)", factor: 1 / 4 },
  { match: "yogurt", fromUnit: "cup", toUnit: "container (32 oz)", factor: 1 / 4 },
  // Sour cream: 1 cup = 8 oz, sold in 16oz containers
  { match: "sour cream", fromUnit: "cup", toUnit: "container (16 oz)", factor: 1 / 2 },
  // Cream cheese: 8 oz per block
  { match: "cream cheese", fromUnit: "oz", toUnit: "block (8 oz)", factor: 1 / 8 },
  // Coconut milk: ~1.75 cups per 13.5oz can (must be before generic "milk" rule)
  { match: "coconut milk", fromUnit: "cup", toUnit: "can (13.5 oz)", factor: 1 / 1.75 },
  // Almond/oat/soy milk: 1 cup = 8 oz, sold in half-gallon (64 oz) cartons
  { match: "almond milk", fromUnit: "cup", toUnit: "carton (64 oz)", factor: 1 / 8 },
  { match: "oat milk", fromUnit: "cup", toUnit: "carton (64 oz)", factor: 1 / 8 },
  { match: "soy milk", fromUnit: "cup", toUnit: "carton (64 oz)", factor: 1 / 8 },
  // Regular milk: 8 cups per half gallon (most common purchase size)
  { match: "milk", fromUnit: "cup", toUnit: "half gallon", factor: 1 / 8 },

  // --- Grains & Dry Goods ---
  // Rice: ~2 cups dry per lb
  { match: "rice", fromUnit: "cup", toUnit: "lb", factor: 0.5 },
  // Quinoa: ~2.5 cups dry per lb
  { match: "quinoa", fromUnit: "cup", toUnit: "lb", factor: 0.4 },
  // Oats: ~3 cups per lb
  { match: "oat", fromUnit: "cup", toUnit: "lb", factor: 1 / 3 },
  // Flour: ~3.5 cups per lb
  { match: "flour", fromUnit: "cup", toUnit: "lb", factor: 1 / 3.5 },

  // --- Canned Goods ---
  // Broth/stock: 4 cups per 32oz carton
  { match: "broth", fromUnit: "cup", toUnit: "carton (32 oz)", factor: 1 / 4 },
  { match: "stock", fromUnit: "cup", toUnit: "carton (32 oz)", factor: 1 / 4 },
  // Diced/crushed tomatoes: ~1.75 cups per 14oz can
  { match: "diced tomato", fromUnit: "cup", toUnit: "can (14 oz)", factor: 1 / 1.75 },
  { match: "crushed tomato", fromUnit: "cup", toUnit: "can (14 oz)", factor: 1 / 1.75 },
  // Tomato paste: ~10 tbsp per 6oz can
  { match: "tomato paste", fromUnit: "tbsp", toUnit: "can (6 oz)", factor: 1 / 10 },
  // Canned beans/chickpeas: ~1.75 cups per 15oz can
  { match: "bean", fromUnit: "cup", toUnit: "can (15 oz)", factor: 1 / 1.75 },
  { match: "chickpea", fromUnit: "cup", toUnit: "can (15 oz)", factor: 1 / 1.75 },
  { match: "lentil", fromUnit: "cup", toUnit: "can (15 oz)", factor: 1 / 1.75 },

  // --- Hummus/dips: 2 tbsp per serving, sold in 10oz containers ---
  { match: "hummus", fromUnit: "tbsp", toUnit: "container (10 oz)", factor: 1 / 20 },
];

// ---------------------------------------------------------------------------
// Conversion logic
// ---------------------------------------------------------------------------

export interface AggregatedItem {
  quantity: number;
  unit: string;
  name: string;
}

/**
 * Names that look like recipe titles or prepped items rather than raw
 * ingredients. These should skip conversion to avoid false positives
 * (e.g. "Veggie & Feta Egg Muffins (from Sunday prep)" triggering the egg rule).
 */
const SKIP_PATTERNS = [
  /from\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+prep/i,
  /\bmuffin/i,
  /\bbite/i,
  /\bfrom prep\b/i,
];

function looksLikeRecipeTitle(name: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(name));
}

/**
 * Convert a single aggregated ingredient to store-friendly units.
 * Returns the item unchanged if no conversion rule matches.
 */
export function convertToStoreUnit(item: AggregatedItem): AggregatedItem {
  // Skip items that look like recipe titles or prepped items
  if (looksLikeRecipeTitle(item.name)) return item;

  const lower = item.name.toLowerCase();

  // Guard: don't convert "white wine (or chicken broth)" via the broth rule
  if (lower.includes("wine") && (lower.includes("broth") || lower.includes("stock"))) {
    return item;
  }

  // Guard: don't convert "rice vinegar", "rice wine", "rice paper" via the rice rule
  if (lower.includes("rice") && /\b(vinegar|wine|paper)\b/.test(lower)) {
    return item;
  }

  // Guard: don't convert "garlic powder/bread/salt/butter/paste" via unitless garlic rule
  if (lower.includes("garlic") && item.unit === "" && /garlic\s+(?:powder|bread|salt|butter|paste)/i.test(lower)) {
    return item;
  }

  // Guard: don't convert "almond/peanut/cashew butter" via the butter rule
  if (lower.includes("butter") && /(?:almond|peanut|cashew|nut)\s+butter/.test(lower)) {
    return item;
  }

  // Guard: don't convert "lemon zest" or "lime zest" via juice→count rules
  if (/\b(lemon|lime)\b/.test(lower) && lower.includes("zest")) {
    return item;
  }

  // Guard: don't convert "frozen spinach/kale" via fresh leafy green rules
  if (/\b(spinach|kale|arugula)\b/.test(lower) && lower.includes("frozen")) {
    return item;
  }

  for (const rule of STORE_CONVERSIONS) {
    if (lower.includes(rule.match) && item.unit === rule.fromUnit) {
      const converted = item.quantity * rule.factor;
      // Skip conversion if need is < 1/4 of store unit — avoids absurd
      // over-buys like "1 gallon milk" when only 0.5 cup needed.
      // Break (not return) so the D-01 default count-family ceil below can
      // still fire for unitless items like "0.2 Lime" (factor 1 → 0.2 < 0.25
      // → no conversion, but still must ceil to 1).
      if (converted < 0.25) break;
      const shouldRound = rule.roundUp !== false;
      const storeQty = shouldRound ? Math.max(1, Math.ceil(converted)) : converted;

      return {
        ...item,
        quantity: storeQty,
        unit: rule.toUnit,
      };
    }
  }

  // D-01/D-02: Discrete (count-family) items always round up — you cannot buy
  // 0.8 of a bell pepper or 0.3 of a pita. Applies to unitless items that did
  // not match any explicit STORE_CONVERSIONS rule above. Weight/volume items
  // are unaffected here (thresholding lives in shoppingListBuilder Pass 3).
  if (item.unit === "" && item.quantity > 0 && !Number.isInteger(item.quantity)) {
    return { ...item, quantity: Math.ceil(item.quantity) };
  }

  return item;
}
